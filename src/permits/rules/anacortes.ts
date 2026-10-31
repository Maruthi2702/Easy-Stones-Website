import type { Loose } from '../../types/records.ts';
/**
 * City of Anacortes (in Skagit County) — the city's SmartGov Community
 * portal publishes an "Issued Permits with Valuation" report to everyone
 * (ci-anacortes-wa.smartgovcommunity.com → Reports, no login). It is an
 * Exago report that asks for a Date Issued range; the reader
 * (src/permits/sources/anacortes.ts) runs it the way the page does and
 * takes its CSV. Checked 2026-10-22.
 *
 * Each row: issued date, permit number, one cell holding the permit type and
 * the site address ("RE-ROOF RESIDENTIAL 1403 PORTALIS COURT"), parcel, the
 * applicant's name, mailing address and project ("Applicant:  Last, First
 * 123 Main St Project name"), the primary contractor's name and the value.
 * No phone or email, and no status (the report lists issued permits only).
 *
 * The city names a type only by words, so the leads are chosen by its exact
 * type names; a building-looking type nobody has sorted is reported.
 */
import { key, typeMap, typeSet, cleanText, tidyContacts, money } from '../common.ts';

export const ANACORTES_HOME = 'https://ci-anacortes-wa.smartgovcommunity.com';
export const ANACORTES_REPORT_ID = 'b2dad14f-8779-4e91-a9a0-531fe4d52755';
/** The columns the report must have; if one is gone the city changed it and the pull stops. */
export const ANACORTES_COLUMNS = Object.freeze(['Issued Date', 'Application Number', 'Application Type / Site Address', 'Parcel', 'Applicant / Project Name', 'Primary Contractor', 'Valuation']);

const TYPES = typeMap([
  ['RESIDENTIAL SINGLE FAMILY BUILDING', 'new_home'],
  ['COTTAGE UNIT', 'adu'],
  ['ACCESSORY DWELLING UNIT/ADU', 'adu'],
  ['RESIDENTIAL REMODEL WITH NEW SQ FOOTAGE', 'addition'],
  ['RESIDENTIAL REMODEL WITH NO NEW SQ FOOTAGE', 'remodel'],
  ['COMMERCIAL TENANT IMPROVEMENT', 'commercial_remodel'],
  // The city's one broad commercial type: new, remodel or addition can't be told apart.
  ['COMMERCIAL', 'building_other']
]);

/** Types that are deliberately not leads (trades, roofs, siding, fences, decks, outbuildings, solar, signs, site and right-of-way work, land-use applications). */
const SKIPPED = typeSet([
  'MECHANICAL AND GAS WATER HEATERS, RESIDENTIAL', 'MECHANICAL AND GAS WATER HEATERS, COMMERCIAL', 'PLUMBING AND ELECTRIC WATER HEATERS',
  'RE-ROOF RESIDENTIAL', 'RE-ROOF COMMERCIAL', 'WINDOWS/DOORS/SIDING NEW OR REPLACED', 'FENCE', 'DECK OR PORCH', 'SOLAR PERMIT', 'SIGN PERMIT',
  'ACCESSORY STRUCTURE/GARAGE/RETAINING WALL', 'DECONSTRUCTION & DEMOLITION', 'FOUNDATION ONLY', 'FIRE SPRINKLER/HOOD SUPPRESSION', 'FIRE ALARM',
  'YARD IRRIGATION SPRINKLERS', 'SIDE SEWER REPAIR OR REPLACEMENT', 'TANK REMOVAL', 'MANUFACTURED HOME TITLE ELIMINATION', 'REVISION AFTER ISSUANCE',
  'CLEAR AND GRADE', 'OVER OR IN WATER STRUCTURE', 'WIRELESS FACILITY/CELL TOWER/CO-LOCATION'
]);
/** Words of a type that make it a building permit nobody has sorted yet. */
const BUILDING = /^(residential|commercial|cottage|accessory dwelling|multi|duplex|townhouse|townhome|apartment|condo|new )/i;

/** Every type name the report is known to carry, longest first, for splitting a type off its address. */
const KNOWN = [...TYPES.keys(), ...SKIPPED].sort((a, b) => b.length - a.length);

/** "RE-ROOF RESIDENTIAL 1403 PORTALIS COURT" → the type and the address. */
export function splitTypeAndAddress(text: unknown) {
  const s = cleanText(text);
  const k = key(s);
  const known = KNOWN.find((t) => k === t || k.startsWith(`${t} `));
  if (known) return { type: s.slice(0, known.length).trim().replace(/\s+/g, ' '), address: cleanText(s.slice(known.length)) };
  // An unknown type: it ends where the street number starts ("(TYPE 1)" is not one).
  const m = s.match(/^(.*?)(?:\s+(?!\d\))(\d.*|NO SITUS ADDRESS))?$/i);
  return { type: cleanText(m![1]).replace(/\s+/g, ' '), address: cleanText(m![2] || '').replace(/^NO SITUS ADDRESS$/i, '') };
}

/** "Applicant:  Last, First 123 Main St Project" → the applicant's name (the report gives no clean boundary after it). */
export function applicantName(text: unknown) {
  const s = cleanText(String(text || '').replace(/^\s*Applicant:\s*/i, ''));
  const m = s.match(/^(.*?)(?:\s+\d.*)?$/);
  const name = cleanText(m![1]);
  const flip = name.match(/^([^,]+),\s*(.+)$/);
  return flip ? { name: `${cleanText(flip[2])} ${cleanText(flip[1])}`, company: '', rest: cleanText(s.slice(name.length)) } : { name: '', company: name, rest: cleanText(s.slice(name.length)) };
}

/** The Month/Day/Year the report prints → 'YYYY-MM-DD', or '' when it isn't a real date. */
export function reportDay(text: unknown) {
  const m = String(text || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return d.getUTCMonth() === +m[1] - 1 && d.getUTCDate() === +m[2] ? `${m[3]}-${m[1]}-${m[2]}` : '';
}

/**
 * The permits in the report's CSV (as rows keyed by its header line, Shoreline's
 * `parseCsv` after the title lines are cut away): one row each, the type and
 * address split and the date made 'YYYY-MM-DD'. Title, blank and total lines
 * (no date) are left out; a dated row with no number, a bad date or a missing
 * column stops the run rather than save a short or wrong list.
 */
export function anacortesRows(records: Loose[]) {
  if (!records.length) return [];
  const missing = ANACORTES_COLUMNS.filter((c) => !(c in records[0]));
  if (missing.length) throw new Error(`Anacortes’ report has changed — no ${missing.join(' / ')} column`);
  const byNumber = new Map();
  for (const r of records) {
    const raw = cleanText(r['Issued Date']);
    if (!raw) continue;
    const issuedOn = reportDay(raw);
    const number = cleanText(r['Application Number']);
    if (!issuedOn || !number) throw new Error(`Anacortes’ report has a row with issued date “${raw}” and number “${number}” — stopped so nothing is missed`);
    if (byNumber.has(number)) continue;
    byNumber.set(number, {
      number, issuedOn, ...splitTypeAndAddress(r['Application Type / Site Address']), parcel: cleanText(r.Parcel),
      applicant: r['Applicant / Project Name'] || '', contractor: cleanText(r['Primary Contractor']), valuation: cleanText(r.Valuation).replace(/[$,\s]/g, '')
    });
  }
  return [...byNumber.values()];
}

/** An Anacortes permit from one row of the report. */
export function anacortesPermit(row: Loose) {
  const a = applicantName(row.applicant);
  return {
    source: 'anacortes',
    permitNumber: row.number,
    externalId: '',
    category: categoryFor(row.type),
    type: row.type,
    subtype: '',
    status: 'Issued',
    appliedOn: null,
    issuedOn: row.issuedOn,
    finaledOn: null,
    expiresOn: null,
    address: row.address,
    city: 'Anacortes',
    zip: '',
    parcel: row.parcel,
    projectName: '',
    // The applicant's mailing address and the project's name, as the report prints them.
    description: a.rest,
    valuation: money(row.valuation),
    sqft: null,
    units: null,
    contacts: tidyContacts([
      { role: 'Contractor', company: row.contractor },
      { role: 'Applicant', name: a.name, company: a.company }
    ]),
    sourceUrl: '',
    finalOnly: false
  };
}

function categoryFor(type: string) {
  return TYPES.get(key(type)) || null;
}

export default {
  id: 'anacortes',
  label: 'Anacortes',
  long: 'City of Anacortes',
  contactsNote: 'Contractor and applicant names (the city’s report has no phone or email)',
  issuer: 'City of Anacortes permit',
  county: 'skagit',
  siteLabel: 'Open the city’s permit portal',
  checkHow: 'a second read of the city’s issued-permits report (the report is the only list the city publishes)',
  // Anacortes issues ~100 permits a month, a handful of them leads: a quiet window is possible.
  mayBeEmpty: true,
  typeOf: (row: Loose) => [row.type],
  categoryFor,
  isUnsorted: (type: string) => BUILDING.test(cleanText(type)) && !TYPES.has(key(type)) && !SKIPPED.has(key(type)),
  typeLabel: (type: string) => String(type || ''),
  issuedDayOf: (row: Loose) => row.issuedOn,
  numberOf: (row: Loose) => row.number,
  toPermit: (row: Loose) => anacortesPermit(row),
  emptyError: (since: string) => `Anacortes’ issued-permits report has no permits issued since ${since}`
};
