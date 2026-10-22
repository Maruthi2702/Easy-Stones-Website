/**
 * Every source's reader, by source id (2026-10-14) — what server.js hands
 * the morning pull (sync.js). A new source adds its reader here and its rules
 * in src/permits/rules/ under the same id.
 *
 * Server-only.
 */
import { createWhatcomSource, createRentonSource, createEnergovSource } from './sources/energov.js';
import { SKAGIT_PORTAL, SKAGIT_TENANT } from './rules/skagitCounty.js';
import { SNOHOMISH_CITY_PORTAL, SNOHOMISH_CITY_TENANT } from './rules/snohomishCity.js';
import { createAnacortesSource } from './sources/anacortes.js';
import { createSnohomishCountySource } from './sources/snohomishCounty.js';
import { createMonroeSource } from './sources/monroe.js';
import { createPierceCountySource } from './sources/pierceCounty.js';
import { createBellinghamSource } from './sources/bellingham.js';
import { createSeattleSource } from './sources/seattle.js';
import { createBellevueSource } from './sources/bellevue.js';
import { createShorelineSource } from './sources/shoreline.js';
import { MARYSVILLE_SEARCH, MARYSVILLE_COLUMNS } from './rules/marysville.js';
import { createMbpClient, createMbpSource } from './sources/mbp.js';
import { createKingParcels } from './sources/kingParcels.js';
import kingCounty from './rules/kingCounty.js';
import bellevue from './rules/bellevue.js';
import { MBP_CITIES } from './rules/mbpCities.js';
import { SNOHOMISH_MBP_CITIES } from './rules/snohomishCities.js';

export function createPermitReaders() {
  // One MyBuildingPermit session for every office it serves.
  const mbp = createMbpClient();
  const mbpOffice = (rule, extra = {}) => createMbpSource({ client: mbp, jurisId: rule.jurisId, office: rule.office, label: rule.label, stampsTime: Boolean(rule.stampsTime), ...extra });
  return {
    king_county: mbpOffice(kingCounty, { places: createKingParcels() }),
    ...Object.fromEntries([...MBP_CITIES, ...SNOHOMISH_MBP_CITIES].map((rule) => [rule.id, mbpOffice(rule)])),
    // MyBuildingPermit's list and people, the city's own record for value and owner.
    bellevue: createBellevueSource({ mbp: mbpOffice(bellevue) }),
    seattle: createSeattleSource(),
    renton: createRentonSource(),
    shoreline: createShorelineSource(),
    // Marysville's eTRAKiT is Shoreline's page with its own export columns.
    marysville: createShorelineSource({ url: MARYSVILLE_SEARCH, label: 'Marysville', columns: MARYSVILLE_COLUMNS }),
    pierce_county: createPierceCountySource(),
    skagit_county: createEnergovSource({ name: 'Skagit County', tenant: SKAGIT_TENANT, base: SKAGIT_PORTAL }),
    anacortes: createAnacortesSource(),
    snohomish_county: createSnohomishCountySource(),
    monroe: createMonroeSource(),
    snohomish_city: createEnergovSource({ name: 'City of Snohomish', tenant: SNOHOMISH_CITY_TENANT, base: SNOHOMISH_CITY_PORTAL, modern: true }),
    whatcom: createWhatcomSource(),
    bellingham: createBellinghamSource()
  };
}
