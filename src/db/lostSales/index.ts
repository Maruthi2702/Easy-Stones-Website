/**
 * The Lost Sales screen's data layer: its routes read and write through these, and each
 * picks MongoDB or Postgres by the area's switch (`DB_LOST_SALES`, src/db/appDb.ts). Both
 * answer the same (lostSales.parity.test.ts).
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { Loose } from '../../types/records.ts';

const onPostgres = () => areaOn('lost_sales') === 'postgres';

export async function listLostSales(assigned: readonly string[]) {
  return onPostgres() ? pg.listLostSales(await appDb(), assigned) : mongo.listLostSales(assigned);
}

export async function createLostSale(doc: Loose) {
  return onPostgres() ? pg.createLostSale(await appDb(), doc) : mongo.createLostSale(doc);
}

export async function updateLostSale(id: string, assigned: readonly string[], set: Loose) {
  return onPostgres() ? pg.updateLostSale(await appDb(), id, assigned, set) : mongo.updateLostSale(id, assigned, set);
}

export async function deleteLostSale(id: string, assigned: readonly string[]) {
  return onPostgres() ? pg.deleteLostSale(await appDb(), id, assigned) : mongo.deleteLostSale(id, assigned);
}
