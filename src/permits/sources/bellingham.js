/**
 * City of Bellingham's permits, from the permit layer the city publishes on
 * its ArcGIS server (the data behind its Development Dashboard). The city's
 * eTRAKiT permit search needs a contractor login, so this is the public copy.
 * Building permit types issued on or after `since`, read and counted by the
 * shared ArcGIS reader (arcgis.js).
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { isDay } from '../common.js';
import { BELLINGHAM_LAYER, BELLINGHAM_FIELDS, BELLINGHAM_PERMIT_TYPES } from '../rules/bellingham.js';
import { createArcgisReader, sqlString } from './arcgis.js';

export const bellinghamWhere = (since) => {
  if (!isDay(since)) throw new Error(`Not a date: ${since}`);
  return `ISSUED >= DATE ${sqlString(since)} AND PermitType IN (${BELLINGHAM_PERMIT_TYPES.map(sqlString).join(', ')})`;
};

export function createBellinghamSource({ layer = BELLINGHAM_LAYER, ...opts } = {}) {
  return createArcgisReader({ layer, name: 'Bellingham', fields: BELLINGHAM_FIELDS, where: bellinghamWhere, ...opts });
}
