import type { Loose } from '../types/records.ts';
/**
 * Every source's reader, by source id (2026-10-14) — what server.ts hands
 * the morning pull (sync.js). A new source adds its reader here and its rules
 * in src/permits/rules/ under the same id.
 *
 * Server-only.
 */
import { createWhatcomSource, createRentonSource, createEnergovSource } from './sources/energov.ts';
import { SKAGIT_PORTAL, SKAGIT_TENANT } from './rules/skagitCounty.ts';
import { SNOHOMISH_CITY_PORTAL, SNOHOMISH_CITY_TENANT } from './rules/snohomishCity.ts';
import { createAnacortesSource } from './sources/anacortes.ts';
import { createSnohomishCountySource } from './sources/snohomishCounty.ts';
import { createMonroeSource } from './sources/monroe.ts';
import { createPierceCountySource } from './sources/pierceCounty.ts';
import { createTacomaSource } from './sources/tacoma.ts';
import { createBellinghamSource } from './sources/bellingham.ts';
import { createSeattleSource } from './sources/seattle.ts';
import { createBellevueSource } from './sources/bellevue.ts';
import { createShorelineSource } from './sources/shoreline.ts';
import { MARYSVILLE_SEARCH, MARYSVILLE_COLUMNS } from './rules/marysville.ts';
import { createMbpClient, createMbpSource } from './sources/mbp.ts';
import { createKingParcels } from './sources/kingParcels.ts';
import kingCounty from './rules/kingCounty.ts';
import bellevue from './rules/bellevue.ts';
import { MBP_CITIES } from './rules/mbpCities.ts';
import { SNOHOMISH_MBP_CITIES } from './rules/snohomishCities.ts';

export function createPermitReaders() {
  // One MyBuildingPermit session for every office it serves.
  const mbp = createMbpClient();
  const mbpOffice = (rule: Loose, extra: Loose = {}) => createMbpSource({ client: mbp, jurisId: rule.jurisId, office: rule.office, label: rule.label, stampsTime: Boolean(rule.stampsTime), ...extra });
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
    tacoma: createTacomaSource(),
    skagit_county: createEnergovSource({ name: 'Skagit County', tenant: SKAGIT_TENANT, base: SKAGIT_PORTAL }),
    anacortes: createAnacortesSource(),
    snohomish_county: createSnohomishCountySource(),
    monroe: createMonroeSource(),
    snohomish_city: createEnergovSource({ name: 'City of Snohomish', tenant: SNOHOMISH_CITY_TENANT, base: SNOHOMISH_CITY_PORTAL, modern: true }),
    whatcom: createWhatcomSource(),
    bellingham: createBellinghamSource()
  };
}
