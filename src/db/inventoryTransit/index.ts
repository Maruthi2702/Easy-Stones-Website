/**
 * The in-transit shipments' data layer: the Inventory Analysis routes, the transit import and
 * the Supplier POs "Fill from SPS" lookup read and write through these, and each picks MongoDB
 * or Postgres by the area's switch (`DB_INVENTORY`, shared with stock and Purchasing, src/db/appDb.ts). Both answer the
 * same (inventoryTransit.parity.test.ts).
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { Db } from '../copy/plan.ts';
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

type Session = import('mongoose').ClientSession | null;

/** Purchasing: the shipments still in transit at these branches. `session` is its MongoDB snapshot; Postgres has no use for it. */
export async function shipmentsForBranches(branches: string[], session: Session = null, tx: unknown = null) {
  return onPostgres() ? pg.shipmentsForBranches((tx as Db | null) ?? await appDb(), branches) : mongo.shipmentsForBranches(branches, session);
}

/** Purchasing: the one active shipment at these branches a receiving date may be confirmed for. */
export async function findShipmentForReceipt(id: string, branches: string[], session: Session = null, tx: unknown = null) {
  return onPostgres() ? pg.findShipmentForReceipt((tx as Db | null) ?? await appDb(), id, branches) : mongo.findShipmentForReceipt(id, branches, session);
}

/** Purchasing: save the confirmed receiving date and its history line. */
export async function saveReceiptConfirmation(shipment: Record<string, unknown>, args: mongo.ReceiptConfirmation, session: Session = null, tx: unknown = null) {
  return onPostgres() ? pg.saveReceiptConfirmation((tx as Db | null) ?? await appDb(), shipment, args) : mongo.saveReceiptConfirmation(shipment, args, session);
}
