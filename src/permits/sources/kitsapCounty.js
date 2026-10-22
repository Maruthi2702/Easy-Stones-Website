/**
 * Kitsap County's permits, from the layer behind the county's Permit Explorer
 * map. Residential and commercial permits issued on or after `since`, read and
 * counted by the shared ArcGIS reader (arcgis.js): the run fails unless the
 * rows received equal the count asked.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { isDay } from '../common.js';
import { KITSAP_LAYER, KITSAP_FIELDS, KITSAP_DEPARTMENTS } from '../rules/kitsapCounty.js';
import { createArcgisReader, sqlString } from './arcgis.js';

export const kitsapWhere = (since) => {
  if (!isDay(since)) throw new Error(`Not a date: ${since}`);
  return `DateIssued >= DATE ${sqlString(since)} AND Department IN (${KITSAP_DEPARTMENTS.map(sqlString).join(', ')})`;
};

export function createKitsapCountySource({ layer = KITSAP_LAYER, ...opts } = {}) {
  return createArcgisReader({ layer, name: 'Kitsap County', fields: KITSAP_FIELDS, where: kitsapWhere, idField: 'ObjectId', ...opts });
}
