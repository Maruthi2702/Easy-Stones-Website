import type { Loose } from '../../types/records.ts';
/**
 * City of Kennewick (Benton County) — Tyler EnerGov self-service, the same
 * system and reader as Richland, Renton and Skagit County (checked 2026-11-01;
 * the tenant is the portal's default "EnerGov_Prod"). Contacts come with phone
 * and email, and so do valuation and square feet.
 * Reader: src/permits/sources/energov.ts.
 *
 * The city's types are exact names (CaseType); a building-looking type
 * nobody has sorted is reported. The city's "Alteration/Addition" types don't
 * say which of the two a permit is, so they're filed as Other building (the
 * broad-type rule), never guessed from the description. "Express" types are
 * the city's fast track for the same work. About 30 building leads a month.
 */
import { key, typeMap, typeSet, cleanText, dayOf } from '../common.ts';
import { energovPermit } from './whatcom.ts';

export const KENNEWICK_PORTAL = 'https://selfservice.ci.kennewick.wa.us/EnerGov_Prod/selfservice';
export const KENNEWICK_TENANT = 'EnerGov_Prod';
export const kennewickPermitUrl = (caseId: string | number) => `${KENNEWICK_PORTAL}#/permit/${encodeURIComponent(caseId)}`;

const TYPES = typeMap([
  ['Detached Single Family Dwelling', 'new_home'],
  ['Residential - Express Single Family Dwelling', 'new_home'],
  ['Attached Single Family Dwelling', 'multifamily'],
  ['Residential - Alteration/Addition', 'building_other'],
  ['Residential - Express Alteration/Addition', 'building_other'],
  ['Commercial - New', 'commercial_new'],
  ['Commercial - Alteration No Site Plan', 'commercial_remodel'],
  ['Commercial - Express Alteration No Site Plan', 'commercial_remodel'],
  ['Commercial - Alteration w/Site Plan', 'commercial_remodel']
]);

/** Building types that are deliberately not leads: roofs, windows, siding, trades, outbuildings, decks, fences, pools, walls, demolitions, foundations alone, adult family homes. */
const SKIPPED = typeSet([
  'Residential - Reroof', 'Residential - Windows', 'Residential - Siding/Stucco', 'Residential - Mechanical', 'Residential - Plumbing',
  'Commercial - Mechanical', 'Commercial - Plumbing', 'Residential - Pool/Spa', 'Residential - Adult Family Home', 'Residential - Retaining Walls',
  'Residential - Express Retaining Walls', 'Commercial Retaining Wall', 'Residential - Express Accessory Structure', 'Residential - Accessory Structure',
  'Residential - Express Pole Building', 'Residential - Express Deck', 'Residential - Deck', 'Commercial - Demo', 'Commercial - Foundation Only',
  'Commercial - Fence', 'Grading Permit'
]);
// Building-looking types: a new one nobody has sorted is reported. Trades, fire, signs, public works and utility connections are never leads.
const BUILDING = /^(residential - |commercial - |detached|attached|commercial retaining)/i;
const NOT_BUILDING = /public works|fire|sign|right-of-way|water\/sewer|sewer connection|parade|fireworks|hydrant|grading/i;

const kennewick = {
  id: 'kennewick',
  label: 'Kennewick',
  long: 'City of Kennewick',
  contactsNote: 'Contractor, owner and applicant with phone and email',
  issuer: 'City of Kennewick permit',
  county: 'benton',
  phones: true,
  siteLabel: 'Open on the city’s permit site',
  checkHow: 'a second read of the city’s permit search',
  detailConcurrency: 3,
  permitUrl: kennewickPermitUrl,
  typeOf: (row: Loose) => [cleanText(row.CaseType)],
  categoryFor: (type: string) => TYPES.get(key(type)) || null,
  isUnsorted: (type: string) => BUILDING.test(cleanText(type)) && !NOT_BUILDING.test(cleanText(type)) && !TYPES.has(key(type)) && !SKIPPED.has(key(type)),
  typeLabel: (type: string) => String(type || '').trim(),
  issuedDayOf: (row: Loose) => dayOf(row.IssueDate),
  numberOf: (row: Loose) => cleanText(row.CaseNumber),
  detailIdOf: (row: Loose) => row.CaseId,
  toPermit: (row: Loose, detail: Loose) => energovPermit(kennewick, row, detail),
  emptyError: (since: string, total: unknown) => `Kennewick returned no permits issued since ${since} (it reported ${total ?? 'no'} records in all)`,
  detailsError: (n: unknown) => `Kennewick wouldn’t open any of the ${n} permits’ details`
};

export default kennewick;
