import type { Loose } from '../../types/records.ts';
/**
 * Pierce County's permits, from the layer the county publishes on ArcGIS
 * (fed from PALS+). Building permits (residential and commercial construction)
 * issued on or after `since`, read and counted by the shared ArcGIS reader
 * (arcgis.js): the run fails unless the rows received equal the count asked.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { isDay } from '../common.ts';
import { PIERCE_LAYER, PIERCE_FIELDS, PIERCE_DEPT, PIERCE_APPLICATION_TYPES } from '../rules/pierceCounty.ts';
import { createArcgisReader, sqlString } from './arcgis.ts';

export const pierceWhere = (since: string) => {
  if (!isDay(since)) throw new Error(`Not a date: ${since}`);
  return `issuedDate >= DATE ${sqlString(since)} AND applicationDept = ${sqlString(PIERCE_DEPT)} AND applicationType IN (${PIERCE_APPLICATION_TYPES.map(sqlString).join(', ')})`;
};

export function createPierceCountySource({ layer = PIERCE_LAYER, ...opts }: Loose = {}) {
  return createArcgisReader({ layer, name: 'Pierce County', fields: PIERCE_FIELDS, where: pierceWhere, ...opts });
}
