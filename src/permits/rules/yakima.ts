import type { Loose } from '../../types/records.ts';
/**
 * City of Yakima (Yakima County) — the city's SmartGov Community portal
 * (ci-yakima-wa.smartgovcommunity.com, the "Building Yakima" permit center)
 * publishes a public report, **Issued Permits for New Buildings** (Reports
 * page, no login): an Exago report that asks for a Date Issued range, the same
 * kind and the same runner as Anacortes' (src/permits/sources/smartgovReport.ts).
 * Checked 2026-11-01. The reader is src/permits/sources/yakima.ts.
 *
 * Each row: permit number, site address, applicant, date issued, permit type
 * and the project description — **new buildings only**. There are no remodels,
 * additions or tenant improvements in it, no project value, no contractor and
 * no phone or email. The city's other public report, "Building Permits Issued -
 * Previous Month", doesn't allow a CSV export and covers one fixed month, so it
 * isn't read. About 17 permits a month (checked 2026-11-01).
 *
 * The report lists new buildings only, so every residential or commercial type
 * in it that isn't sorted below is reported.
 */
import { key, typeMap, cleanText, tidyContacts, nameKey } from '../common.ts';

export const YAKIMA_HOME = 'https://ci-yakima-wa.smartgovcommunity.com';
export const YAKIMA_REPORT_ID = 'f4371872-c5f0-4ba7-8b2d-f3be781856ca';
/** The columns the report must have; if one is gone the city changed it and the pull stops. */
export const YAKIMA_COLUMNS = Object.freeze(['Permit Number', 'Site Address', 'Applicant', 'Date Issued', 'Permit Type', 'Project Description']);

const TYPES = typeMap([
  ['Residential-Single-Family-New', 'new_home'],
  // A house built to a plan the city registered; the descriptions read "NEW SFR".
  ['Residential-Single Family Master Plan', 'new_home'],
  ['Residential-Duplex', 'multifamily'],
  ['Residential-Duplex Master Plan', 'multifamily'],
  ['Residential-Multi-Family-New', 'multifamily'],
  ['Commercial Building New', 'commercial_new']
]);

const categoryFor = (type: string) => TYPES.get(key(type)) || null;

/** The Month/Day/Year the report prints → 'YYYY-MM-DD', or '' when it isn't a real date. */
export function reportDay(text: unknown) {
  const m = String(text || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return d.getUTCMonth() === +m[1] - 1 && d.getUTCDate() === +m[2] ? `${m[3]}-${m[1]}-${m[2]}` : '';
}

const COMPANY = /\b(LLC|L\.L\.C|INC|CORP|CO|COMPANY|HOMES|CONSTRUCTION|BUILDERS?|PROPERTIES|HOLDINGS|PARTNERS|VENTURES|REMODELING|TOWNHOUSES|ENTERPRISES|GROUP|LP|LLP|TRUST)\b/i;

/**
 * The applicant column is a company, a person ("LAST FIRST", or "LAST, FIRST"),
 * or "COMPANY - PERSON" when a builder's contact applied for them.
 */
export function applicantContacts(text: unknown) {
  const s = cleanText(text);
  if (!s) return [];
  const [left, ...right] = s.split(/\s+-\s+/);
  const person = (raw: string) => {
    const flip = cleanText(raw).match(/^([^,]+),\s*(.+)$/);
    return flip ? `${cleanText(flip[2])} ${cleanText(flip[1])}` : cleanText(raw);
  };
  if (right.length) return tidyContacts([{ role: 'Applicant', company: left, name: person(right.join(' - ')) }]);
  return tidyContacts([COMPANY.test(s) ? { role: 'Applicant', company: s } : { role: 'Applicant', name: person(s) }]);
}

/** A Yakima permit from one row of the report (`{ number, address, applicant, issuedOn, type, description }`). */
export function yakimaPermit(row: Loose) {
  return {
    source: 'yakima',
    permitNumber: row.number,
    externalId: '',
    category: categoryFor(row.type),
    type: cleanText(row.type),
    subtype: '',
    status: 'Issued',
    appliedOn: null,
    issuedOn: row.issuedOn,
    finaledOn: null,
    expiresOn: null,
    address: cleanText(row.address),
    city: 'Yakima',
    zip: '',
    parcel: '',
    projectName: '',
    description: cleanText(row.description),
    valuation: null,
    sqft: null,
    units: null,
    contacts: applicantContacts(row.applicant),
    sourceUrl: '',
    finalOnly: false
  };
}

/** Rows of the report's table (records keyed by the header row), checked and de-duplicated by permit number. */
export function yakimaRows(records: Loose[]) {
  if (!records.length) return [];
  const missing = YAKIMA_COLUMNS.filter((c) => !(c in records[0]));
  if (missing.length) throw new Error(`Yakima’s report has changed — no ${missing.join(' / ')} column`);
  const byNumber = new Map();
  for (const r of records) {
    const raw = cleanText(r['Date Issued']);
    if (!raw) continue;
    const issuedOn = reportDay(raw);
    const number = cleanText(r['Permit Number']);
    if (!issuedOn || !number) throw new Error(`Yakima’s report has a row with issued date “${raw}” and number “${number}” — stopped so nothing is missed`);
    if (byNumber.has(number)) continue;
    byNumber.set(number, { number, address: cleanText(r['Site Address']), applicant: r.Applicant || '', issuedOn, type: cleanText(r['Permit Type']), description: cleanText(r['Project Description']) });
  }
  return [...byNumber.values()];
}

export default {
  id: 'yakima',
  label: 'Yakima',
  long: 'City of Yakima',
  contactsNote: 'The applicant’s name (the city’s report has no phone, email or contractor)',
  issuer: 'City of Yakima permit',
  county: 'yakima',
  siteLabel: 'Open the city’s permit portal',
  checkHow: 'a second read of the city’s Issued Permits for New Buildings report (the report is the only list the city publishes)',
  // About 17 new buildings a month: a quiet window is possible.
  mayBeEmpty: true,
  typeOf: (row: Loose) => [row.type],
  categoryFor,
  isUnsorted: (type: string) => /^(residential|commercial)/i.test(cleanText(type)) && !categoryFor(type),
  typeLabel: (type: string) => String(type || ''),
  issuedDayOf: (row: Loose) => row.issuedOn,
  numberOf: (row: Loose) => row.number,
  toPermit: (row: Loose) => yakimaPermit(row),
  emptyError: (since: string) => `Yakima’s Issued Permits for New Buildings report has no permits issued since ${since}`
};
