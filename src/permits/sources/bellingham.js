/**
 * City of Bellingham's permits, from the permit layer the city publishes on
 * its ArcGIS server (the data behind its Development Dashboard). The city's
 * eTRAKiT permit search needs a contractor login, so this is the public copy.
 * Building permit types issued on or after `since`, read and counted by the
 * shared ArcGIS reader (arcgis.js).
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { isDay, dayOf } from '../common.js';
import { BELLINGHAM_LAYER, BELLINGHAM_FIELDS, BELLINGHAM_PERMIT_TYPES } from '../rules/bellingham.js';
import { createArcgisReader, sqlString } from './arcgis.js';

export const bellinghamWhere = (since) => {
  if (!isDay(since)) throw new Error(`Not a date: ${since}`);
  return `ISSUED >= DATE ${sqlString(since)} AND PermitType IN (${BELLINGHAM_PERMIT_TYPES.map(sqlString).join(', ')})`;
};

export function createBellinghamSource({ layer = BELLINGHAM_LAYER, ...opts } = {}) {
  const reader = createArcgisReader({ layer, name: 'Bellingham', fields: BELLINGHAM_FIELDS, where: bellinghamWhere, numberField: 'PERMIT_NO', ...opts });
  return {
    ...reader,
    async findByNumber(number) {
      const row = await reader.findByNumber(number);
      if (row && row.ISSUED !== null && !dayOf(row.ISSUED)) {
        throw new Error(`Bellingham returned an invalid issue date for ${number}`);
      }
      return row;
    }
  };
}
