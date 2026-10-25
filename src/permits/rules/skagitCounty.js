/**
 * Skagit County (outside its cities) — Tyler EnerGov self-service, the same
 * system and reader as Whatcom County and Renton (2026-10-21). Contacts (the
 * general contractor, owner, applicant) come with phone and email. The
 * county's public search is the only source: no monthly report to check it
 * against was found (the old reports page now redirects to the new site).
 * Reader: src/permits/sources/energov.js.
 *
 * The county's other offices — Anacortes and Mount Vernon (SmartGov),
 * Burlington (email), Sedro-Woolley (paper) — publish nothing we can read.
 */
import { key, typeMap, typeSet, cleanText, dayOf } from '../common.js';
import { energovPermit } from './whatcom.js';

export const SKAGIT_PORTAL = 'https://skagitcountywa-energovweb.tylerhost.net/apps/selfservice';
export const SKAGIT_TENANT = 'skagitcountywa';
export const skagitPermitUrl = (caseId) => `${SKAGIT_PORTAL}#/permit/${encodeURIComponent(caseId)}`;

/** EnerGov's CaseType (its work class is in the name already). */
const TYPES = typeMap([
  ['Single Family Residence', 'new_home'],
  ['Modular Building', 'new_home'],
  ['Accessory Dwelling Unit', 'adu'],
  ['Residential Addition', 'addition'],
  ['Residential Alteration', 'remodel'],
  ['Residential Duplex/Townhouse', 'multifamily'],
  ['Commercial New Building', 'commercial_new'],
  ['Commercial Alteration', 'commercial_remodel'],
  ['Commercial Addition', 'commercial_remodel']
]);

/**
 * Building types that are deliberately not leads (owner's call 2026-10-21):
 * shops, garages and other outbuildings, manufactured homes, trades, signs,
 * gates and fuel tanks.
 */
const SKIPPED = typeSet([
  'Residential Accessory Building', 'Residential Accessory Structures', 'Commercial Accessory Structures',
  'Commercial Accessory Buildings', 'Residential Manufactured Home', 'Manufactured Home Title Elimination',
  'Demolition Permit', 'Residential Mechanical', 'Commercial Mechanical Permit', 'Residential Water Heater Replacement',
  'Residential Fire Sprinklers', 'Commercial Fire Protection System', 'Commercial Fire Alarm Systems',
  'Residential Fuel Tank', 'Residential Gate Installation', 'Commercial Gate Installation', 'Commercial Sign', 'Special Event or Temporary Tent',
  'Wireless Facility Eligibility Determination'
]);
// Building-looking types: a new one nobody has sorted is reported. Septic, wells,
// burn, flood, utility, access and land-disturbance permits are never building work.
const NOT_BUILDING = /septic|well|water system|rain catchment|burn|flood|utility|storm drain|access|land disturb|firework|fire /i;
const BUILDING = /^(residential|commercial|single family|accessory|modular|duplex)/i;

const skagitCounty = {
  id: 'skagit_county',
  label: 'Skagit County',
  long: 'Skagit County (outside city limits)',
  contactsNote: 'Contractor, owner and applicant with phone and email',
  issuer: 'Skagit County permit',
  county: 'skagit',
  kind: 'county',
  phones: true,
  siteLabel: 'Open on the county’s permit site',
  checkHow: 'a second read of the county’s permit search',
  detailConcurrency: 3,
  permitUrl: skagitPermitUrl,
  typeOf: (row) => [cleanText(row.CaseType)],
  categoryFor: (type) => TYPES.get(key(type)) || null,
  isUnsorted: (type) => BUILDING.test(cleanText(type)) && !NOT_BUILDING.test(cleanText(type)) && !TYPES.has(key(type)) && !SKIPPED.has(key(type)),
  typeLabel: (type) => String(type || '').trim(),
  issuedDayOf: (row) => dayOf(row.IssueDate),
  numberOf: (row) => cleanText(row.CaseNumber),
  detailIdOf: (row) => row.CaseId,
  toPermit: (row, detail) => energovPermit(skagitCounty, row, detail),
  emptyError: (since, total) => `Skagit County returned no permits issued since ${since} (it reported ${total ?? 'no'} records in all)`,
  detailsError: (n) => `Skagit County wouldn’t open any of the ${n} permits’ details`
};

export default skagitCounty;
