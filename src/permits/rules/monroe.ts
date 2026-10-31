import type { Loose } from '../../types/records.ts';
/**
 * City of Monroe — the city's monthly "Issued Permits Report" spreadsheets
 * (monroewa.gov → Permitting → Monthly Issued Permit Reports), posted after
 * each month ends (the city's page lists the last few; no login). Reader:
 * src/permits/sources/monroe.ts.
 *
 * Each row: permit number, class (Building / Engineering / Fire / Planning),
 * type, description, proposed use, parcel, address, applicant, contractor
 * name and phone, issue date, status and valuation. Only Building permits can
 * be leads. The city repeats a permit on a row per valuation line, so the
 * reader adds the lines up into one row per permit.
 *
 * Monroe is a small office (about 60 permits of every kind a month, and most
 * of them trades), so a quiet month is normal.
 */
import { key, typeMap, typeSet, cleanText, dayOf, tidyContacts, money } from '../common.ts';

export const MONROE_SITE = 'https://monroewa.gov';
export const MONROE_REPORTS_PAGE = `${MONROE_SITE}/1355/Monthly-Issued-Permit-Reports`;
/** The columns a report must have; if any is gone the city changed the layout and the pull stops. */
export const MONROE_COLUMNS = Object.freeze(['Permit No', 'Permit Class', 'Permit Type', 'Proposed Use', 'Address', 'Issue Date']);

/** The uses the city writes for homes, and for everything else a building can be. */
const HOME_USES = typeSet(['Single Family Detached', 'Single Family Attached aka Townhouse', 'Duplex', 'Multifamily']);
const OTHER_USES = typeSet([
  'Retail', 'Office/Bank/Professional', 'Industrial', 'Restaurant', 'Schools/Hospital', 'Government', 'Religious/Assembly', 'Auto Related',
  'Hotel/Motel', 'Warehouse', 'Agricultural', 'Utility', 'Parking', 'Recreational', 'Mixed Use'
]);
/** Types by their proposed use: homes or something else. */
const NEW = key('Building - New Building');
const REMODEL = key('Building - Remodel');
const ADDITION = key('Building - Addition');
const ADU = key('Building - ADU');
const TOWN_DUPLEX_MF = typeSet(['Single Family Attached aka Townhouse', 'Duplex', 'Multifamily']);

/** Building types that are deliberately not leads. */
const SKIPPED = typeSet([
  'Building - Mechanical', 'Building - Plumbing', 'Building - Re-Roof', 'Building - Sign', 'Building - Deck', 'Building - Demo',
  'Building - Miscellaneous', 'Building - Minimum Site Inspection', 'Building - Adult Family Home', 'Building - Garage/Carport'
]);

/** The lead category for a type ("Building - Remodel") and proposed use, or null. */
function categoryFor(type: string, use = '') {
  const t = key(type);
  const u = key(use);
  const home = HOME_USES.has(u);
  const other = OTHER_USES.has(u);
  if (t === ADU) return u === key('Single Family Detached') ? 'adu' : null;
  // No use named: it's building work, but new homes, remodels and shops can't be told apart.
  if (!u && (t === NEW || t === REMODEL || t === ADDITION)) return 'building_other';
  if (t === NEW) {
    if (u === key('Single Family Detached')) return 'new_home';
    if (TOWN_DUPLEX_MF.has(u)) return 'multifamily';
    return other ? 'commercial_new' : null;
  }
  if (t === REMODEL) return home ? 'remodel' : other ? 'commercial_remodel' : null;
  if (t === ADDITION) return home ? 'addition' : other ? 'commercial_remodel' : null;
  return null;
}

/** A Monroe permit from one (summed) row of a report. */
export function monroePermit(row: Loose) {
  const cls = cleanText(row['Permit Class']);
  const type = cleanText(row['Permit Type']);
  const use = cleanText(row['Proposed Use']);
  return {
    source: 'monroe',
    permitNumber: cleanText(row['Permit No']),
    externalId: '',
    category: categoryFor(`${cls} - ${type}`, use),
    type: `${cls} - ${type}`,
    subtype: use,
    status: cleanText(row['Permit Status']),
    appliedOn: null,
    issuedOn: dayOf(row['Issue Date']),
    finaledOn: null,
    expiresOn: null,
    address: cleanText(row.Address).replace(/^Parcel:\s*/i, ''),
    city: 'Monroe',
    zip: '',
    parcel: cleanText(row['Tax Lot']),
    projectName: '',
    description: cleanText(row['Permit Description']),
    valuation: money(row.Valuation),
    sqft: null,
    units: null,
    contacts: tidyContacts([
      { role: 'Contractor', company: row['Contractor Name'], phone: row['Contractor Phone'] },
      { role: 'Applicant', company: row.Applicant }
    ]),
    sourceUrl: '',
    finalOnly: false
  };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** The reports linked from the city's page: id, title, link and 'YYYY-MM', newest first. */
export function parseMonroeReports(html: unknown) {
  const out = [];
  for (const m of String(html).matchAll(/<a[^>]*href="(\/DocumentCenter\/View\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = cleanText(m[3].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' '));
    const d = title.match(new RegExp(`Issued Permits Report\\s*-\\s*(${MONTHS.join('|')})\\s+(\\d{4})`, 'i'));
    if (d) out.push({ id: m[2], title, url: `${MONROE_SITE}${m[1]}`, month: `${d[2]}-${String(MONTHS.indexOf(d[1].toLowerCase()) + 1).padStart(2, '0')}` });
  }
  return out.sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * A report's rows from its sheet (as an array of rows): the city's title lines,
 * then the header row ("Permit No …"), then a row per permit valuation line.
 * Lines of one permit are added into one row; the sheet's own period line
 * ("9/1/2026 - 9/30/2026") is returned as `period`.
 */
export function monroeReportRows(grid: Loose[]) {
  const at = grid.findIndex((r) => cleanText(r?.[0]) === 'Permit No');
  if (at < 0) throw new Error('Monroe’s report has changed — no “Permit No” header row');
  const head = grid[at].map((h: string) => cleanText(h));
  const missing = MONROE_COLUMNS.filter((c) => !head.includes(c));
  if (missing.length) throw new Error(`Monroe’s report has changed — no ${missing.join(' / ')} column`);
  const byNumber = new Map();
  for (const r of grid.slice(at + 1)) {
    if (!cleanText(r?.[0])) continue;
    const row = Object.fromEntries(head.map((h: string, i: number) => [h, r[i] ?? null]));
    const n = cleanText(row['Permit No']);
    const value = Number(row.Valuation);
    const kept = byNumber.get(n);
    if (!kept) byNumber.set(n, { ...row, Valuation: Number.isFinite(value) ? value : null });
    else if (Number.isFinite(value)) kept.Valuation = Math.round(((kept.Valuation || 0) + value) * 100) / 100;
  }
  const period = cleanText(grid[at - 1]?.[0]);
  return { rows: [...byNumber.values()], period };
}

export default {
  id: 'monroe',
  label: 'Monroe',
  long: 'City of Monroe',
  contactsNote: 'Contractor with phone, and applicant, from the city’s monthly report',
  issuer: 'City of Monroe permit',
  county: 'snohomish',
  phones: true,
  checkHow: 'a second read of the city’s monthly report (the report is the only list the city publishes)',
  // Monroe issues ~5 building leads a month: a quiet window is possible.
  mayBeEmpty: true,
  typeOf: (row: Loose) => [`${cleanText(row['Permit Class'])} - ${cleanText(row['Permit Type'])}`, cleanText(row['Proposed Use'])],
  categoryFor,
  isUnsorted: (type: string, use = '') => /^Building - /i.test(cleanText(type)) && !SKIPPED.has(key(type)) && !categoryFor(type, use),
  typeLabel: (type: string, use = '') => (use ? `${type} · ${use}` : String(type || '')),
  issuedDayOf: (row: Loose) => dayOf(row['Issue Date']),
  numberOf: (row: Loose) => cleanText(row['Permit No']),
  toPermit: (row: Loose) => monroePermit(row),
  emptyError: (since: string) => `Monroe’s monthly reports have no permits issued since ${since} — the city may not have posted the latest one yet`
};
