/**
 * Clark County (Vancouver and the county's other cities) — the "Permits -
 * Building" layer on the county's ArcGIS server (2026-10-22), one layer for
 * every office in the county. No login. The county refreshes Clark County and
 * Vancouver weekly and the other cities (Camas, Battle Ground, Ridgefield…)
 * only quarterly, so those can be months behind. Reader:
 * src/permits/sources/clarkCounty.js.
 *
 * The layer has the case type, work type, status, issued date, a name (the
 * applicant: a person, a builder or an architect — it doesn't say which) and
 * the parcel's serial number, but **no address**: the reader looks each
 * lead's address and city up by serial number in the county's address layer
 * (`address`, `city`, `zip` below). No phone, email, value or size.
 *
 * Case types: RES (residential — work type NEWBLDG, ADDITION, REMODEL…),
 * NHC (new home construction, a free-text description in place of a work
 * type), SFR (the old single-family type), CMI (commercial, industrial and
 * multifamily). Re-roofs, solar, sign, rack, cell and inspection-only permits
 * are not leads. Everything else the layer holds (electrical, mechanical,
 * plumbing, land use, engineering, demolition, boilers) is never asked for.
 */
import { key, typeMap, typeSet, cleanText, tidyContacts } from '../common.js';
import { pacificDay } from './pierceCounty.js';

export const CLARK_LAYER = 'https://gis.clark.wa.gov/arcgisfed2/rest/services/MapCatalog/Permitting/MapServer/4';
export const CLARK_ADDRESS_LAYER = 'https://gis.clark.wa.gov/arcgisfed2/rest/services/MapCatalog/Addressing/MapServer/1';
export const CLARK_FIELDS = Object.freeze(['OBJECTID', 'caseno', 'case_type', 'CaseType', 'WorkType', 'sn', 'name', 'status', 'issued']);
export const CLARK_CASE_TYPES = Object.freeze(['RES', 'NHC', 'SFR', 'CMI']);

/** case_type | WorkType */
const TYPES = typeMap([
  [['RES', 'NEWBLDG'], 'new_home'],
  [['RES', 'ADDITION'], 'addition'],
  [['RES', 'REMODEL'], 'remodel'],
  [['RES', 'ADD/REM'], 'remodel'],
  [['NHC', ''], 'new_home'],
  [['SFR', ''], 'new_home'],
  [['CMI', 'NEWBLDG'], 'commercial_new'],
  [['CMI', 'TI'], 'commercial_remodel'],
  [['CMI', 'REMODEL'], 'commercial_remodel'],
  [['CMI', 'ADDITION'], 'commercial_remodel']
]);
const SKIPPED = typeSet([
  ['RES', 'REROOF'], ['RES', 'INSPONLY'], ['RES', 'INSPADULT'], ['RES', 'SOLAR'],
  ['CMI', 'SIGN'], ['CMI', 'REROOF'], ['CMI', 'INSPONLY'], ['CMI', 'RACK'], ['CMI', 'CELLCOLOC']
]);

const categoryFor = (type, subtype = '') => TYPES.get(key(type, subtype)) || null;

/**
 * The address a lead shows, from the county's address points for its parcel:
 * the parcel's main address (no building letter or unit) when it has one.
 * `points` are address-layer attributes for one serial number.
 */
export function clarkAddress(points = []) {
  const list = points.filter((p) => p && p.StName);
  if (!list.length) return null;
  const main = list.find((p) => !cleanText(p.Unit) && !cleanText(p.Building)) || list[0];
  const street = [main.HsNbr, cleanText(main.HsSub), cleanText(main.StDir), cleanText(main.StName), cleanText(main.Stype)].filter((p) => p !== null && p !== undefined && String(p).trim() !== '').join(' ');
  const title = (s) => cleanText(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return {
    address: [street, main.Unit && !cleanText(main.Building) ? `#${cleanText(main.Unit)}` : ''].filter(Boolean).join(' '),
    city: title(main.USPS_CITY),
    zip: main.Zip ? String(main.Zip) : '',
    jurisdiction: title(main.Jurisdiction)
  };
}

/** A Clark permit from one feature's attributes (the reader adds `_address` from clarkAddress). */
export function clarkPermit(attrs) {
  const where = attrs._address || {};
  const type = cleanText(attrs.case_type);
  const subtype = cleanText(attrs.WorkType);
  // An NHC permit's CaseType is the applicant's own words ("New Single-Family Construction – 1740 SF…").
  const description = type === 'NHC' || type === 'SFR' ? cleanText(attrs.CaseType) : '';
  return {
    source: 'clark_county',
    permitNumber: cleanText(attrs.caseno),
    externalId: attrs.OBJECTID === null || attrs.OBJECTID === undefined ? '' : String(attrs.OBJECTID),
    category: categoryFor(type, subtype),
    type,
    subtype,
    status: cleanText(attrs.status),
    appliedOn: null,
    issuedOn: pacificDay(attrs.issued),
    finaledOn: null,
    expiresOn: null,
    address: where.address || '',
    city: where.city || '',
    zip: where.zip || '',
    parcel: attrs.sn === null || attrs.sn === undefined ? '' : String(attrs.sn),
    projectName: '',
    description,
    valuation: null,
    sqft: 0,
    units: 0,
    contacts: tidyContacts([{ role: 'Applicant', company: attrs.name }]),
    sourceUrl: '',
    finalOnly: false
  };
}

export default {
  id: 'clark_county',
  label: 'Clark County',
  long: 'Clark County, Vancouver and its other cities',
  contactsNote: 'The applicant’s name (the county doesn’t publish phone or email)',
  issuer: 'Clark County permit',
  county: 'clark',
  kind: 'county',
  checkHow: 'a second read of the county’s permit layer',
  typeOf: (row) => [cleanText(row.case_type), cleanText(row.WorkType)],
  categoryFor,
  isUnsorted: (type, subtype = '') => CLARK_CASE_TYPES.includes(cleanText(type)) && !categoryFor(type, subtype) && !SKIPPED.has(key(type, subtype)),
  typeLabel: (type, subtype = '') => ({ RES: 'Residential', NHC: 'New home', SFR: 'Single family', CMI: 'Commercial / multifamily' }[type] || String(type || '')) + (subtype ? ` · ${subtype}` : ''),
  issuedDayOf: (row) => pacificDay(row.issued),
  numberOf: (row) => cleanText(row.caseno),
  toPermit: (row) => clarkPermit(row),
  emptyError: (since) => `Clark County’s permit layer has no building permits issued since ${since} — the county’s copy may have stopped updating`
};
