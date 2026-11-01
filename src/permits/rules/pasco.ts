import type { Loose } from '../../types/records.ts';
/**
 * City of Pasco (Franklin County) — the city's eTRAKiT permit search, now
 * hosted by CentralSquare (pas.csqrcloud.com/community-etrakit), which anyone
 * can run without an account, read through its "Export to Excel" (a CSV:
 * permit number, address, status, contractor, type and sub type, parcel,
 * owner, applicant, issued / applied / expired / finaled dates, job value,
 * description). It is the same eTRAKiT page as Shoreline's and Marysville's,
 * so the reader is Shoreline's (src/permits/sources/shoreline.ts) with
 * Pasco's column names (checked 2026-11-01).
 *
 * The export has no phone or email, and its address is blank on some permits.
 * Pasco is the busiest Tri-Cities source for new houses (about 45 in six weeks).
 */
import { key, typeMap, typeSet, cleanText, dayOf, tidyContacts, money, nameKey } from '../common.ts';

export const PASCO_SEARCH = 'https://pas.csqrcloud.com/community-etrakit/Search/permit.aspx';
/** Pasco's export column names (Shoreline's differ). */
export const PASCO_COLUMNS = Object.freeze({ number: 'PERMIT_NO', issued: 'ISSUED', type: 'PERMITTYPE' });

/** Permit type | sub type, as the city writes them. */
const TYPES = typeMap([
  [['RESIDENTIAL NEW CONSTRUCTION', 'SFDU'], 'new_home'],
  [['RESIDENTIAL NEW CONSTRUCTION', 'TOWNHOUSE'], 'multifamily'],
  [['RESIDENTIAL', 'ACCESSORY DWELLING'], 'adu'],
  [['RESIDENTIAL ADDITION', 'SINGLE FAMILY DWELLING UNIT'], 'addition'],
  [['RESIDENTIAL REMODEL', 'SINGLE FAMILY DWELLING UNIT'], 'remodel'],
  [['RESIDENTIAL', 'MAJOR ALTER/REPAIR'], 'remodel'],
  [['RESIDENTIAL', 'MINOR ALTER/REPAIR'], 'remodel'],
  [['COMMERCIAL', 'MULTI-FAMILY'], 'multifamily'],
  [['COMMERCIAL', 'MAJOR ALTER/REPAIR'], 'commercial_remodel'],
  [['COMMERCIAL', 'MINOR ALTER/REPAIR'], 'commercial_remodel'],
  [['COMMERCIAL TENANT IMPROVEMENTS', ''], 'commercial_remodel']
]);

/** Building types that are deliberately not leads: outbuildings, garages, demolitions, signs. */
const SKIPPED = typeSet([
  ['RESIDENTIAL', 'ACCESSORY STRUCTURES'], ['RESIDENTIAL', 'DEMOLITION'], ['RESIDENTIAL', 'DETACHED GARAGE/SHOP'],
  ['COMMERCIAL', 'ACCESSORY STRUCTURES'], ['COMMERCIAL', 'SIGN']
]);
/** Which of the city's types are building work at all, so a new one nobody has sorted is reported. */
const BUILDING = /^(RESIDENTIAL|COMMERCIAL)/i;
const NOT_BUILDING = /MECHANICAL|PLUMB|WINDOWS|WATER|RIGHT|CIVIL|FIRE|SIGN|ACCESSORY STRUCTURE/i;

const categoryFor = (type: string, subtype = '') => TYPES.get(key(type, subtype)) || null;

/** "INFORMATION PROVIDED AT A LATER DATE", "OWNER BUILDER" and "NONE" are the form's placeholders, not a company. */
const realName = (name: unknown) => (/^(none|n\/a|owner[ -]?builder|information provided at a later date)$/i.test(cleanText(name)) ? '' : cleanText(name));

/** A Pasco permit from one row of the search's export. */
export function pascoPermit(row: Loose) {
  const contractor = realName(row.CONTRACTOR_NAME);
  const applicant = realName(row.APPLICANT_NAME);
  const owner = realName(row.OWNER_NAME);
  return {
    source: 'pasco',
    permitNumber: cleanText(row.PERMIT_NO),
    externalId: cleanText(row.RECORDID),
    category: categoryFor(row.PERMITTYPE, row.PERMITSUBTYPE),
    type: cleanText(row.PERMITTYPE),
    subtype: cleanText(row.PERMITSUBTYPE),
    status: cleanText(row.STATUS),
    appliedOn: dayOf(row.APPLIED),
    issuedOn: dayOf(row.ISSUED),
    finaledOn: dayOf(row.FINALED),
    expiresOn: dayOf(row.EXPIRED),
    address: cleanText(row.SITE_ADDR),
    city: 'Pasco',
    zip: '',
    parcel: cleanText(row.SITE_APN),
    projectName: '',
    description: cleanText(row.DESCRIPTION),
    valuation: money(row.JOBVALUE),
    sqft: null,
    units: null,
    // The owner often applies themselves, and builders apply for their own permits: one line each, not two.
    contacts: tidyContacts([
      { role: 'Contractor', company: contractor },
      ...(owner && nameKey(owner) !== nameKey(contractor) ? [{ role: 'Owner', name: owner }] : []),
      ...(applicant && nameKey(applicant) !== nameKey(contractor) && nameKey(applicant) !== nameKey(owner) ? [{ role: 'Applicant', name: applicant }] : [])
    ]),
    sourceUrl: '',
    finalOnly: false
  };
}

export default {
  id: 'pasco',
  label: 'Pasco',
  long: 'City of Pasco',
  contactsNote: 'Contractor, owner and applicant names (the city’s public search doesn’t show phone or email)',
  issuer: 'City of Pasco permit',
  county: 'franklin',
  checkHow: 'a second read of the city’s permit search',
  lookup: {
    url: PASCO_SEARCH,
    label: 'Look it up on the City of Pasco’s permit site',
    note: 'Search by permit number — no account needed.'
  },
  typeOf: (row: Loose) => [row.PERMITTYPE, row.PERMITSUBTYPE],
  categoryFor,
  isUnsorted: (type: string, subtype = '') => BUILDING.test(cleanText(type)) && !NOT_BUILDING.test(cleanText(type))
    && !categoryFor(type, subtype) && !SKIPPED.has(key(type, subtype)),
  typeLabel: (type: string, subtype = '') => (subtype ? `${type} · ${subtype}` : String(type || '')),
  issuedDayOf: (row: Loose) => dayOf(row.ISSUED),
  numberOf: (row: Loose) => cleanText(row.PERMIT_NO),
  toPermit: (row: Loose) => pascoPermit(row),
  emptyError: (since: string) => `Pasco’s permit search found no permits issued since ${since}`
};
