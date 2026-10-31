import type { Loose } from '../../types/records.ts';
/**
 * City of Tacoma's permits, from the layer the city publishes on its open
 * data hub (copied daily from Accela). Building permits issued on or after
 * `since`, read and counted by the shared ArcGIS reader (arcgis.js): the run
 * fails unless the rows received equal the count asked.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { isDay } from '../common.ts';
import { TACOMA_LAYER, TACOMA_FIELDS, TACOMA_PERMIT_TYPE } from '../rules/tacoma.ts';
import { createArcgisReader, sqlString } from './arcgis.ts';

export const tacomaWhere = (since: string) => {
  if (!isDay(since)) throw new Error(`Not a date: ${since}`);
  return `issued_date >= DATE ${sqlString(since)} AND permit_type = ${sqlString(TACOMA_PERMIT_TYPE)}`;
};

export function createTacomaSource({ layer = TACOMA_LAYER, ...opts }: Loose = {}) {
  return createArcgisReader({ layer, name: 'Tacoma', fields: TACOMA_FIELDS, where: tacomaWhere, idField: 'objectid', ...opts });
}
