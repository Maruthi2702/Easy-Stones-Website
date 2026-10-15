/**
 * City of Renton — Tyler EnerGov self-service (permitting.rentonwa.gov), the
 * same system and reader as Whatcom County, so contacts come with phone and
 * email. Renton publishes only broad building types ("Building -
 * Residential | RESIDENTIAL"), so its building permits are filed as Other
 * building. Reader: src/permits/sources/energov.js.
 */
import { key, typeMap, typeSet, cleanText, dayOf } from '../common.js';
import { energovPermit } from './whatcom.js';

export const RENTON_PORTAL = 'https://permitting.rentonwa.gov';
export const RENTON_TENANT = 'RentonWaProd';

const TYPES = typeMap([
  ['Building - Residential', 'building_other'],
  ['Building - Commercial', 'building_other'],
  ['Other Building Permits', 'building_other']
]);
const SKIPPED = typeSet(['Building - Demolition']);

const renton = {
  id: 'renton',
  label: 'Renton',
  long: 'City of Renton',
  contactsNote: 'Contractor, owner and applicant with phone and email',
  issuer: 'City of Renton permit',
  county: 'king',
  // Contacts come with their own phone and email.
  phones: true,
  siteLabel: 'Open on Renton’s permit site',
  checkHow: 'a second read of Renton’s permit search',
  detailConcurrency: 3,
  permitUrl: (caseId) => `${RENTON_PORTAL}/#/permit/${encodeURIComponent(caseId)}`,
  typeOf: (row) => [row.CaseType],
  categoryFor: (type) => TYPES.get(key(type)) || null,
  isUnsorted: (type) => /(^|\b)(Building|Mobile|Manufactured)\b/i.test(String(type || '')) && !TYPES.has(key(type)) && !SKIPPED.has(key(type)),
  typeLabel: (type) => String(type || ''),
  issuedDayOf: (row) => dayOf(row.IssueDate),
  numberOf: (row) => cleanText(row.CaseNumber),
  detailIdOf: (row) => row.CaseId,
  toPermit: (row, detail) => energovPermit(renton, row, detail),
  emptyError: (since, total) => `Renton returned no permits issued since ${since} (it reported ${total ?? 'no'} records in all)`,
  detailsError: (n) => `Renton wouldn’t open any of the ${n} permits’ details`
};

export default renton;
