import type { Loose } from '../../types/records.ts';
/**
 * City of Richland (Benton County) — Tyler EnerGov self-service, the same
 * system and reader as Renton, Skagit County and Whatcom (checked 2026-11-01;
 * the city moved to this portal on 2024-06-03). Contacts (contractor, owner,
 * applicant) come with phone and email, and so do valuation and square feet.
 * Reader: src/permits/sources/energov.ts.
 *
 * The city's types are exact names (CaseType); a building-looking type
 * nobody has sorted is reported. About 25 building leads a month.
 */
import { key, typeMap, typeSet, cleanText, dayOf } from '../common.ts';
import { energovPermit } from './whatcom.ts';

export const RICHLAND_PORTAL = 'https://selfservice.ci.richland.wa.us/energov_prod/selfservice';
export const RICHLAND_TENANT = 'RichlandWAProd';
export const richlandPermitUrl = (caseId: string | number) => `${RICHLAND_PORTAL}#/permit/${encodeURIComponent(caseId)}`;

const TYPES = typeMap([
  ['Single Family Dwelling', 'new_home'],
  ['Residential Accessory Dwelling Unit', 'adu'],
  ['Two Family Dwelling', 'multifamily'],
  ['Townhome', 'multifamily'],
  ['Residential Addition', 'addition'],
  ['Residential Remodel', 'remodel'],
  ['New Commercial Construction', 'commercial_new'],
  ['Tenant Improvement', 'commercial_remodel']
]);

/** Building types that are deliberately not leads: outbuildings, roofs, windows, siding, pools, walls, demolitions, change of use. */
const SKIPPED = typeSet([
  'Residential No Fee Accessory Structure', 'Commercial No Fee Accessory Structure', 'Detached Accessory Structure', 'Commercial or Residential Re-roof',
  'Window or Door Replacement', 'Siding Replacement', 'Swimming Pool/Hot Tub', 'Demolition', 'Commercial Change of Use', 'Factory Assembled Structure',
  'Residential Retaining Wall', 'Commercial Grading'
]);
// Building-looking types: a new one nobody has sorted is reported. Trades, fire, signs, right of way and legacy records are never leads.
const BUILDING = /^(residential|commercial|single family|two family|townhome|new commercial|tenant|detached|accessory|duplex|multi|modular|manufactured)/i;
const NOT_BUILDING = /mechanical|plumbing|fire|sign|right of way|legacy|utility|sewer|water/i;

const richland = {
  id: 'richland',
  label: 'Richland',
  long: 'City of Richland',
  contactsNote: 'Contractor, owner and applicant with phone and email',
  issuer: 'City of Richland permit',
  county: 'benton',
  phones: true,
  siteLabel: 'Open on the city’s permit site',
  checkHow: 'a second read of the city’s permit search',
  detailConcurrency: 3,
  permitUrl: richlandPermitUrl,
  typeOf: (row: Loose) => [cleanText(row.CaseType)],
  categoryFor: (type: string) => TYPES.get(key(type)) || null,
  isUnsorted: (type: string) => BUILDING.test(cleanText(type)) && !NOT_BUILDING.test(cleanText(type)) && !TYPES.has(key(type)) && !SKIPPED.has(key(type)),
  typeLabel: (type: string) => String(type || '').trim(),
  issuedDayOf: (row: Loose) => dayOf(row.IssueDate),
  numberOf: (row: Loose) => cleanText(row.CaseNumber),
  detailIdOf: (row: Loose) => row.CaseId,
  toPermit: (row: Loose, detail: Loose) => energovPermit(richland, row, detail),
  emptyError: (since: string, total: unknown) => `Richland returned no permits issued since ${since} (it reported ${total ?? 'no'} records in all)`,
  detailsError: (n: unknown) => `Richland wouldn’t open any of the ${n} permits’ details`
};

export default richland;
