/**
 * Inventory, as imported from StoneProfits: stock (one row per slab / item),
 * sales by period, shipments in transit with their lines, and the bookkeeping
 * the stock import keeps (src/services/inventoryStockImport.ts publishes stock
 * in one transaction; the previous stock is archived for seven days).
 *
 * `location` here is StoneProfits' own label — a branch, or a fabricator
 * holding consigned stock, or a combined label — so it stays text, not a link
 * to locations. Quantities and money are exact numerics, as imported.
 */
import { pgTable, text, integer, boolean, jsonb, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { objectId, moment, decimal, textArray, idFormat, oneOf } from './columns.ts';

export const inventoryItems = pgTable('inventory_items', {
  id: objectId('id').primaryKey(),
  product: text('product').notNull(),
  sku: text('sku').notNull().default(''),
  genericSku: text('generic_sku').notNull().default(''),
  type: text('type').notNull().default(''),
  category: text('category').notNull().default(''),
  subCategory: text('sub_category').notNull().default(''),
  group: text('group').notNull().default(''),
  kind: text('kind').notNull().default(''),
  serialNumber: text('serial_number').notNull().default(''),
  barcodeId: text('barcode_id').notNull().default(''),
  bundle: text('bundle').notNull().default(''),
  slabNumber: text('slab_number').notNull().default(''),
  block: text('block').notNull().default(''),
  idFour: text('id_four').notNull().default(''),
  idFive: text('id_five').notNull().default(''),
  suppBarcodeId: text('supp_barcode_id').notNull().default(''),
  bin: text('bin').notNull().default(''),
  dimensions: text('dimensions').notNull().default(''),
  instockQty: decimal('instock_qty').notNull().default('0'),
  availableSlabs: decimal('available_slabs').notNull().default('0'),
  availableQuantity: decimal('available_quantity').notNull().default('0'),
  units: text('units').notNull().default(''),
  supplier: text('supplier').notNull().default(''),
  unitFobCost: decimal('unit_fob_cost').notNull().default('0'),
  unitLandedCost: decimal('unit_landed_cost').notNull().default('0'),
  purchaseCost: decimal('purchase_cost').notNull().default('0'),
  assetValue: decimal('asset_value').notNull().default('0'),
  location: text('location').notNull().default(''),
  slabStatus: text('slab_status').notNull().default(''),
  notes: text('notes').notNull().default(''),
  remnant: text('remnant').notNull().default(''),
  receivedDate: moment('received_date'),
  importedAt: moment('imported_at').notNull(),
  importedByName: text('imported_by_name').notNull().default(''),
  /** Who ran the import (a record of it, not a link: they may leave). */
  importedById: text('imported_by_id'),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('inventory_items'),
  index('inventory_items_product_idx').on(t.product),
  index('inventory_items_category_idx').on(t.category),
  index('inventory_items_location_idx').on(t.location),
  index('inventory_items_received_idx').on(t.receivedDate),
  index('inventory_items_imported_idx').on(t.importedAt),
  // Serial # is found case-insensitively (cart ticks, holds).
  index('inventory_items_serial_ci_idx').using('btree', sql`lower(${t.serialNumber})`)
]);

export const inventorySalesRecords = pgTable('inventory_sales_records', {
  id: objectId('id').primaryKey(),
  product: text('product').notNull(),
  sku: text('sku').notNull().default(''),
  type: text('type').notNull().default(''),
  category: text('category').notNull().default(''),
  subCategory: text('sub_category').notNull().default(''),
  group: text('group').notNull().default(''),
  origin: text('origin').notNull().default(''),
  slabsSold: decimal('slabs_sold').notNull().default('0'),
  quantitySold: decimal('quantity_sold').notNull().default('0'),
  uom: text('uom').notNull().default(''),
  saleValue: decimal('sale_value').notNull().default('0'),
  cost: decimal('cost').notNull().default('0'),
  avgSellingPrice: decimal('avg_selling_price').notNull().default('0'),
  avgCost: decimal('avg_cost').notNull().default('0'),
  margin: decimal('margin').notNull().default('0'),
  marginPercent: decimal('margin_percent').notNull().default('0'),
  location: text('location').notNull(),
  periodStart: moment('period_start').notNull(),
  periodEnd: moment('period_end').notNull(),
  importedAt: moment('imported_at').notNull(),
  importedByName: text('imported_by_name').notNull().default(''),
  importedById: text('imported_by_id'),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('inventory_sales_records'),
  uniqueIndex('inventory_sales_records_period_product_key').on(t.location, t.periodStart, t.periodEnd, t.product)
]);

export const inventoryTransitShipments = pgTable('inventory_transit_shipments', {
  id: objectId('id').primaryKey(),
  poNumber: text('po_number').notNull().default(''),
  containerNumber: text('container_number').notNull().default(''),
  location: text('location').notNull(),
  active: boolean('active').notNull().default(true),
  reportId: text('report_id'),
  sourceSignature: text('source_signature'),
  confirmedSignature: text('confirmed_signature'),
  usableReceiptDate: moment('usable_receipt_date'),
  receiptConfirmedAt: moment('receipt_confirmed_at'),
  receiptConfirmedBy: text('receipt_confirmed_by'),
  inactiveAt: moment('inactive_at'),
  inactiveReason: text('inactive_reason'),
  importedAt: moment('imported_at'),
  importedByName: text('imported_by_name'),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('inventory_transit_shipments'),
  uniqueIndex('inventory_transit_shipments_po_container_location_key').on(t.poNumber, t.containerNumber, t.location),
  index('inventory_transit_shipments_active_location_idx').on(t.active, t.location)
]);

/** A shipment's lines. Every field is optional, as in the StoneProfits report. */
export const inventoryTransitLines = pgTable('inventory_transit_lines', {
  shipmentId: objectId('shipment_id').notNull().references(() => inventoryTransitShipments.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  product: text('product'),
  sku: text('sku'),
  poNumber: text('po_number'),
  containerNumber: text('container_number'),
  location: text('location'),
  poDate: moment('po_date'),
  poEtaDate: moment('po_eta_date'),
  supplierSoNumber: text('supplier_so_number'),
  siplNumber: text('sipl_number'),
  slabs: decimal('slabs'),
  quantity: decimal('quantity'),
  units: text('units'),
  supplier: text('supplier'),
  freightForwarder: text('freight_forwarder'),
  shipDate: moment('ship_date'),
  portEtaDate: moment('port_eta_date'),
  etaDate: moment('eta_date'),
  vessel: text('vessel'),
  customerReference: text('customer_reference'),
  supplierPurchaseNote: text('supplier_purchase_note'),
  status: text('status')
}, t => [primaryKey({ columns: [t.shipmentId, t.position] })]);

/** One transit report import. */
export const inventoryTransitReports = pgTable('inventory_transit_reports', {
  id: text('id').primaryKey(),
  branches: textArray('branches'),
  complete: boolean('complete'),
  sourceFilename: text('source_filename'),
  sourceHash: text('source_hash'),
  importedAt: moment('imported_at'),
  importedByName: text('imported_by_name'),
  lineCount: integer('line_count'),
  shipmentCount: integer('shipment_count'),
  withdrawnCount: integer('withdrawn_count')
}, t => [index('inventory_transit_reports_imported_idx').on(t.importedAt)]);

export const inventoryTransitEvents = pgTable('inventory_transit_events', {
  id: objectId('id').primaryKey(),
  shipmentId: text('shipment_id').notNull(),
  reportId: text('report_id'),
  at: moment('at').notNull(),
  actor: text('actor'),
  action: text('action').notNull(),
  /** The shipment as it was, whatever shape it had. */
  snapshot: jsonb('snapshot')
}, t => [
  idFormat('inventory_transit_events'),
  index('inventory_transit_events_shipment_idx').on(t.shipmentId, t.at),
  oneOf('inventory_transit_events', 'action', ['reported', 'not-reported', 'receipt-confirmed'])
]);

/** A counter the screens poll to know stock changed. */
export const inventoryRevision = pgTable('inventory_revision', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull().default(0)
});

/** Stock imports (inventoryStockImport.ts): one row per published import. */
export const inventoryStockImports = pgTable('inventory_stock_imports', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  sourceFilename: text('source_filename').notNull().default(''),
  sourceHash: text('source_hash').notNull().default(''),
  count: integer('count').notNull(),
  previousCount: integer('previous_count').notNull(),
  backupChunks: integer('backup_chunks').notNull(),
  importedAt: moment('imported_at').notNull(),
  importedById: text('imported_by_id'),
  importedByName: text('imported_by_name').notNull().default(''),
  backupExpiresAt: moment('backup_expires_at').notNull()
}, t => [index('inventory_stock_imports_imported_idx').on(t.importedAt)]);

/** The previous stock, kept seven days after an import (items as they were). */
export const inventoryStockBackups = pgTable('inventory_stock_backups', {
  id: text('id').primaryKey(),
  importId: text('import_id').notNull(),
  chunk: integer('chunk').notNull(),
  items: jsonb('items').notNull(),
  expiresAt: moment('expires_at').notNull()
}, t => [index('inventory_stock_backups_import_idx').on(t.importId), index('inventory_stock_backups_expires_idx').on(t.expiresAt)]);

/** The published stock's version and the import that published it (the import's own lock). */
export const inventoryStockState = pgTable('inventory_stock_state', {
  id: text('id').primaryKey(),
  version: integer('version').notNull().default(0),
  importId: text('import_id')
});
