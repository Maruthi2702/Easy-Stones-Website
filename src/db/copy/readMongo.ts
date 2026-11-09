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
  inventoryStockState: 'inventory_stock_state',
  // Purchasing
  purchasingScopes: 'purchasing_scopes',
  purchasingInbound: 'purchasing_inbound',
  purchasingDrafts: 'purchasing_drafts',
  purchasingLocks: 'purchasing_locks',
  purchasingPoLinks: 'purchasing_po_links',
  // Accounting, Fuel Man
  acctCarriers: 'acct_carriers',
  acctCarrierInvoices: 'acct_carrier_invoices',
  acctFreightCharges: 'acct_freight_charges',
  acctPayments: 'acct_payments',
  acctAudit: 'acct_audit',
  fuelReports: 'acct_fuelman_reports',
  fuelAssignments: 'acct_fuelman_assignments',
  fuelProfiles: 'acct_fuelman_profiles',
  fuelSources: 'acct_fuelman_sources',
  fuelExpenses: 'acct_fuelman_expenses',
  fuelState: 'acct_fuelman_state',
  fuelPeriods: 'acct_fuelman_periods',
  fuelHistory: 'acct_fuelman_history',
  // Credit Card Receipts, Suppliers
  companyCards: 'companycards',
  receiptCategories: 'receiptcategories',
  cardExpenses: 'cardexpenses',
  suppliers: 'suppliers',
  supplierLogins: 'supplierlogins',
  supplierPos: 'supplierpos',
  supplierBlocks: 'supplierblocks'
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
