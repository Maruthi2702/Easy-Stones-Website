/**
 * Pierce County (outside its cities) — the permit layer the county publishes
 * on ArcGIS, fed from its PALS+ system (2026-10-22). No login. The layer has
 * the type, status, valuation, units, square feet, address and description,
 * and a link to the permit in the county's portal, but **no contractor, owner
 * or applicant** — so a Pierce lead has no contact (`contactsNote`). Permits
 * without a valid parcel are left out of the layer by the county.
 * Reader: src/permits/sources/pierceCounty.js.
 *
 * Leads follow Skagit's rule (owner's call 2026-10-21): garages, decks and
 * sheds, farm buildings, pools, retaining walls, cell towers, utility and
 * other structures, and demolitions are not leads. "Replacement Permit" is
 * not sorted yet, so it's reported on the page.
 *
 * The county's cities (Tacoma, Lakewood, Puyallup, Bonney Lake…) run their own
 * permit offices and are not in this layer (not yet checked city by city).
 */
import { key, typeMap, typeSet, cleanText, money, count, isFinalOnly } from '../common.js';

export const PIERCE_LAYER = 'https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/ArcGIS/rest/services/Permits_Pierce_County/FeatureServer/0';
export const PIERCE_FIELDS = Object.freeze([
  'OBJECTID', 'applicationNumber', 'applicationType', 'applicationStatus', 'parcelNumber', 'workType', 'buildingType',
  'housingType', 'sqFtTotal', 'buildingValuation', 'dwellingUnits', 'projectValue', 'issuedDate', 'finalDate',
  'applicationDate', 'workDescription', 'siteAddress', 'projectName', 'urlOnlinePermits'
]);
/** The layer's building department, as it spells it, and the two building permit types. */
export const PIERCE_DEPT = '*BUILDING*';
export const PIERCE_APPLICATION_TYPES = Object.freeze(['Construction Residential', 'Construction Commercial']);

const RESIDENTIAL = 'Construction Residential';
const COMMERCIAL = 'Construction Commercial';

/** The buildings that are deliberately not leads, whatever the work type. */
const SKIPPED_BUILDINGS = typeSet([
  'Garage', 'Deck/Dock/Shed', 'Agriculture', 'Swimming Pool', 'Bulkhead/Retaining Wall', 'Cell Tower',
  'Public Utility Structure', 'Other Structure'
]);
const SKIPPED_WORK = typeSet(['Demolition']);
const DWELLINGS = ['House/plex', 'Adult Family Home'];

const TYPES = typeMap([
  [[RESIDENTIAL, 'New Structure', 'House/plex'], 'new_home'],
  [[RESIDENTIAL, 'Addition', 'House/plex'], 'addition'],
  [[RESIDENTIAL, 'Remodel', 'House/plex'], 'remodel'],
  [[RESIDENTIAL, 'Remodel', 'Adult Family Home'], 'remodel'],
  [[COMMERCIAL, 'New Structure', 'Townhouse'], 'multifamily'],
  [[COMMERCIAL, 'New Structure', 'Townhouse - Residential'], 'multifamily'],
  [[COMMERCIAL, 'New Structure', 'Apartment'], 'multifamily']
]);

/** What the layer says for each permit is three fields; the pull's (type, subtype) are application type and "work · building". */
export const pierceSubtype = (workType, buildingType) => {
  const work = cleanText(workType);
  const building = cleanText(buildingType);
  return work || building ? `${work} · ${building}` : '';
};
const split = (subtype) => String(subtype || '').split(' · ');

function categoryFor(type, subtype = '') {
  const [work = '', building = ''] = split(subtype);
  const t = cleanText(type);
  if (SKIPPED_BUILDINGS.has(key(building)) || SKIPPED_WORK.has(key(work))) return null;
  const exact = TYPES.get(key(t, work, building));
  if (exact) return exact;
  if (t === COMMERCIAL) {
    if (/^new structure$/i.test(work)) return 'commercial_new';
    if (/^(remodel|tenant improvement|addition)$/i.test(work)) return 'commercial_remodel';
  }
  return null;
}

/** A Pierce permit from one feature's attributes. */
export function piercePermit(attrs) {
  const type = cleanText(attrs.applicationType);
  const subtype = pierceSubtype(attrs.workType, attrs.buildingType);
  const description = cleanText(attrs.workDescription);
  return {
    source: 'pierce_county',
    permitNumber: attrs.applicationNumber === null || attrs.applicationNumber === undefined ? '' : String(attrs.applicationNumber),
    externalId: attrs.OBJECTID === null || attrs.OBJECTID === undefined ? '' : String(attrs.OBJECTID),
    category: categoryFor(type, subtype),
    type,
    subtype,
    status: cleanText(attrs.applicationStatus),
    appliedOn: pacificDay(attrs.applicationDate),
    issuedOn: pacificDay(attrs.issuedDate),
    finaledOn: pacificDay(attrs.finalDate),
    expiresOn: null,
    address: cleanText(attrs.siteAddress),
    // The layer carries no city or ZIP; its permits are outside city limits.
    city: '',
    zip: '',
    parcel: cleanText(attrs.parcelNumber),
    projectName: cleanText(attrs.projectName),
    description,
    valuation: money(attrs.buildingValuation) || money(attrs.projectValue),
    sqft: count(attrs.sqFtTotal),
    units: count(attrs.dwellingUnits),
    contacts: [],
    sourceUrl: cleanText(attrs.urlOnlinePermits),
    finalOnly: isFinalOnly(description)
  };
}

/** ArcGIS sends dates as milliseconds (UTC); the county's day is Pacific. */
export function pacificDay(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : null;
}

export default {
  id: 'pierce_county',
  label: 'Pierce County',
  long: 'Pierce County (outside city limits)',
  contactsNote: 'No contact: the county’s published data has no contractor, owner or applicant',
  issuer: 'Pierce County permit',
  county: 'pierce',
  kind: 'county',
  siteLabel: 'Open on the county’s permit site',
  checkHow: 'a second read of the county’s permit layer',
  typeOf: (row) => [cleanText(row.applicationType), pierceSubtype(row.workType, row.buildingType)],
  categoryFor,
  // A building type nobody has sorted: a dwelling or commercial permit that is neither a lead nor skipped.
  isUnsorted: (type, subtype = '') => {
    const [work = '', building = ''] = split(subtype);
    if (!PIERCE_APPLICATION_TYPES.includes(cleanText(type))) return false;
    if (SKIPPED_BUILDINGS.has(key(building)) || SKIPPED_WORK.has(key(work))) return false;
    return !categoryFor(type, subtype);
  },
  typeLabel: (type, subtype = '') => [type, ...split(subtype)].map((p) => String(p || '').trim()).filter(Boolean).join(' · '),
  issuedDayOf: (row) => pacificDay(row.issuedDate),
  numberOf: (row) => (row.applicationNumber === null || row.applicationNumber === undefined ? '' : String(row.applicationNumber)),
  toPermit: (row) => piercePermit(row),
  emptyError: (since) => `Pierce County’s permit layer has no building permits issued since ${since} — the county’s copy may have stopped updating`
};
