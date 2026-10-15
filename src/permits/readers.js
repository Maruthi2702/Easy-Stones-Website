/**
 * Every source's reader, by source id (2026-10-14) — what server.js hands
 * the morning pull (sync.js). A new source adds its reader here and its rules
 * in src/permits/rules/ under the same id.
 *
 * Server-only.
 */
import { createWhatcomSource, createRentonSource } from './sources/energov.js';
import { createBellinghamSource } from './sources/bellingham.js';
import { createSeattleSource } from './sources/seattle.js';
import { createBellevueSource } from './sources/bellevue.js';
import { createShorelineSource } from './sources/shoreline.js';
import { createMbpClient, createMbpSource } from './sources/mbp.js';
import { createKingParcels } from './sources/kingParcels.js';
import kingCounty from './rules/kingCounty.js';
import bellevue from './rules/bellevue.js';
import { MBP_CITIES } from './rules/mbpCities.js';

export function createPermitReaders() {
  // One MyBuildingPermit session for every office it serves.
  const mbp = createMbpClient();
  const mbpOffice = (rule, extra = {}) => createMbpSource({ client: mbp, jurisId: rule.jurisId, office: rule.office, label: rule.label, stampsTime: Boolean(rule.stampsTime), ...extra });
  return {
    king_county: mbpOffice(kingCounty, { places: createKingParcels() }),
    ...Object.fromEntries(MBP_CITIES.map((rule) => [rule.id, mbpOffice(rule)])),
    // MyBuildingPermit's list and people, the city's own record for value and owner.
    bellevue: createBellevueSource({ mbp: mbpOffice(bellevue) }),
    seattle: createSeattleSource(),
    renton: createRentonSource(),
    shoreline: createShorelineSource(),
    whatcom: createWhatcomSource(),
    bellingham: createBellinghamSource()
  };
}
