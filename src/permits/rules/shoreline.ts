import type { Loose } from '../../types/records.ts';
/**
 * City of Shoreline — the city's eTRAKiT permit search, which anyone can run
 * without an account, read through its own "Export to Excel" (a CSV of the
 * results: permit number, dates, type, parcel, address, owner, applicant and
 * contractor names). No description, value or status — the city's search
 * doesn't show them without a login. Reader: src/permits/sources/shoreline.ts.
 *
 * Shoreline's building types are broad ("SINGLE FAMILY-COMPLEX"), so most are
 * filed as Other building; only its interior-remodel type says what it is.
 */
import { key, typeMap, typeSet, cleanText, dayOf, tidyContacts } from '../common.ts';

export const SHORELINE_SEARCH = 'https://permits.shorelinewa.gov/eTRAKiT/Search/permit.aspx';

const TYPES = typeMap([
  ['RESIDENTIAL INTERIOR REMODEL ONLINE', 'remodel'],
  ['SINGLE FAMILY-COMPLEX', 'building_other'],
  ['SINGLE FAMILY-SIMPLE', 'building_other'],
  ['MULTI-FAMILY', 'building_other'],
  ['COMMERCIAL', 'building_other']
]);
const SKIPPED = typeSet([
  'RESIDENTIAL REROOF ONLINE', 'RESIDENTIAL FOUNDATION REPAIR ONLINE', 'COMMERCIAL MECHANICAL-PLUMBING ONLINE',
  'MISC. STRUCTURE', 'DEMOLITION'
]);

const categoryFor = (type: string) => TYPES.get(key(type)) || null;

/** A Shoreline permit from one row of the search's export. */
export function shorelinePermit(row: Loose) {
  return {
    source: 'shoreline',
    permitNumber: cleanText(row['PERMIT NUMBER']),
    externalId: cleanText(row.RECORDID),
    category: categoryFor(row['Permit Type']),
    type: cleanText(row['Permit Type']),
    subtype: '',
    status: '',
    appliedOn: dayOf(row['APPLIED DATE']),
    issuedOn: dayOf(row['ISSUED DATE']),
    finaledOn: null,
    expiresOn: null,
    address: cleanText(row.ADDRESS),
    city: 'Shoreline',
    zip: '',
    parcel: cleanText(row.PARCEL),
    projectName: '',
    description: '',
    valuation: null,
    sqft: null,
    units: null,
    contacts: tidyContacts([
      { role: 'Contractor', company: row['CONTRACTOR NAME'] },
      { role: 'Owner', company: row['OWNER NAME'] },
      { role: 'Applicant', company: row['APPLICANT NAME'] }
    ]),
    sourceUrl: '',
    finalOnly: false
  };
}

export default {
  id: 'shoreline',
  label: 'Shoreline',
  long: 'City of Shoreline',
  contactsNote: 'Contractor, owner and applicant names (the city’s public search doesn’t show phone, email or the work described)',
  issuer: 'City of Shoreline permit',
  county: 'king',
  checkHow: 'a second read of the city’s permit search',
  lookup: {
    url: SHORELINE_SEARCH,
    label: 'Look it up on the City of Shoreline’s permit site',
    note: 'Search by permit number — no account needed to see its status.'
  },
  typeOf: (row: Loose) => [row['Permit Type']],
  categoryFor,
  isUnsorted: (type: string) => /SINGLE FAMILY|MULTI|^COMMERCIAL$|RESIDENTIAL|ADU|ACCESSORY|ADDITION|TENANT/i.test(cleanText(type))
    && !/MECHANICAL|PLUMBING|ELECTRIC|FIRE|SIGN/i.test(cleanText(type)) && !categoryFor(type) && !SKIPPED.has(key(type)),
  typeLabel: (type: string) => cleanText(type),
  issuedDayOf: (row: Loose) => dayOf(row['ISSUED DATE']),
  numberOf: (row: Loose) => cleanText(row['PERMIT NUMBER']),
  toPermit: (row: Loose) => shorelinePermit(row),
  emptyError: (since: string) => `Shoreline’s permit search found no permits issued since ${since}`
};
