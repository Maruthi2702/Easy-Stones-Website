/**
 * The in-transit shipments' data layer: the Inventory Analysis routes, the transit import and
 * the Supplier POs "Fill from SPS" lookup read and write through these, and each picks MongoDB
 * or Postgres by the area's switch (`DB_INVENTORY_TRANSIT`, src/db/appDb.ts). Both answer the
 * same (inventoryTransit.parity.test.ts).
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { TransitPublish } from './types.ts';

export type { TransitPublish, TransitPublished } from './types.ts';

const onPostgres = () => areaOn('inventory_transit') === 'postgres';

export async function listActiveShipments() {
  return onPostgres() ? pg.listActiveShipments(await appDb()) : mongo.listActiveShipments();
}

/** Supplier POs → "Fill from SPS" (src/routes/suppliers.ts still calls its own find; switch it to this). */
export async function findShipmentsByPo(po: string) {
  return onPostgres() ? pg.findShipmentsByPo(await appDb(), po) : mongo.findShipmentsByPo(po);
}

export async function publishTransit(args: TransitPublish) {
  return onPostgres() ? pg.publishTransit(await appDb(), args) : mongo.publishTransit(args);
}
