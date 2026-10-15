/**
 * King County cities read through MyBuildingPermit (rules/mbp.js), each with
 * its own permit types — the exact names its permits carry in the search's
 * results (checked 2026-10-14 against 45 days of each city's permits and its
 * own type list).
 *
 * Several cities publish only a broad type ("BUILDING", "BSF",
 * "RESIDENTIAL") covering new homes, remodels, decks and solar panels alike.
 * Those are filed as Other building, never guessed from the description.
 *
 * Not here, on purpose: Bellevue (its own, richer feed — rules/bellevue.js),
 * Federal Way (MyBuildingPermit returns none of its permits) and Bothell
 * (only inspection records) — see KNOWN_ISSUES.md / the Permits section of
 * CLAUDE.md.
 */
import { mbpRule } from './mbp.js';

const city = (name, rest) => mbpRule({ label: name, long: `City of ${name}`, county: 'king', office: name.toUpperCase(), city: name, ...rest });

export const auburn = city('Auburn', {
  id: 'auburn',
  jurisId: 24,
  types: [
    ['ADDITION', 'addition'],
    ['Tenant Improvement', 'commercial_remodel'],
    ['BUILDING', 'building_other'],
    // Solar panels and re-roofs as well as remodels.
    ['ALTERATIONS', 'building_other']
  ],
  // CONSTRUCTION is right-of-way work (utility digs, tree removal), not building.
  skipped: ['CONSTRUCTION', 'ADULT FAMILY HOME'],
  building: /^(BUILDING|ADDITION|ALTERATION|TENANT|RESIDENTIAL|COMMERCIAL|DWELLING|ADU)/i
});

export const burien = city('Burien', {
  id: 'burien',
  jurisId: 11,
  types: [
    ['Residential - New', 'new_home'],
    ['Residential-Detached Accessory Dwelling', 'adu'],
    ['Residential - Addition', 'addition'],
    ['Residential - Remodel', 'remodel'],
    ['Multi-Family/Commercial - New', 'commercial_new'],
    ['Multi-Family/Commercial - Remodel/Tenant', 'commercial_remodel']
  ],
  skipped: [
    'Residential - Electric', 'Residential - Mechanical', 'Residential - Plumbing', 'Residential - Low Voltage',
    'Residential - Re-Roof', 'Residential - Deck - New', 'Residential - Garage/Carport',
    'Multi-Family/Commercial - Electric', 'Multi-Family/Commercial - Low Voltage', 'Multi-Family/Commercial - Plumbing',
    'Multi-Family/Commercial - Mechanical', 'Multi-Family/Commercial - Re-Roof', 'Multi-Family/Commercial - Land Clearing',
    'Building - Demolition'
  ],
  building: /^(Residential|Multi-Family|Building)\b/i
});

export const issaquah = city('Issaquah', {
  id: 'issaquah',
  jurisId: 3,
  types: [['ADU', 'adu'], ['BUILDING', 'building_other']],
  skipped: ['ASDP NEW LEVEL 1', 'ASDP NEW LEVEL 2'],
  building: /^(BUILDING|ADU|RESIDENTIAL|COMMERCIAL)\b/i
});

export const kenmore = city('Kenmore', {
  id: 'kenmore',
  jurisId: 4,
  // ~40 permits a month of every kind: a quiet 30 days is possible.
  mayBeEmpty: true,
  types: [
    ['SINGLE FAMILY NEW', 'new_home'],
    ['SINGLE FAMILY ACCESSORY DWELLING UNIT', 'adu'],
    ['SINGLE FAMILY ADDITION', 'addition'],
    ['SINGLE FAMILY ADDITION AND ALTERATION', 'addition'],
    ['SINGLE FAMILY ALTERATION', 'remodel'],
    ['MULTI FAMILY NEW', 'multifamily'],
    ['MULTI FAMILY ALTERATION', 'remodel'],
    ['COMMERCIAL NEW', 'commercial_new'],
    ['COMMERCIAL ADDITION', 'commercial_remodel'],
    ['COMMERCIAL ADDITION AND ALTERATION', 'commercial_remodel'],
    ['COMMERCIAL TENANT IMPROVEMENT', 'commercial_remodel'],
    ['BUILDING', 'building_other']
  ],
  skipped: [
    'SINGLE FAMILY ACCESSORY STRUCTURE', 'SINGLE FAMILY DECK', 'SINGLE FAMILY DOCK OR PIER', 'SINGLE FAMILY MANUFACTURED HOME',
    'SINGLE FAMILY MOBILE', 'SINGLE FAMILY REPAIR', 'MULTI FAMILY ACCESSORY STRUCTURE', 'MULTI FAMILY REPAIR',
    'COMMERCIAL ACCESSORY STRUCTURE', 'COMMERCIAL CHANGE OF USE', 'COMMERCIAL DOCK OR PIER', 'COMMERCIAL EXTERIOR ALTERATION',
    'COMMERCIAL REPAIR', 'COMMERCIAL TEMPORARY STRUCTURE'
  ],
  building: /^(SINGLE FAMILY|MULTI FAMILY|COMMERCIAL|BUILDING)\b/i
});

export const kirkland = city('Kirkland', {
  id: 'kirkland',
  jurisId: 5,
  // B = building, then SF single family / MF multifamily / NR nonresidential.
  types: [['ADU', 'adu'], ['BSF', 'building_other'], ['BMF', 'building_other'], ['BNR', 'building_other']],
  building: /^(B[A-Z]{2}|ADU)$/i
});

export const mercerIsland = city('Mercer Island', {
  id: 'mercer_island',
  jurisId: 6,
  types: [['ADU', 'adu'], ['BUILDING', 'building_other']],
  building: /^(BUILDING|ADU|RESIDENTIAL|COMMERCIAL)\b/i
});

export const sammamish = city('Sammamish', {
  id: 'sammamish',
  jurisId: 7,
  types: [
    ['BLDG RESIDENTIAL - SINGLE FAMILY', 'new_home'],
    ['BLDG RESIDENTIAL - DUPLEX', 'new_home'],
    ['BLDG RESIDENTIAL - TOWNHOME', 'new_home'],
    ['BLDG RESIDENTIAL - COTTAGE', 'new_home'],
    ['BLDG RESIDENTIAL - REGISTERED PLAN', 'new_home'],
    ['BLDG RESIDENTIAL - ADU ATTACHED', 'adu'],
    ['BLDG RESIDENTIAL - ADU DETACHED', 'adu'],
    ['BLDG RESIDENTIAL - ADDITION', 'addition'],
    ['BLDG RESIDENTIAL - REMODEL/ALTERATION', 'remodel'],
    ['BLDG RESIDENTIAL - MULTIFAMILY', 'multifamily'],
    ['BLDG RESIDENTIAL - OTHER', 'building_other'],
    ['BLDG COMMERCIAL - ADDITION', 'commercial_remodel'],
    ['BLDG COMMERCIAL - REMODEL/TI', 'commercial_remodel'],
    ['BLDG COMMERCIAL - SCHOOL', 'building_other'],
    ['BLDG COMMERCIAL - STRUCTURES', 'building_other'],
    ['BLDG COMMERCIAL - OTHER', 'building_other']
  ],
  skipped: [
    'BLDG RESIDENTIAL - ACCESSORY STRUCTURE', 'BLDG RESIDENTIAL - DECK', 'BLDG RESIDENTIAL - GARAGE', 'BLDG RESIDENTIAL - GARAGE/CARPORT',
    'BLDG RESIDENTIAL - MOBILE/MANUFAC. HOME', 'BLDG RESIDENTIAL - PLAT', 'BLDG RESIDENTIAL - PLUBMING', 'BLDG RESIDENTIAL - PLUMBING',
    'BLDG RESIDENTIAL - POOL', 'BLDG RESIDENTIAL - REPAIR/DAMAGE', 'BLDG RESIDENTIAL - STRUCTURES', 'BLDG RESIDENTIAL - TYPE B -CONSTRUCTION',
    'BLDG RESIDENTIAL - MECHANICAL', 'BLDG RESIDENTIAL - DEMOLITION',
    'BLDG COMMERCIAL - NON BLDG STRUCTURE', 'BLDG COMMERCIAL - POOL', 'BLDG COMMERCIAL - TYPE B -CONSTRUCTION',
    'BLDG COMMERCIAL - COMM PLUMBING', 'BLDG COMMERCIAL - COMM MECHANICAL', 'BLDG COMMERCIAL - SIGN', 'BLDG COMMERCIAL - DEMOLITION',
    'BLDG COMMERCIAL - WIRELESS'
  ],
  building: /^BLDG (RESIDENTIAL|COMMERCIAL) - /i
});

export const snoqualmie = city('Snoqualmie', {
  id: 'snoqualmie',
  jurisId: 9,
  // ~15 permits a month of every kind: a quiet 30 days is possible.
  mayBeEmpty: true,
  types: [
    ['COM ADDITION', 'commercial_remodel'],
    ['RESIDENTIAL', 'building_other'],
    ['MULTI FAMILY RESIDENTIAL', 'building_other'],
    ['COMMERCIAL', 'building_other']
  ],
  building: /^(RESIDENTIAL|MULTI FAMILY|COMMERCIAL|COM |BUILDING|ADU)/i
});

export const MBP_CITIES = Object.freeze([auburn, burien, issaquah, kenmore, kirkland, mercerIsland, sammamish, snoqualmie]);
