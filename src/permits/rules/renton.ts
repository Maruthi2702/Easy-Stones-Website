import type { Loose } from '../../types/records.ts';
/**
 * City of Renton — Tyler EnerGov self-service (permitting.rentonwa.gov), the
 * same system and reader as Whatcom County, so contacts come with phone and
 * email. Renton publishes only broad building types ("Building -
 * Residential | RESIDENTIAL"), so its building permits are filed as Other
 * building. Reader: src/permits/sources/energov.ts.
 */
import { key, typeMap, typeSet, cleanText, dayOf } from '../common.ts';
import { energovPermit } from './whatcom.ts';

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
  permitUrl: (caseId: string | number) => `${RENTON_PORTAL}/#/permit/${encodeURIComponent(caseId)}`,
  typeOf: (row: Loose) => [row.CaseType],
  categoryFor: (type: string) => TYPES.get(key(type)) || null,
  isUnsorted: (type: string) => /(^|\b)(Building|Mobile|Manufactured)\b/i.test(String(type || '')) && !TYPES.has(key(type)) && !SKIPPED.has(key(type)),
  typeLabel: (type: string) => String(type || ''),
  issuedDayOf: (row: Loose) => dayOf(row.IssueDate),
  numberOf: (row: Loose) => cleanText(row.CaseNumber),
  detailIdOf: (row: Loose) => row.CaseId,
  toPermit: (row: Loose, detail: Loose) => energovPermit(renton, row, detail),
  emptyError: (since: string, total: unknown) => `Renton returned no permits issued since ${since} (it reported ${total ?? 'no'} records in all)`,
  detailsError: (n: unknown) => `Renton wouldn’t open any of the ${n} permits’ details`
};

export default renton;
