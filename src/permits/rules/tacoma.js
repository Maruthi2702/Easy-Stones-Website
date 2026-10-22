/**
 * City of Tacoma (Pierce County) — the permit layer the city publishes on its
 * open data hub, copied daily from its Accela system (2026-10-22). No login.
 * The layer gives one row per permit (numbers don't repeat), with an
 * **applicant name** (a homeowner, a contractor or a solar company — it
 * doesn't say which) and no phone or email.
 * Reader: src/permits/sources/tacoma.js.
 *
 * Tacoma's types are broad: "Building · Residential · Alteration" is
 * remodels, solar panels, windows and siding alike, so by the rule for broad
 * types it's filed as Other building, never guessed from the description.
 * "New Building" is a new building (a house, a backyard cottage). Mechanical,
 * plumbing, fire protection and demolitions are trades, not leads, and so is
 * everything that isn't a Building permit (utility, right-of-way, site, signs).
 * The layer's dates are calendar days stored as midnight UTC, so they're read as UTC.
 */
import { key, typeMap, typeSet, cleanText, dayOf, money, count, isFinalOnly, tidyContacts } from '../common.js';

export const TACOMA_LAYER = 'https://services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/accela_permit_data/FeatureServer/0';
export const TACOMA_FIELDS = Object.freeze([
  'objectid', 'permit_number', 'permit_type', 'permit_subtype', 'permit_category', 'current_status', 'application_date',
  'issued_date', 'applicant_name', 'address_line_1', 'zip', 'description', 'parcel_number', 'valuation', 'housing_units', 'link'
]);
export const TACOMA_PERMIT_TYPE = 'Building';
export const TACOMA_PORTAL = 'https://aca-prod.accela.com/TACOMA/Default.aspx';

/** subtype | category */
const TYPES = typeMap([
  [['Residential', 'New Building'], 'new_home'],
  [['Residential', 'Alteration'], 'building_other'],
  [['Commercial', 'New Building'], 'commercial_new'],
  [['Commercial', 'Alteration'], 'building_other']
]);
/** Trades and demolitions: deliberately not leads. */
const SKIPPED = typeSet([
  ['Residential', 'Mechanical'], ['Residential', 'Plumbing'], ['Residential', 'Fire Protection'], ['Residential', 'Demolition'],
  ['Commercial', 'Mechanical'], ['Commercial', 'Plumbing'], ['Commercial', 'Fire Protection'], ['Commercial', 'Demolition'],
  ['Mechanical', 'NA'], ['Plumbing', 'NA']
]);

const categoryFor = (subtype, category = '') => TYPES.get(key(subtype, category)) || null;

/** The link has an HTML-escaped "&". */
const unescapeLink = (url) => cleanText(url).replace(/&amp;/g, '&');

/** A Tacoma permit from one feature's attributes. */
export function tacomaPermit(attrs) {
  const description = cleanText(attrs.description);
  return {
    source: 'tacoma',
    permitNumber: cleanText(attrs.permit_number),
    externalId: attrs.objectid === null || attrs.objectid === undefined ? '' : String(attrs.objectid),
    category: categoryFor(attrs.permit_subtype, attrs.permit_category),
    type: cleanText(attrs.permit_subtype),
    subtype: cleanText(attrs.permit_category),
    status: cleanText(attrs.current_status),
    appliedOn: dayOf(attrs.application_date),
    issuedOn: dayOf(attrs.issued_date),
    finaledOn: null,
    expiresOn: null,
    address: cleanText(attrs.address_line_1),
    city: 'Tacoma',
    zip: cleanText(attrs.zip),
    parcel: cleanText(attrs.parcel_number),
    projectName: '',
    description,
    valuation: money(attrs.valuation),
    sqft: 0,
    units: count(attrs.housing_units),
    contacts: tidyContacts([{ role: 'Applicant', company: attrs.applicant_name }]),
    sourceUrl: unescapeLink(attrs.link),
    finalOnly: isFinalOnly(description)
  };
}

export default {
  id: 'tacoma',
  label: 'Tacoma',
  long: 'City of Tacoma',
  contactsNote: 'The applicant’s name (the city doesn’t publish phone or email)',
  issuer: 'City of Tacoma permit',
  county: 'pierce',
  checkHow: 'a second read of the city’s permit layer',
  siteLabel: 'Open on the city’s permit site',
  typeOf: (row) => [cleanText(row.permit_subtype), cleanText(row.permit_category)],
  categoryFor,
  isUnsorted: (type, subtype = '') => ['Residential', 'Commercial'].includes(cleanText(type)) && !categoryFor(type, subtype) && !SKIPPED.has(key(type, subtype)),
  typeLabel: (type, subtype = '') => ['Building', type, subtype].map((p) => String(p || '').trim()).filter((p) => p && p !== 'NA').join(' · '),
  issuedDayOf: (row) => dayOf(row.issued_date),
  numberOf: (row) => cleanText(row.permit_number),
  toPermit: (row) => tacomaPermit(row),
  emptyError: (since) => `Tacoma’s permit layer has no building permits issued since ${since} — the city’s copy may have stopped updating`
};
