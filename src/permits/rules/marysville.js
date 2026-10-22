/**
 * City of Marysville — the city's eTRAKiT permit search (permits.marysvillewa.gov),
 * which anyone can run without an account, read through its "Export to Excel"
 * (a CSV: permit number, dates, type and sub type, parcel, address,
 * description, notes, job value, applicant and contractor names). It is the
 * same eTRAKiT page as Shoreline's, so the reader is Shoreline's
 * (src/permits/sources/shoreline.js) with Marysville's column names.
 *
 * The export has no phone or email. Marysville is one of the busiest sources
 * (about 100 new houses in a quarter), so the leads here are mostly new homes.
 */
import { key, typeMap, typeSet, cleanText, dayOf, tidyContacts, money, nameKey } from '../common.js';

export const MARYSVILLE_SEARCH = 'https://permits.marysvillewa.gov/Search/permit.aspx';
/** Marysville's export column names (Shoreline's differ). */
export const MARYSVILLE_COLUMNS = Object.freeze({ number: 'PERMIT_NO', issued: 'ISSUED', type: 'Permit Type' });

/** Permit type | sub type, as the city writes them. */
const TYPES = typeMap([
  [['RESIDENTIAL NEW', 'SINGLE FAMILY'], 'new_home'],
  [['RESIDENTIAL NEW', 'ACCESSORY DWELLING UNIT'], 'adu'],
  [['RESIDENTIAL NEW', 'DUPLEX'], 'multifamily'],
  // A new adult family home is a building, but the city files it apart from houses.
  [['RESIDENTIAL NEW', 'ADULT FAMILY'], 'building_other'],
  // A house built to a registered plan, and a bare "RESIDENTIAL | NEW" — new or not isn't said.
  [['RESIDENTIAL BASIC', ''], 'building_other'],
  [['RESIDENTIAL', 'NEW'], 'building_other'],
  [['RESIDENTIAL ADDITION', 'SINGLE FAMILY'], 'addition'],
  [['RESIDENTIAL REMODEL', 'SINGLE FAMILY'], 'remodel'],
  [['MULTI FAMILY APARTMENT NEW', ''], 'multifamily'],
  [['MULTI FAMILY TOWNHOME NEW', ''], 'multifamily'],
  [['COMMERCIAL NEW', ''], 'commercial_new'],
  [['COMMERCIAL TENANT IMPROVEMENT', ''], 'commercial_remodel']
]);

/** Building permit types that are deliberately not leads (the rest of the city's types aren't building at all). */
const SKIPPED = typeSet([
  ['RESIDENTIAL REMODEL', 'ADULT FAMILY HOME'],
  ['RESIDENTIAL ADULT FAMILY HOME NO CONSTRUCTION', ''],
  ['RESIDENTIAL DECKS', ''],
  // Gazebos and patio covers; and the city's unfilled "USE DROP DOWN TO SELECT" placeholder, which in
  // every permit seen (2026-10-21) was a $0 grinder pump — a future one that isn't should be looked at.
  ['RESIDENTIAL OTHER', 'COVERED PATIO OR DECK'],
  ['RESIDENTIAL OTHER', 'USE DROP DOWN TO SELECT'],
  ['RESIDENTIAL OUTBUILDING', 'SINGLE FAMILY'],
  ['RESIDENTIAL OUTBUILDING', 'MULTI-FAMILY'],
  ['RESIDENTIAL REPAIR', 'SINGLE FAMILY'],
  ['RESIDENTIAL REPAIR', 'DUPLEX'],
  ['RETAINING WALL', 'RESIDENTIAL'],
  ['DEMO', ''],
  // A manufactured home is set down, not built — skipped for the counties too.
  ['RESIDENTIAL MANUFACTURED HOME', ''],
  ['COMMERCIAL CERTIFICATE OF OCCUPANCY', ''],
  ['COMMERCIAL WCF AND CELL TOWERS', '']
]);
/** Which of the city's types are building work at all, so a new one nobody has sorted is reported. */
const BUILDING = /^(RESIDENTIAL|MULTI FAMILY|COMMERCIAL|TOWNHO|DUPLEX|ADU|ACCESSORY|RETAINING)/i;
const NOT_BUILDING = /ELECTRIC|MECHANICAL|PLUMB|REROOF|RE-ROOF|SIGN|FIRE|HYDRANT|SOLAR|UTILIT|RIGHT|BLS|LICENSE/i;

const categoryFor = (type, subtype = '') => TYPES.get(key(type, subtype)) || null;

/** A Marysville permit from one row of the search's export. */
export function marysvillePermit(row) {
  const contractor = cleanText(row.CONTRACTOR_NAME);
  const applicant = cleanText(row.APPLICANT_NAME);
  const description = [cleanText(row.DESCRIPTION), cleanText(row.NOTES)].filter(Boolean).join(' — ');
  return {
    source: 'marysville',
    permitNumber: cleanText(row.PERMIT_NO),
    externalId: cleanText(row.RECORDID),
    category: categoryFor(row['Permit Type'], row['Permit Sub Type']),
    type: cleanText(row['Permit Type']),
    subtype: cleanText(row['Permit Sub Type']),
    status: cleanText(row.STATUS),
    appliedOn: dayOf(row.APPLIED),
    issuedOn: dayOf(row.ISSUED),
    finaledOn: dayOf(row.FINALED),
    expiresOn: null,
    address: cleanText(row.SITE_ADDR),
    city: 'Marysville',
    zip: '',
    parcel: cleanText(row.SITE_APN),
    projectName: '',
    description,
    valuation: money(row.JOBVALUE),
    sqft: null,
    units: null,
    // Contractors often apply for their own permits; one line for them, not two.
    contacts: tidyContacts([
      { role: 'Contractor', company: contractor },
      ...(nameKey(applicant) && nameKey(applicant) === nameKey(contractor) ? [] : [{ role: 'Applicant', company: applicant }])
    ]),
    sourceUrl: '',
    finalOnly: false
  };
}

export default {
  id: 'marysville',
  label: 'Marysville',
  long: 'City of Marysville',
  contactsNote: 'Contractor and applicant names (the city’s public search doesn’t show phone or email)',
  issuer: 'City of Marysville permit',
  county: 'snohomish',
  checkHow: 'a second read of the city’s permit search',
  lookup: {
    url: MARYSVILLE_SEARCH,
    label: 'Look it up on the City of Marysville’s permit site',
    note: 'Search by permit number — no account needed.'
  },
  typeOf: (row) => [row['Permit Type'], row['Permit Sub Type']],
  categoryFor,
  isUnsorted: (type, subtype = '') => BUILDING.test(cleanText(type)) && !NOT_BUILDING.test(cleanText(type))
    && !categoryFor(type, subtype) && !SKIPPED.has(key(type, subtype)),
  typeLabel: (type, subtype = '') => (subtype ? `${type} · ${subtype}` : String(type || '')),
  issuedDayOf: (row) => dayOf(row.ISSUED),
  numberOf: (row) => cleanText(row.PERMIT_NO),
  toPermit: (row) => marysvillePermit(row),
  emptyError: (since) => `Marysville’s permit search found no permits issued since ${since}`
};
