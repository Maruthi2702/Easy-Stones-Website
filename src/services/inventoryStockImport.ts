/**
 * Publish one complete stock catalog in one transaction. The work lives in the Inventory data
 * layer (src/db/inventory: MongoDB's transaction in mongo.ts, Postgres' in postgres.ts, picked
 * by `DB_INVENTORY`); this keeps the import's old address.
 */
export { importInventoryStock, STOCK_BACKUP_DAYS } from '../db/inventory/index.ts';
export type { StockImportResult } from '../db/inventory/index.ts';
