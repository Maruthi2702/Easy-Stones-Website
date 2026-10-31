import type { Loose } from '../../types/records.ts';
/**
 * City of Bellingham — the city's published permit layer on its ArcGIS
 * server (eTRAKiT needs a login). Contractor, owner and applicant names only.
 * Reader: src/permits/sources/bellingham.ts.
 */
import { key, typeMap, typeSet, cleanText, dayOf, tidyContacts, money, count, isFinalOnly } from '../common.ts';

/**
 * The city's own permit search (eTRAKiT). It needs a free city login
 * (anyone can register), and the login doesn't carry a permit number
 * through, so this opens the search, not the permit itself.
 */
export const BELLINGHAM_PERMIT_SEARCH = 'https://permits.cob.org/etrakit/Search/permit.aspx';

export const BELLINGHAM_LAYER = 'https://maps.cob.org/arcgis3/rest/services/Maps/Permits/MapServer/0';
export const BELLINGHAM_FIELDS = Object.freeze([
  'OBJECTID', 'PERMIT_NO', 'PermitType', 'PermitSubType', 'STATUS', 'APPLIED', 'ISSUED', 'FINALED', 'EXPIRED',
  'SITE_ADDR', 'SITE_APN', 'DESCRIPTION', 'JOBVALUE', 'OWNER_NAME', 'APPLICANT_NAME', 'CONTRACTOR_NAME',
  'TOTAL_FLOOR_AREA', 'NEW_FLOOR_AREA', 'NUM_NEW_UNITS', 'NEW_DWELL_UNITS', 'PARENT_PROJECT_NO'
]);

/** PermitType | PermitSubType. */
const TYPES = typeMap([
  [['NEW CONSTRUCTION SINGLE FAMILY OR DUPLEX', 'NEW STRUCTURE'], 'new_home'],
  [['NEW CONSTRUCTION TOWNHOME', 'NEW STRUCTURE'], 'new_home'],
  [['NEW CONSTRUCTION SINGLE FAMILY OR DUPLEX', 'ADU'], 'adu'],
  [['EXISTING SINGLE FAMILY OR DUPLEX', 'ADU'], 'adu'],
  [['EXISTING SINGLE FAMILY OR DUPLEX', 'ADDITION'], 'addition'],
  [['BUILDING MULTIFAMILY RESIDENTIAL', 'ADDITION'], 'addition'],
  [['EXISTING SINGLE FAMILY OR DUPLEX', 'INTERIOR REMODEL'], 'remodel'],
  [['BUILDING MULTIFAMILY RESIDENTIAL', 'INTERIOR REMODEL'], 'remodel'],
  [['BUILDING MULTIFAMILY RESIDENTIAL', 'NEW CONSTRUCTION'], 'multifamily'],
  [['BUILDING MIXED USE', 'NEW CONSTRUCTION'], 'multifamily'],
  [['BUILDING NONRESIDENTIAL', 'NEW CONSTRUCTION'], 'commercial_new'],
  [['BUILDING NONRESIDENTIAL', 'TENANT IMPROVEMENT'], 'commercial_remodel'],
  [['BUILDING MIXED USE', 'TENANT IMPROVEMENT'], 'commercial_remodel'],
  [['BUILDING NONRESIDENTIAL', 'ADDITION'], 'commercial_remodel'],
  [['BUILDING MIXED USE', 'ADDITION'], 'commercial_remodel']
]);

/** Building types that are deliberately not leads (repairs are windows, roofs, siding). */
const SKIPPED = typeSet([
  ['EXISTING SINGLE FAMILY OR DUPLEX', 'REPAIR'],
  ['EXISTING SINGLE FAMILY OR DUPLEX', 'FOUNDATION ONLY'],
  ['BUILDING MULTIFAMILY RESIDENTIAL', 'REPAIR'],
  ['BUILDING MULTIFAMILY RESIDENTIAL', 'UNDERGROUND STORMWATER FACILITY'],
  ['BUILDING NONRESIDENTIAL', 'REPAIR'],
  ['BUILDING NONRESIDENTIAL', 'UNDERGROUND STORMWATER FACILITY'],
  ['BUILDING MIXED USE', 'REPAIR'],
  ['BUILDING MIXED USE', 'UNDERGROUND STORMWATER FACILITY']
]);

/** The permit types worth asking the city's server for. */
export const BELLINGHAM_PERMIT_TYPES = Object.freeze([
  'NEW CONSTRUCTION SINGLE FAMILY OR DUPLEX',
  'NEW CONSTRUCTION TOWNHOME',
  'EXISTING SINGLE FAMILY OR DUPLEX',
  'BUILDING MULTIFAMILY RESIDENTIAL',
  'BUILDING MIXED USE',
  'BUILDING NONRESIDENTIAL'
]);

const categoryFor = (type: string, subtype = '') => TYPES.get(key(type, subtype)) || null;

/** A Bellingham permit from one feature's attributes. */
export function bellinghamPermit(attrs: Loose) {
  const contacts = [
    { role: 'Contractor', company: attrs.CONTRACTOR_NAME },
    { role: 'Owner', company: attrs.OWNER_NAME },
    { role: 'Applicant', company: attrs.APPLICANT_NAME }
  ];
  const description = cleanText(attrs.DESCRIPTION);
  return {
    source: 'bellingham',
    permitNumber: cleanText(attrs.PERMIT_NO),
    externalId: attrs.OBJECTID === null || attrs.OBJECTID === undefined ? '' : String(attrs.OBJECTID),
    category: categoryFor(attrs.PermitType, attrs.PermitSubType),
    type: cleanText(attrs.PermitType),
    subtype: cleanText(attrs.PermitSubType),
    status: cleanText(attrs.STATUS),
    appliedOn: dayOf(attrs.APPLIED),
    issuedOn: dayOf(attrs.ISSUED),
    finaledOn: dayOf(attrs.FINALED),
    expiresOn: dayOf(attrs.EXPIRED),
    address: cleanText(attrs.SITE_ADDR),
    city: 'Bellingham',
    zip: '',
    parcel: cleanText(attrs.SITE_APN),
    projectName: cleanText(attrs.PARENT_PROJECT_NO),
    description,
    valuation: money(attrs.JOBVALUE),
    sqft: count(attrs.NEW_FLOOR_AREA) || count(attrs.TOTAL_FLOOR_AREA),
    units: count(attrs.NUM_NEW_UNITS) || count(attrs.NEW_DWELL_UNITS),
    contacts: tidyContacts(contacts),
    sourceUrl: '',
    finalOnly: isFinalOnly(description)
  };
}

export default {
  id: 'bellingham',
  label: 'Bellingham',
  long: 'City of Bellingham',
  contactsNote: 'Contractor, owner and applicant names (the city doesn’t publish phone or email)',
  issuer: 'City of Bellingham permit',
  county: 'whatcom',
  checkHow: 'a separate query of the city’s data',
  lookup: {
    url: BELLINGHAM_PERMIT_SEARCH,
    label: 'Look it up on the City of Bellingham’s permit site',
    note: 'Bellingham permits aren’t on the county’s site. The city’s site needs a free login (anyone can register); then search for this permit number.'
  },
  typeOf: (row: Loose) => [row.PermitType, row.PermitSubType],
  categoryFor,
  isUnsorted: (type: string, subtype = '') => BELLINGHAM_PERMIT_TYPES.includes(key(type)) && !SKIPPED.has(key(type, subtype)),
  typeLabel: (type: string, subtype = '') => (subtype ? `${type} · ${subtype}` : String(type || '')),
  issuedDayOf: (row: Loose) => dayOf(row.ISSUED),
  numberOf: (row: Loose) => cleanText(row.PERMIT_NO),
  toPermit: (row: Loose) => bellinghamPermit(row),
  emptyError: (since: string) => `Bellingham’s permit data has no building permits issued since ${since} — the city’s copy may have stopped updating`
};
