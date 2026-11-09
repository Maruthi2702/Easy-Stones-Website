/**
 * Read every collection the copy takes out of MongoDB — reads only, from a secondary when there is one.
 * Shared by scripts/pg-copy-customers.ts (straight into Postgres) and
 * scripts/pg-copy-aws.ts (into a snapshot for the copy Lambda).
 */
import { MongoClient } from 'mongodb';
import type { CopySource } from './plan.ts';

/** Source key → MongoDB collection. */
export const COPY_COLLECTIONS: Record<keyof CopySource, string> = {
  locations: 'locations',
  roles: 'roles',
  users: 'users',
  visitTypes: 'visittypes',
  resourceFamilies: 'resourcefamilies',
  resourceTypes: 'resourcetypes',
  customers: 'customers',
  schedules: 'schedules',
  activityLogs: 'activitylogs',
  customerDeleteBackups: 'customerdeletebackups',
  customerMergeBackups: 'customermergebackups',
  // Operations
  deliveries: 'deliveries',
  trucks: 'trucks',
  dailyReports: 'dailyreports',
  paymentsReceived: 'paymentreceiveds',
  // Check In, Cart & Holds
  officeCheckIns: 'officecheckins',
  salesCarts: 'sales_carts',
  salesHolds: 'sales_holds',
  salesSlabReservations: 'sales_slab_reservations',
  salesCounters: 'sales_counters',
  salesHoldHistory: 'sales_hold_history',
  // Inventory
  inventoryItems: 'InventoryItems',
  inventorySalesRecords: 'InventorySalesRecords',
  inventoryTransitShipments: 'InventoryTransitShipments',
  inventoryTransitReports: 'inventory_transit_reports',
  inventoryTransitEvents: 'inventory_transit_events',
  inventoryRevision: 'inventory_revision',
  inventoryStockImports: 'inventory_stock_imports',
  inventoryStockBackups: 'inventory_stock_backups',
  inventoryStockState: 'inventory_stock_state'
};

export async function readMongo(uri: string, appName = 'pg-copy-customers'): Promise<CopySource> {
  const client = new MongoClient(uri, { readPreference: 'secondaryPreferred', appName });
  await client.connect();
  try {
    const db = client.db();
    const entries = await Promise.all(Object.entries(COPY_COLLECTIONS)
      .map(async ([key, name]) => [key, await db.collection(name).find({}).toArray()] as const));
    return Object.fromEntries(entries) as unknown as CopySource;
  } finally {
    await client.close();
  }
}
