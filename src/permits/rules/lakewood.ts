import type { Loose } from '../../types/records.ts';
/**
 * City of Lakewood (Pierce County) — the city's public permit portal, a
 * Clariti / OnCamino "Public Portal" (lakewood_wa.claritilaunch.com, checked
 * 2026-11-01). Its pages call a public GraphQL API with no login; the reader
 * (src/permits/sources/lakewood.ts) makes the same calls.
 *
 * The list gives a permit's number, address, type, status and the days it was
 * created and last changed — no issue date. That comes from the permit's
 * **status history** (the day it first became "Issued"). A permit's page adds
 * the project description, the applicant, owner and contractor **names** (no
 * phone or email; the WA L&I lookup supplies phones by contractor name), the
 * parcel and the number of units. No project value is published (the fees
 * include a "Building Valuation Fee", which is a fee, not a value).
 *
 * Only the "Building Applications" types are read (land use, engineering and
 * code enforcement aren't leads). Types are chosen by the city's exact names:
 * trades, re-roofs, windows, signs, gates, outbuildings, manufactured homes and
 * demolitions are skipped, and a building type nobody has sorted is reported.
 */
import { key, typeMap, typeSet, cleanText, dayOf, count, tidyContacts } from '../common.ts';

export const LAKEWOOD_API = 'https://api.app.oncamino.com/api/v1/graphql';
export const LAKEWOOD_ORG_ID = '450';
export const LAKEWOOD_PORTAL = 'https://lakewood_wa.claritilaunch.com';
/** The top of the city's type tree whose permits are read. */
export const LAKEWOOD_TYPE_ROOT = 'Building Applications';
/** Statuses a permit can have once it was issued (it may since have been finaled or closed). */
export const LAKEWOOD_ISSUED_STATUSES = Object.freeze(['Issued', 'Finaled', 'Closed', 'Closed-Bond Maintenance', 'Expired']);

/** class | type, as the city's tree names them under "Building Applications". */
const TYPES = typeMap([
  [['Residential', 'Single Family Home - New Construction'], 'new_home'],
  [['Residential', 'Accessory Dwelling Unit - ADU'], 'adu'],
  [['Residential', 'Major Remodel'], 'remodel'],
  [['Residential', 'Minor Remodel'], 'remodel'],
  [['Commercial', 'Major Tenant Improvement'], 'commercial_remodel'],
  [['Commercial', 'Minor Tenant Improvement'], 'commercial_remodel'],
  // The city's one broad commercial type: new, addition or remodel can't be told apart.
  [['Commercial', 'Commercial Building'], 'building_other']
]);
/** Deliberately not leads: trades, roofs, windows, water heaters, signs, gates, fences, outbuildings, manufactured homes, demolitions, solar, walls, pools, paperwork. */
const SKIPPED = typeSet([
  ['Residential', 'Mechanical'], ['Residential', 'Plumbing'], ['Residential', 'Re-Roof'], ['Residential', 'Window/Door Replacement (Like for Like)'],
  ['Residential', 'Gas Water Heater (Like for Like)'], ['Residential', 'Electric Water Heater (Like for Like)'],
  ['Residential', 'Heating, Ventilation, Air Conditioning (HVAC) - Like for Like'], ['Residential', 'Accessory Structure'],
  ['Residential', 'Manufactured/Mobile Home'], ['Residential', 'Adult Family Home'], ['Residential', 'Demolition'], ['Residential', 'Gate'],
  ['Residential', 'Solar/Energy Storage Systems'], ['Residential', 'Retaining Wall/Bulkhead'], ['Residential', 'Swimming Pool'],
  ['Commercial', 'Mechanical'], ['Commercial', 'Plumbing'], ['Commercial', 'Re-Roof'], ['Commercial', 'Permanent Sign'], ['Commercial', 'Demolition'],
  ['Commercial', 'Gate'], ['Commercial', 'Electric Fence'], ['Commercial', 'Retaining Wall'], ['Commercial', 'Factory Assembled Structure'],
  ['Commercial', 'Change of Use or Occupancy']
]);

const categoryFor = (klass: string, type = '') => TYPES.get(key(klass, type)) || null;

/** The class and type under the root: ["Building Applications", "Residential", "Minor Remodel"] → ["Residential", "Minor Remodel"]. */
export const typeTail = (tree: unknown): [string, string] => {
  const parts = (Array.isArray(tree) ? tree : []).map(cleanText).filter(Boolean);
  const rest = parts[0] === LAKEWOOD_TYPE_ROOT ? parts.slice(1) : parts;
  return [rest[0] || '', rest[1] || ''];
};

/** Some addresses come with the city on the end: "12721 BRIDGEPORT WAY SW, Lakewood, WA 98499". */
export function splitAddress(value: unknown) {
  const text = cleanText(value);
  const m = text.match(/^(.*?),\s*[A-Za-z .'-]+,\s*WA\s*(\d{5})?(?:-\d{4})?$/i);
  return m ? { address: cleanText(m[1]), zip: m[2] || '' } : { address: text, zip: '' };
}

/** "GEORGE SEBERINA (OWNER)" is the owner building their own project. */
const ownerAsContractor = (name: string) => /\(\s*owner\s*\)\s*$/i.test(name);

/**
 * A Lakewood permit from a list row (`{ id, number, address, tree, status, createdOn, issuedOn }`)
 * and, once its page was read, the detail (`{ description, applicant, owner, contractor, sqft, units, parcel, expiresOn }`).
 * Without the detail those fields are left unset, so a save keeps what an earlier read found.
 */
export function lakewoodPermit(row: Loose, detail: Loose | null = null) {
  const [klass, type] = typeTail(row.tree);
  const contractor = cleanText(detail?.contractor);
  const selfBuilt = ownerAsContractor(contractor);
  const where = splitAddress(row.address);
  const contacts = detail ? tidyContacts([
    { role: 'Contractor', company: selfBuilt ? '' : contractor },
    { role: 'Owner', name: selfBuilt ? contractor.replace(/\(\s*owner\s*\)\s*$/i, '') : detail.owner },
    { role: 'Applicant', name: detail.applicant }
  ]) : undefined;
  return {
    source: 'lakewood',
    permitNumber: cleanText(row.number),
    externalId: cleanText(row.id),
    category: categoryFor(klass, type),
    type: klass,
    subtype: type,
    status: cleanText(row.status),
    appliedOn: dayOf(row.createdOn),
    issuedOn: row.issuedOn || null,
    finaledOn: null,
    expiresOn: detail ? dayOf(detail.expiresOn) : undefined,
    address: where.address,
    city: 'Lakewood',
    zip: where.zip,
    parcel: detail ? cleanText(detail.parcel) : undefined,
    projectName: '',
    description: detail ? cleanText(detail.description) : undefined,
    valuation: null,
    sqft: detail ? count(detail.sqft) : undefined,
    units: detail ? count(detail.units) : undefined,
    contacts,
    sourceUrl: row.id ? `${LAKEWOOD_PORTAL}/submissions/${encodeURIComponent(row.id)}` : '',
    finalOnly: false
  };
}

export default {
  id: 'lakewood',
  label: 'Lakewood',
  long: 'City of Lakewood',
  contactsNote: 'Contractor, owner and applicant names (the city’s portal has no phone or email)',
  issuer: 'City of Lakewood permit',
  county: 'pierce',
  siteLabel: 'Open on the city’s permit portal',
  checkHow: 'a second read of the city’s public permit portal',
  detailConcurrency: 3,
  // Lakewood issues a few dozen building permits a month; a quiet window is possible.
  mayBeEmpty: true,
  typeOf: (row: Loose) => typeTail(row.tree),
  categoryFor,
  isUnsorted: (klass: string, type = '') => ['Residential', 'Commercial'].includes(cleanText(klass)) && !categoryFor(klass, type) && !SKIPPED.has(key(klass, type)),
  typeLabel: (klass: string, type = '') => [klass, type].map((p) => String(p || '').trim()).filter(Boolean).join(' · '),
  issuedDayOf: (row: Loose) => row.issuedOn || null,
  numberOf: (row: Loose) => cleanText(row.number),
  detailIdOf: (row: Loose) => cleanText(row.id),
  toPermit: (row: Loose, detail: Loose | null = null) => lakewoodPermit(row, detail),
  emptyError: (since: string) => `Lakewood’s portal has no building permits issued since ${since}`,
  detailsError: (n: unknown) => `Lakewood’s portal wouldn’t open any of the ${n} permits’ details`
};
