import type { Loose } from '../../types/records.ts';
/**
 * City of Snohomish — Tyler EnerGov self-service (snohomishwa-energovpub.tylerhost.net),
 * the same system and reader as Whatcom County and Renton (`modern` mode: its detail and contacts are at different addresses), so each lead's
 * contractor, owner and applicant names come with it (no phone or email: this newer
 * version lists only names and roles). Reader:
 * src/permits/sources/energov.ts. (Not the county: that is
 * rules/snohomishCounty.js.)
 *
 * The city's types are broad where it matters ("Residential Addition/Alteration"
 * is both), so those are filed as remodels, and anything it doesn't say is
 * Other building.
 */
import { key, typeMap, typeSet, cleanText, dayOf } from '../common.ts';
import { energovPermit } from './whatcom.ts';

export const SNOHOMISH_CITY_PORTAL = 'https://snohomishwa-energovpub.tylerhost.net/apps/SelfService';
// The site hosts only this city and ignores the tenant header; Tyler's calls still send one.
export const SNOHOMISH_CITY_TENANT = 'SnohomishWAProd';

const TYPES = typeMap([
  ['Single-Family New Construction', 'new_home'],
  ['Accessory Dwelling Unit', 'adu'],
  ['Residential Addition/Alteration', 'remodel'],
  ['Commercial New Construction', 'commercial_new'],
  ['Commercial Addition/Alteration', 'commercial_remodel'],
  ['Tenant Improvement', 'commercial_remodel']
]);

/** Types that are deliberately not leads (trades, roofs, signs, utilities, landscape, fire, demolition, walls, fences, site work, wireless). */
const SKIPPED = typeSet([
  'Demolition, Accessory Structure', 'Demolition, Commercial', 'Fence Permit', 'Retaining Wall (Residential Type 2)',
  'Retaining Wall (Commercial Type 1)', 'Site Civil (Commercial/Multi-Family)', 'Plat (30+ lots) Site Civil',
  'Wireless Communications Facility Cat 1', 'Roof, Residential', 'Roof, Commercial'
]);
const NOT_BUILDING = /mechanical|plumbing|roof|sign|sewer|water|hydrant|fire|landscape|tree|right-of-way|demolition|fence|retaining|site civil|plat|wireless|electrical/i;
/** Types that look like building work, so one nobody has sorted is reported. */
const BUILDING = /single-family|multi-family|multifamily|townhouse|duplex|residential|commercial|accessory dwelling|tenant improvement|addition|alteration|new construction/i;

const snohomishCity = {
  id: 'snohomish_city',
  label: 'Snohomish (city)',
  long: 'City of Snohomish',
  contactsNote: 'Contractor, owner and applicant names (the city’s public search doesn’t show phone or email)',
  issuer: 'City of Snohomish permit',
  county: 'snohomish',
  siteLabel: 'Open on the city’s permit site',
  checkHow: 'a second read of the city’s permit search',
  detailConcurrency: 3,
  permitUrl: (caseId: string | number) => `${SNOHOMISH_CITY_PORTAL}/#/permit/${encodeURIComponent(caseId)}`,
  typeOf: (row: Loose) => [row.CaseType],
  categoryFor: (type: string) => TYPES.get(key(type)) || null,
  isUnsorted: (type: string) => BUILDING.test(cleanText(type)) && !NOT_BUILDING.test(cleanText(type)) && !TYPES.has(key(type)) && !SKIPPED.has(key(type)),
  typeLabel: (type: string) => String(type || ''),
  issuedDayOf: (row: Loose) => dayOf(row.IssueDate),
  numberOf: (row: Loose) => cleanText(row.CaseNumber),
  detailIdOf: (row: Loose) => row.CaseId,
  toPermit: (row: Loose, detail: Loose) => energovPermit(snohomishCity, row, detail),
  emptyError: (since: string, total: unknown) => `The City of Snohomish returned no permits issued since ${since} (it reported ${total ?? 'no'} records in all)`,
  detailsError: (n: unknown) => `The City of Snohomish wouldn’t open any of the ${n} permits’ details`,
  // ~40 permits a month of every kind: a quiet 30 days is possible.
  mayBeEmpty: true
};

export default snohomishCity;
