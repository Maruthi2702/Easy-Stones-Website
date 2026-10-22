/**
 * Kitsap County (outside its cities) — the permit layer behind the county's
 * "Permit Explorer" map, on its ArcGIS server (2026-10-22). No login. Type,
 * status, value, units, square feet, site address, parcel and a link to the
 * permit in the county's SmartGov portal, but **no contractor, owner or
 * applicant** (the project name is often the owner's surname — kept as the
 * project name, never as a contact). The layer is the county's own Department
 * of Community Development: unincorporated land and its urban growth areas.
 * The cities (Bremerton, Port Orchard, Poulsbo, Bainbridge Island) have their
 * own offices and aren't in it. The county refreshes the layer in batches
 * (last edit 2026-10-12 when checked), so it can run days behind.
 * Reader: src/permits/sources/kitsapCounty.js.
 *
 * Leads follow Skagit's rule (owner's call 2026-10-21): garages and accessory
 * buildings, decks, porches, foundations, walls, manufactured homes and parks,
 * re-roofs, demolitions, trades and signs are not leads. ADUs and guest houses
 * are (ADU / detached). Anything else under the four new/alter/add
 * sub-categories nobody has sorted (R-SFR/REPLACE, R-AFH…) is reported.
 */
import { key, typeMap, typeSet, cleanText, dayOf, money, count, isFinalOnly } from '../common.js';

export const KITSAP_LAYER = 'https://services6.arcgis.com/qt3UCV9x5kB4CwRA/arcgis/rest/services/Permit_Activity_DCD_Permits_view/FeatureServer/0';
export const KITSAP_FIELDS = Object.freeze([
  'ObjectId', 'Permit_Number', 'Parcel_No', 'Permit_Status', 'Permit_Type', 'Permit_Type_Description', 'Permit_SubCategory',
  'Project_Name', 'Site_Address', 'Date_Submitted', 'DateIssued', 'DateFinaled', 'SmartGovlink', 'Value', 'Department',
  'Jurisdiction', 'Units', 'StructureUnits', 'Squarefootage'
]);
export const KITSAP_DEPARTMENTS = Object.freeze(['RESIDENTIAL', 'COMMERCIAL']);

/** Permit_SubCategory | Permit_Type */
const TYPES = typeMap([
  [['Res - New Construction', 'R-SFR'], 'new_home'],
  [['Res - New Construction', 'R-SFR/USING BASIC'], 'new_home'],
  [['Res - New Construction', 'R-SFR/TOWNHOME'], 'multifamily'],
  [['Res - New Construction', 'R-MULTI-DUPX'], 'multifamily'],
  [['Res - New Construction', 'C-MULTI 3+'], 'multifamily'],
  [['Res - New Construction', 'R-SFR/ADU'], 'adu'],
  [['Res - New Construction', 'R-SFR/ADU-A'], 'adu'],
  [['Res - New Construction', 'R-SFR/ADU-D'], 'adu'],
  [['Res - Other Construction', 'R-GUEST HOUSE'], 'adu'],
  [['Res - Alter/Reno/Add', 'R-SFR/ADD'], 'addition'],
  [['Res - Alter/Reno/Add', 'R-SFR/REMODEL-MAJOR'], 'remodel'],
  [['Res - Alter/Reno/Add', 'R-SFR/REMODEL-MINOR'], 'remodel'],
  [['Comm - New Construction', 'C-CHURCH'], 'commercial_new'],
  [['Comm - New Construction', 'C-EDUCATION'], 'commercial_new'],
  [['Comm - New Construction', 'C-INDUST/AUTO'], 'commercial_new'],
  [['Comm - New Construction', 'C-MIXED'], 'commercial_new'],
  [['Comm - Alter/Reno/Add', 'C-TENANT IMPROVEMENT'], 'commercial_remodel']
]);

/** Building work under the four sub-categories that is deliberately not a lead. */
const SKIPPED = typeSet([
  ['Res - New Construction', 'MH-LOT'], ['Res - New Construction', 'MH-ADU'],
  ['Res - Alter/Reno/Add', 'R-REROOF AND/OR RESIDING'], ['Res - Alter/Reno/Add', 'R-SFR/DAM'], ['Res - Alter/Reno/Add', 'R-SFR/MOVED'],
  ['Comm - Alter/Reno/Add', 'C-REROOF AND/OR RESIDING'], ['Comm - Alter/Reno/Add', 'C-TENANT CHANGE']
]);
const BUILDING_SUBCATEGORIES = typeSet(['Res - New Construction', 'Res - Alter/Reno/Add', 'Comm - New Construction', 'Comm - Alter/Reno/Add']);

const categoryFor = (subcategory, type = '') => TYPES.get(key(subcategory, type)) || null;

/** A Kitsap permit from one feature's attributes. */
export function kitsapPermit(attrs) {
  const description = cleanText(attrs.Permit_Type_Description);
  return {
    source: 'kitsap_county',
    permitNumber: cleanText(attrs.Permit_Number),
    externalId: attrs.ObjectId === null || attrs.ObjectId === undefined ? '' : String(attrs.ObjectId),
    category: categoryFor(attrs.Permit_SubCategory, attrs.Permit_Type),
    type: cleanText(attrs.Permit_SubCategory),
    subtype: cleanText(attrs.Permit_Type),
    status: cleanText(attrs.Permit_Status),
    appliedOn: dayOf(attrs.Date_Submitted),
    issuedOn: dayOf(attrs.DateIssued),
    finaledOn: null,
    expiresOn: null,
    address: cleanText(attrs.Site_Address),
    // The layer has no city or ZIP; its jurisdiction is the county's own land.
    city: '',
    zip: '',
    parcel: cleanText(attrs.Parcel_No),
    projectName: cleanText(attrs.Project_Name),
    description,
    valuation: money(attrs.Value),
    sqft: count(attrs.Squarefootage),
    units: count(attrs.Units) || count(attrs.StructureUnits),
    contacts: [],
    sourceUrl: cleanText(attrs.SmartGovlink),
    finalOnly: isFinalOnly(description)
  };
}

export default {
  id: 'kitsap_county',
  label: 'Kitsap County',
  long: 'Kitsap County (outside city limits)',
  contactsNote: 'No contact: the county’s published data has no contractor, owner or applicant',
  issuer: 'Kitsap County permit',
  county: 'kitsap',
  kind: 'county',
  siteLabel: 'Open on the county’s permit site',
  checkHow: 'a second read of the county’s permit layer',
  typeOf: (row) => [cleanText(row.Permit_SubCategory), cleanText(row.Permit_Type)],
  categoryFor,
  isUnsorted: (type, subtype = '') => BUILDING_SUBCATEGORIES.has(key(type)) && !categoryFor(type, subtype) && !SKIPPED.has(key(type, subtype)),
  typeLabel: (type, subtype = '') => [type, subtype].map((p) => String(p || '').trim()).filter(Boolean).join(' · '),
  issuedDayOf: (row) => dayOf(row.DateIssued),
  numberOf: (row) => cleanText(row.Permit_Number),
  toPermit: (row) => kitsapPermit(row),
  emptyError: (since) => `Kitsap County’s permit layer has no building permits issued since ${since} — the county’s copy may have stopped updating`
};
