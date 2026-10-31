import type { Loose } from '../../types/records.ts';
/**
 * Snohomish County cities, kept under the county filter (county 'snohomish').
 * Each is the city's own exact permit types, read the way its permit system
 * allows — Edmonds through MyBuildingPermit (rules/mbp.js), which also serves
 * its people (contractor with license number, applicant).
 *
 * Not here yet (checked 2026-10-20): Everett (eTRAKiT, search needs a login),
 * Bothell (MyBuildingPermit has only inspection records) — see CLAUDE.md.
 */
import { mbpRule } from './mbp.ts';

const city = (name: string, rest: unknown) => mbpRule({ label: name, long: `City of ${name}`, county: 'snohomish', office: name.toUpperCase(), city: name, ...rest });

// Edmonds writes "<kind>-<work>-<action>", cut off at 50 characters.
export const edmonds = city('Edmonds', {
  id: 'edmonds',
  jurisId: 23,
  // Edmonds stamps the time of issue, so a day is asked a day further (see mbp.js).
  stampsTime: true,
  types: [
    ['SINGLE FAMILY-NEW CONSTRUCTION-NEW', 'new_home'],
    ['SINGLE FAMILY-ACCESSORY DWELLING UNIT DETACHED-NEW', 'adu'],
    ['SINGLE FAMILY-ACCESSORY DWELLING UNIT ATTACHED-NEW', 'adu'],
    ['SINGLE FAMILY-ACCESSORY DWELLING UNIT ATTACHED-ADD', 'adu'],
    ['SINGLE FAMILY-ACCESSORY DWELLING UNIT ATTACHED-ALT', 'remodel'],
    ['SINGLE FAMILY-STRUCTURE ADDITION-ADDITION', 'addition'],
    ['SINGLE FAMILY-STRUCTURE ADDITION-ALTERATION', 'addition'],
    ['SINGLE FAMILY-REMODEL-ALTERATION', 'remodel'],
    ['MULTIFAMILY APARTMENT-NEW CONSTRUCTION-NEW', 'multifamily'],
    ['CONDOMINIUM-NEW CONSTRUCTION-NEW', 'multifamily'],
    ['MULTIFAMILY APARTMENT-REMODEL-ALTERATION', 'remodel'],
    ['CONDOMINIUM-REMODEL-ALTERATION', 'remodel'],
    ['COMMERCIAL-NEW CONSTRUCTION-NEW', 'commercial_new'],
    ['COMMERCIAL-REMODEL-ALTERATION', 'commercial_remodel'],
    ['COMMERCIAL-TENANT IMPROVEMENT-ALTERATION', 'commercial_remodel'],
    ['COMMERCIAL-CHANGE OF USE-NEW', 'commercial_remodel'],
    ['COMMERCIAL-CHANGE OF USE-OTHER', 'commercial_remodel']
  ],
  // Every building family less the work that never is a lead: trades, roofs, signs,
  // fences, demolitions, outbuildings, decks, garages, pools, walls, solar, adult
  // family homes, tanks, fire systems, wireless sites, paving and grading.
  building: /^(SINGLE FAMILY|MULTIFAMILY APARTMENT|CONDOMINIUM|COMMERCIAL)-(?!MECHANICAL|PLUMBING|ELECTRIC|RE-ROOF|SIGN|FENCE|DEMO|ACCESSORY STRUCTURE|DECK|GARAGE|POOL|RETAINING|SOLAR|MISCELLANEOUS|PARKING|COMMERCIAL FILL|PRIVATE PROPERTY|ADULT FAMILY HOME|TANK|FIRE)/i
});

export const SNOHOMISH_MBP_CITIES = Object.freeze([edmonds]);
