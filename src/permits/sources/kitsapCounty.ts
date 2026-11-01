import type { Loose } from '../../types/records.ts';
/**
 * Kitsap County's permits, from the layer behind the county's Permit Explorer
 * map. Residential and commercial permits issued on or after `since`, read and
 * counted by the shared ArcGIS reader (arcgis.js): the run fails unless the
 * rows received equal the count asked.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { isDay } from '../common.ts';
import { KITSAP_LAYER, KITSAP_FIELDS, KITSAP_DEPARTMENTS } from '../rules/kitsapCounty.ts';
import { createArcgisReader, sqlString } from './arcgis.ts';

export const kitsapWhere = (since: string) => {
  if (!isDay(since)) throw new Error(`Not a date: ${since}`);
  return `DateIssued >= DATE ${sqlString(since)} AND Department IN (${KITSAP_DEPARTMENTS.map(sqlString).join(', ')})`;
};

export function createKitsapCountySource({ layer = KITSAP_LAYER, ...opts }: Loose = {}) {
  return createArcgisReader({ layer, name: 'Kitsap County', fields: KITSAP_FIELDS, where: kitsapWhere, idField: 'ObjectId', ...opts });
}
