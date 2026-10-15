/**
 * City of Bellevue — read through MyBuildingPermit like the other cities
 * (office 1), with the city's own permit layer on ArcGIS Online
 * (Bellevue_Permit) read for each lead to add what MyBuildingPermit doesn't
 * show: the project's value, owner, dwelling units, floor area, ZIP and the
 * building's kind (SUBTYPE). Reader: src/permits/sources/bellevue.js.
 *
 * Why not the city's layer for the list itself: it lags on the permits that
 * matter most. Checked 2026-10-14 — new homes MyBuildingPermit shows as issued
 * on Oct 7 were still "Pending" with no issue date in the layer, while quick
 * over-the-counter permits were current. The layer's details are right; its
 * status isn't.
 *
 * Bellevue's permit type is a two-letter code (BS = Single Family New…).
 */
import { key, typeMap, typeSet, cleanText, dayOf, tidyContacts, money, count } from '../common.js';
import { mbpRule, mbpPermit } from './mbp.js';

export const BELLEVUE_LAYER = 'https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Bellevue_Permit/FeatureServer/0';
export const BELLEVUE_FIELDS = Object.freeze([
  'ObjectId', 'PERMITNUMBER', 'PERMITTYPE', 'PERMITTYPEDESCRIPTION', 'SUBTYPE', 'SITEADDRESS', 'CITY', 'ZIPCODE',
  'PERMITSTATUS', 'PARCELNUMBER', 'PROJECTNAME', 'PROJECTDESCRIPTION', 'APPLIEDDATE', 'ISSUEDDATE', 'FINALEDDATE',
  'EXPIREDATE', 'APPLICANT', 'OWNER', 'CONTRACTOR', 'VALUATION', 'DWELLINGUNITSCREATED', 'SQFOOTAGE1', 'MBPSTATUSSITE'
]);

const MULTIFAMILY = 'Multifamily Residential';

/** Lead codes; the big commercial projects split by SUBTYPE (apartments vs everything else). */
const TYPES = typeMap([
  ['BS', 'new_home'],              // Single Family New
  ['BR', 'addition'],              // Single Family Addition
  ['BU', 'remodel'],               // Single Family Remodel Plan Review
  // SF Remodel No Plan Review — over-the-counter work, re-roofs and windows included (checked 2026-10-14).
  ['BT', 'building_other'],
  ['BZ', 'commercial_remodel'],    // Tenant Improvement
  ['BY', 'commercial_remodel'],    // Tenant Improvement - New Use
  ['BW', 'commercial_remodel']     // Minor Commercial Project
]);
const BY_SUBTYPE = new Set(['BB', 'BM']);   // Major / Medium Commercial Project

/** Building codes that are never leads: trades, demolition, shoring, vaults, damage checks. */
const SKIPPED = ['BC', 'BE', 'BF', 'BG', 'BH', 'BK', 'BL', 'BN', 'BO', 'BV', 'DH'];
const SKIPPED_SET = typeSet(SKIPPED);

/** The category for a code; BB / BM by the building's kind, commercial until the layer says it's apartments. */
export function bellevueCategory(code, subtype = '') {
  const c = key(code);
  if (BY_SUBTYPE.has(c)) return key(subtype) === key(MULTIFAMILY) ? 'multifamily' : 'commercial_new';
  return TYPES.get(c) || null;
}

/**
 * What the city's layer adds to a permit read from MyBuildingPermit: only
 * fields MyBuildingPermit doesn't have, plus the owner (people there are the
 * contractor and applicant).
 */
export function bellevueFill(record) {
  if (!record) return {};
  return {
    subtype: cleanText(record.SUBTYPE),
    zip: cleanText(record.ZIPCODE).slice(0, 5),
    valuation: money(record.VALUATION),
    sqft: count(record.SQFOOTAGE1),
    units: count(record.DWELLINGUNITSCREATED),
    expiresOn: dayOf(record.EXPIREDATE),
    owner: cleanText(record.OWNER),
    typeName: cleanText(record.PERMITTYPEDESCRIPTION)
  };
}

const bellevue = mbpRule({
  id: 'bellevue',
  label: 'Bellevue',
  long: 'City of Bellevue',
  county: 'king',
  jurisId: 1,
  office: 'BELLEVUE',
  city: 'Bellevue',
  types: [...TYPES.keys()].map((code) => [code, TYPES.get(code)]).concat([['BB', 'commercial_new'], ['BM', 'commercial_new']]),
  skipped: SKIPPED,
  building: /^B[A-Z]$/,
  contactsNote: 'Contractor (with their WA license number), applicant and owner names; phone from the state’s contractor registry',
  checkHow: 'a second read of MyBuildingPermit, a day at a time'
});

bellevue.categoryFor = (code, subtype = '') => bellevueCategory(code, subtype);
bellevue.isUnsorted = (code) => /^B[A-Z]$/.test(key(code)) && !bellevueCategory(code) && !SKIPPED_SET.has(key(code));
bellevue.toPermit = (row, detail) => {
  const p = mbpPermit(bellevue, row, detail);
  if (!detail?.record) {
    // A big project's category comes from the city's record (apartments or
    // not); without it, a saved permit keeps the one it has and only a new
    // one starts as commercial.
    return BY_SUBTYPE.has(key(row.PermitType)) ? { ...p, category: undefined, categoryIfNew: p.category } : p;
  }
  const fill = bellevueFill(detail.record);
  return {
    ...p,
    category: bellevueCategory(row.PermitType, fill.subtype),
    type: fill.typeName ? `${fill.typeName} (${cleanText(row.PermitType)})` : p.type,
    subtype: fill.subtype,
    zip: fill.zip || p.zip,
    valuation: fill.valuation,
    sqft: fill.sqft,
    units: fill.units,
    expiresOn: fill.expiresOn,
    contacts: tidyContacts([...(p.contacts || []), { role: 'Owner', company: fill.owner }])
  };
};

export default bellevue;
