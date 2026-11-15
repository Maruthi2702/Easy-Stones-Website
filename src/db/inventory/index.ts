/**
 * The Inventory stock and sales data layer: the Inventory Analysis routes and the stock
 * import read and write through these, and each picks MongoDB or Postgres by the area's
 * switch (`DB_INVENTORY`, src/db/appDb.ts). Both answer the same (inventory.parity.test.ts).
 *
 * Not here (other pieces of the Inventory + Purchasing move): shipments in transit, Purchasing,
 * and Cart & Holds' own reads — which can use `findSlabsByKeys`, `findSlabByBarcode`,
 * `inventoryRevision` when they move.
 */
import { appDb, areaOn } from '../appDb.ts';
import type { Db } from '../copy/plan.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { StockFilter } from './rules.ts';
import type { StockImportInput, StockImportResult, SalesPeriodInput, BeforeReplace, StockGroup } from './types.ts';
import type { Loose } from '../../types/records.ts';

export { STOCK_BACKUP_DAYS } from './mongo.ts';
export type { StockFilter, StockImportInput, StockImportResult, SalesPeriodInput, BeforeReplace, StockGroup };

const onPostgres = () => areaOn('inventory') === 'postgres';

export async function stockSummary(filter: StockFilter, now: Date = new Date()) {
  return onPostgres() ? pg.summary(await appDb(), filter, now) : mongo.summary(filter, now);
}

/** Every category, location and slab status in stock (blank ones included — the route drops them). */
export async function stockFilterValues() {
  return onPostgres() ? pg.filterValues(await appDb()) : mongo.filterValues();
}

export async function listStockItems(filter: StockFilter, page: number, limit: number): Promise<{ items: Loose[]; total: number }> {
  return onPostgres() ? pg.listItems(await appDb(), filter, page, limit) : mongo.listItems(filter, page, limit);
}

/** One entry per product with its totals, a page of them, and how many products match. */
export async function stockGroups(filter: StockFilter, page: number, limit: number): Promise<{ groups: StockGroup[]; total: number }> {
  return onPostgres() ? pg.groupedItems(await appDb(), filter, page, limit) : mongo.groupedItems(filter, page, limit);
}

/** The Reorder view's inputs: on-hand per product + location, and each one's latest sales period. */
export async function velocityInputs(location: unknown): Promise<{ onHand: Loose[]; latestPerKey: Loose[] }> {
  return onPostgres() ? pg.velocityInputs(await appDb(), location) : mongo.velocityInputs(location);
}

/** Publish one complete stock catalog in one transaction (see mongo.ts / postgres.ts). */
export async function importInventoryStock(input: StockImportInput): Promise<StockImportResult> {
  return onPostgres() ? pg.importStock(await appDb(), input) : mongo.importStock(input);
}

/** Replace one location + period's sales in one transaction. */
export async function replaceSalesPeriod(input: SalesPeriodInput, beforeReplace?: BeforeReplace): Promise<void> {
  return onPostgres() ? pg.replaceSalesPeriod(await appDb(), input, beforeReplace) : mongo.replaceSalesPeriod(input, beforeReplace);
}

/** For Cart & Holds when it moves: the slabs whose serial # (trimmed, upper-cased) is one of `wanted`. */
export async function findSlabsByKeys(wanted: string[], keyOf: (serial: unknown) => string): Promise<Loose[]> {
  return onPostgres() ? pg.findSlabsByKeys(await appDb(), wanted) : mongo.findSlabsByKeys(wanted, keyOf);
}

/** For Cart & Holds when it moves: the slab a scanned barcode names (case-insensitive, exact). */
export async function findSlabByBarcode(value: string): Promise<Loose | null> {
  return onPostgres() ? pg.findSlabByBarcode(await appDb(), value) : mongo.findSlabByBarcode(value);
}

/** The counter the screens poll to know stock changed. */
export async function inventoryRevision(): Promise<number> {
  return onPostgres() ? pg.inventoryRevision(await appDb()) : mongo.inventoryRevision();
}

/** Purchasing's stock read. `session` is the MongoDB snapshot it is reading in, `tx` its Postgres transaction: the read joins whichever database is in use. */
export async function stockForPurchasing(branches: string[], session: import('mongoose').ClientSession | null = null, tx: unknown = null): Promise<Loose[]> {
  return onPostgres() ? pg.stockForPurchasing((tx as Db | null) ?? await appDb(), branches) : mongo.stockForPurchasing(branches, session);
}

/** Purchasing's sales-report read. */
export async function salesRecordsForPurchasing(session: import('mongoose').ClientSession | null = null, tx: unknown = null): Promise<Loose[]> {
  return onPostgres() ? pg.salesRecordsForPurchasing((tx as Db | null) ?? await appDb()) : mongo.salesRecordsForPurchasing(session);
}
