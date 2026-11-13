/**
 * The Delivery Schedule's data layer: every route that reads or changes tickets calls
 * these, and each picks MongoDB or Postgres by the area's switch (`DB_DELIVERIES`,
 * src/db/appDb.ts). Both answer the same (deliveries.parity.test.ts); a new read goes in
 * mongo.ts, postgres.ts and the parity test together.
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { DeliveryFind } from './types.ts';
import type { Loose } from '../../types/records.ts';

export type { DeliveryFind } from './types.ts';

const onPostgres = () => areaOn('deliveries') === 'postgres';

export async function findDeliveries(query: DeliveryFind) {
  return onPostgres() ? pg.findDeliveries(await appDb(), query) : mongo.findDeliveries(query);
}

export async function findDelivery(filter: Loose, projection?: Record<string, number>) {
  return onPostgres() ? pg.findDelivery(await appDb(), filter, projection) : mongo.findDelivery(filter, projection);
}
