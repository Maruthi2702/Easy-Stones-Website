/**
 * Snohomish County (outside city limits) — the county's own monthly
 * "Issued Residential Permits" and "Issued Commercial Permits" spreadsheets,
 * which Planning & Development Services posts around the 1st for the month
 * before (snohomishcountywa.gov, Archive.aspx?AMID=132 / 133). No account.
 * Reader: src/permits/sources/snohomishCounty.js.
 *
 * Why the reports and not the PDS Permit Portal (pdspermitportal.snoco.org,
 * Amanda): its public search finds one permit by number or address (it exists
 * to schedule inspections), so it can't list what was issued. It's the
 * "Look it up" link, not a source.
 *
 * Each row has the permit's type, sub-type and work type, dates, job value,
 * square feet, units, site, parcel and the applicant (name, company, mailing
 * address) — no phone or email (the PDS_Contact_* columns are the county's own
 * staff). The county only reports permits it issued in the month, so a permit
 * shows up at most a month after it was issued.
 *
 * The county's page says its data may not be used for commercial purposes
 * (RCW 42.56.070(8) — lists of individuals); the owner decided to use it
 * for leads anyway, 2026-10-20.
 *
 * Trade permits (mechanical, plumbing, roofing, fire), land-disturbing
 * (clearing and grading) and sign permits are in other reports and aren't
 * leads, so they aren't read.
 */
import { key, typeMap, typeSet, cleanText, dayOf, tidyContacts, money, count } from '../common.js';

export const SNOHOMISH_ARCHIVE = 'https://www.snohomishcountywa.gov/Archive.aspx';
/** The two reports read: the archive each is posted in (AMID) and the group name on the permits in it. */
export const SNOHOMISH_REPORTS = Object.freeze([
  Object.freeze({ id: 'residential', amid: 132, label: 'Issued Residential Permits' }),
  Object.freeze({ id: 'commercial', amid: 133, label: 'Issued Commercial Permits' })
]);
export const SNOHOMISH_PORTAL = 'https://pdspermitportal.snoco.org/pdsportal/app/landing';

/** The columns a report must have; if any is gone the county changed the layout and the pull stops. */
export const SNOHOMISH_COLUMNS = Object.freeze([
  'Project_File_Number', 'Permit_Description', 'Sub_Type', 'Work_Type', 'Issue_Date', 'Site_Address'
]);

const RBP = 'Residential Building Permit';
const CBP = 'Commercial Building Permit';
const THP = 'Townhouse Permit';

/** Permit description, then "Sub type | Work type" — the county's exact words. */
const TYPES = typeMap([
  [[RBP, 'Single Family Residential | New'], 'new_home'],
  [[RBP, 'SFR-Basic (Approved Contractors Only) | New'], 'new_home'],
  [[RBP, 'Single Family Residential | Addition'], 'addition'],
  [[RBP, 'Single Family Residential | Alteration'], 'remodel'],
  [[RBP, 'Single Family Residential | Addition/Alteration'], 'remodel'],
  [[RBP, 'Single Family Residential | Conversion'], 'building_other'],
  [[RBP, 'Accessory Dwelling Detached | New'], 'adu'],
  [[RBP, 'Accessory Dwelling Detached | Conversion'], 'adu'],
  [[RBP, 'Accessory Dwelling Detached | Alteration'], 'remodel'],
  [[RBP, 'Accessory Dwelling Attached | New'], 'adu'],
  [[RBP, 'Accessory Dwelling Attached | Addition'], 'adu'],
  [[RBP, 'Accessory Dwelling Attached | Alteration'], 'remodel'],
  [[RBP, 'Accessory Dwelling Attached | Addition/Alteration'], 'remodel'],
  // A guesthouse has no kitchen, so it isn't an ADU — and the county doesn't say more.
  [[RBP, 'Guesthouse | New'], 'building_other'],
  [[RBP, 'Guesthouse | Addition'], 'building_other'],
  [[RBP, 'Guesthouse | Conversion'], 'building_other'],
  [[RBP, 'Duplex | New'], 'multifamily'],
  [[RBP, 'Duplex-Basic (Approved Contractors Only) | New'], 'multifamily'],
  [[RBP, 'Duplex | Addition'], 'addition'],
  [[RBP, 'Duplex | Alteration'], 'remodel'],
  [[RBP, 'Duplex | Addition/Alteration'], 'remodel'],
  [[THP, 'Townhouse | New'], 'multifamily'],
  [[THP, 'Townhouse-Basic (Approved Contractors Only) | New'], 'multifamily'],
  [[CBP, 'Townhouse | New'], 'multifamily'],
  [[CBP, 'Townhouse-Basic (Approved Contractors Only) | New'], 'multifamily'],
  [[CBP, 'Occupied Building | New'], 'commercial_new'],
  [[CBP, 'Occupied Building | Addition'], 'commercial_remodel'],
  [[CBP, 'Occupied Building | Repair/Replacement/Alteration'], 'commercial_remodel'],
  [[CBP, 'Occupied Building | Conversion'], 'commercial_remodel'],
  [[CBP, 'Commercial Coach | New'], 'commercial_new'],
  [[CBP, 'Tenant Improvement | Alteration'], 'commercial_remodel'],
  [[CBP, 'Multifamily Residential | Repair/Replacement/Alteration'], 'commercial_remodel']
]);

/**
 * Building permits that are deliberately not leads: repairs (windows, roofs,
 * siding), outbuildings, decks, walls, pools, docks, manufactured homes,
 * wireless sites, signs and demolitions. Matched on the sub type, whatever
 * the work type, except where a rule above names both.
 */
const SKIPPED_SUBTYPES = typeSet([
  'Accessory Building', 'Garage', 'Covered Porch', 'Deck', 'Retaining Wall', 'Swimming Pool', 'Dock', 'Vault',
  'Ag Building (Enclosed)', 'Ag Building (Open)', 'Mobile/Manufactured Home', 'Mobile/Manufactured Home in Park',
  'Non-Occupied Structure', 'Carport', 'Bridge', 'PWSF Antenna(s)', 'PWSF Tower', 'PWSF Equipment Building', 'Commercial', 'Nonresidential'
]);
const SKIPPED_PAIRS = typeSet([
  ['Single Family Residential', 'Repair'],
  ['Multifamily Residential', 'Repair'],
  ['Tenant Improvement', 'High-Pile Storage/Racking'],
  ['Townhouse', 'Repair/Replacement/Alteration'],
  ['Townhouse', 'Sales Office']
]);
/** Work types that are never new work: signing off finished work, a foundation alone, tearing down. */
const SKIPPED_WORKS = typeSet(['Complete Work', 'Foundation Only', 'Demo Only']);
const SKIPPED_DESCRIPTIONS = typeSet(['Demolition Permit', 'Sign Permit']);
const BUILDING_DESCRIPTIONS = typeSet([RBP, CBP, THP]);

const worked = (sub, work) => `${cleanText(sub)} | ${cleanText(work)}`;
const categoryFor = (type, subtype = '') => TYPES.get(key(type, subtype)) || null;

const titleCase = (s) => cleanText(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const zipOf = (v) => (String(v ?? '').match(/\d{5}/) || [''])[0];

/** A Snohomish County permit from one row of a report (headers trimmed, `_report` = residential | commercial). */
export function snohomishPermit(row) {
  const subtype = worked(row.Sub_Type, row.Work_Type);
  return {
    source: 'snohomish_county',
    permitNumber: cleanText(row.Project_File_Number),
    externalId: '',
    category: categoryFor(row.Permit_Description, subtype),
    type: cleanText(row.Permit_Description),
    subtype,
    status: cleanText(row.Status),
    appliedOn: dayOf(row.Application_Date),
    issuedOn: dayOf(row.Issue_Date),
    finaledOn: null,
    expiresOn: null,
    address: cleanText(row.Site_Address),
    city: titleCase(row.Site_City),
    zip: zipOf(row.Site_Postal),
    parcel: cleanText(row.Tax_Account_Number),
    projectName: cleanText(row.Folder_Name),
    description: cleanText(row.Description),
    valuation: money(row.Valuation),
    sqft: count(row.Total_Bldg_Sq_Ft),
    units: count(row.Dwelling_Units) || count(row.Number_of_Dwelling_Units),
    contacts: tidyContacts([
      { role: 'Applicant', company: row.Applicant_Organization, name: row.Applicant_Name, address: row.Applicant_Address }
    ]),
    sourceUrl: '',
    finalOnly: false
  };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * The files listed on an archive page (Archive.aspx?AMID=…): their id, title
 * and the period the title names — 'YYYY-MM' for "September 2026 Issued…", or
 * just a year for the county's yearly file ("2025 Issued Residential
 * Permits"). Newest first, as the page lists them. Entries whose title names
 * no period are left out.
 */
export function parseSnohomishArchive(html) {
  const out = [];
  for (const m of String(html).matchAll(/<a[^>]*href="[^"]*Archive\.aspx\?ADID=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = cleanText(m[2].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' '));
    if (!title) continue;
    const month = title.match(new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{4})\\b`, 'i'));
    const year = title.match(/^(\d{4})\b/);
    if (month) out.push({ id: m[1], title, month: `${month[2]}-${String(MONTHS.indexOf(month[1].toLowerCase()) + 1).padStart(2, '0')}`, year: null });
    else if (year) out.push({ id: m[1], title, month: null, year: year[1] });
  }
  return out;
}

/**
 * The files that can hold permits issued on or after `since` ('YYYY-MM-DD'):
 * every monthly file from since's month on, and the yearly file for since's
 * year and any earlier one. Rows are still cut at `since` when read.
 */
export function snohomishFilesSince(files, since) {
  return files.filter((f) => (f.month ? f.month >= since.slice(0, 7) : f.year >= since.slice(0, 4)));
}

/** Whether a row's issue day belongs to the file it came from (monthly: that month; yearly: that year). */
export const rowBelongsToFile = (file, day) => Boolean(day) && (file.month ? day.startsWith(file.month) : day.startsWith(file.year));

export default {
  id: 'snohomish_county',
  label: 'Snohomish County',
  long: 'Snohomish County (outside city limits)',
  kind: 'county',
  contactsNote: 'Applicant name, company and mailing address from the county’s monthly report (no phone or email; the contractor’s phone comes from the state’s license registry when the company matches)',
  issuer: 'Snohomish County permit',
  county: 'snohomish',
  checkHow: 'a second read of the county’s monthly report (the report is the only list the county publishes)',
  lookup: {
    url: SNOHOMISH_PORTAL,
    label: 'Look it up on Snohomish County’s permit portal',
    note: 'Open “Schedule Inspections” and search by this permit number — no account needed.'
  },
  typeOf: (row) => [row.Permit_Description, worked(row.Sub_Type, row.Work_Type)],
  categoryFor,
  isUnsorted: (type, subtype = '') => {
    if (!BUILDING_DESCRIPTIONS.has(key(type)) || SKIPPED_DESCRIPTIONS.has(key(type))) return false;
    const [sub, work = ''] = String(subtype).split(' | ');
    return !SKIPPED_WORKS.has(key(work)) && !SKIPPED_SUBTYPES.has(key(sub)) && !SKIPPED_PAIRS.has(key(sub, work));
  },
  typeLabel: (type, subtype = '') => (subtype ? `${type} · ${subtype}` : String(type || '')),
  issuedDayOf: (row) => dayOf(row.Issue_Date),
  numberOf: (row) => cleanText(row.Project_File_Number),
  toPermit: (row) => snohomishPermit(row),
  emptyError: (since) => `Snohomish County’s monthly reports have no residential or commercial permits issued since ${since} — the county may not have posted the latest report yet`
};
