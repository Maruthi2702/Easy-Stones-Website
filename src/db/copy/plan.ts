/**
 * Copy the customer area from MongoDB into Postgres (src/db/README.md).
 *
 * MongoDB stays the live database until cutover; this refreshes Postgres from
 * it, whole, in one transaction: the copied tables are emptied and refilled,
 * so running it again gives the same result. It refuses once the database is
 * locked (`mongo_copy_state.locked_at`, set at cutover), because from then on
 * Postgres holds the live data and a copy would overwrite it.
 */
import { sql, getTableName, getTableColumns, eq } from 'drizzle-orm';
import { getTableConfig, type PgDatabase, type PgQueryResultHKT, type PgTable } from 'drizzle-orm/pg-core';
import type { Loose } from '../../types/records.ts';
import * as schema from '../schema/index.ts';
import { referenceRows, type ReferenceSource } from './referenceRows.ts';
import { syncReference } from '../reference/syncReference.ts';
import { customerRows } from './customerRows.ts';
import { linkedRows, type LinkedSource } from './linkedRows.ts';
import { operationsRows, type OperationsSource } from './operationsRows.ts';
import { checkInsHoldsRows, type CheckInsHoldsSource } from './checkInsHoldsRows.ts';
import { inventoryRows, type InventorySource } from './inventoryRows.ts';
import { purchasingRows, type PurchasingSource } from './purchasingRows.ts';
import { accountingRows, type AccountingSource } from './accountingRows.ts';
import { cardsSuppliersRows, type CardsSuppliersSource } from './cardsSuppliersRows.ts';
import { permitsRows, type PermitsSource } from './permitsRows.ts';
import { miscRows, type MiscSource } from './miscRows.ts';
import { COPY_COLLECTIONS } from './readMongo.ts';
import type { CopyProblem } from './values.ts';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface CopySource extends ReferenceSource, LinkedSource, OperationsSource, CheckInsHoldsSource, InventorySource, PurchasingSource, AccountingSource, CardsSuppliersSource, PermitsSource, MiscSource {
  customers: Loose[];
}

/** A source with every collection empty: tests spread their own records over it. */
export function emptySource(): CopySource {
  return Object.fromEntries(Object.keys(COPY_COLLECTIONS).map(k => [k, []])) as unknown as CopySource;
}

/** Every table this copy fills, parents before children (the insert order). */
export function copyPlan(src: CopySource, problems: CopyProblem[]) {
  const ref = referenceRows(src, problems);
  const cust = customerRows(src.customers, ref.index, problems, { preserveSourceOrder: true });
  const linked = linkedRows(src, ref.index, cust.index, problems);
  const ops = operationsRows(src, ref.index, cust.index, problems);
  const ch = checkInsHoldsRows(src, ref.index, cust.index, problems);
  const inv = inventoryRows(src, problems);
  const pur = purchasingRows(src, problems);
  const acc = accountingRows(src, ref.index, ops.index, problems);
  const cs = cardsSuppliersRows(src, ref.index, cust.index, problems);
  const per = permitsRows(src, problems);
  const misc = miscRows(src, ref.index, cust.index, problems);
  const r = ref.rows, c = cust.rows, o = ops.rows;
  const steps: [PgTable, Loose[]][] = [
    [schema.locations, r.locations],
    [schema.roles, r.roles],
    [schema.users, r.users],
    [schema.userLocations, r.userLocations],
    [schema.locationReportRecipients, r.locationReportRecipients],
    [schema.visitTypes, r.visitTypes],
    [schema.resourceFamilies, r.resourceFamilies],
    [schema.resourceTypes, r.resourceTypes],
    [schema.customers, c.customers],
    [schema.customerLogins, c.customerLogins],
    [schema.customerContacts, c.customerContacts],
    [schema.customerLinks, c.customerLinks],
    [schema.visits, c.visits],
    [schema.visitAttachments, c.visitAttachments],
    [schema.visitReactions, c.visitReactions],
    [schema.visitFollowUpEvents, c.visitFollowUpEvents],
    [schema.resources, c.resources],
    [schema.resourceAttachments, c.resourceAttachments],
    [schema.schedules, linked.schedules],
    [schema.activityLogs, linked.activityLogs],
    [schema.customerDeleteBackups, linked.customerDeleteBackups],
    [schema.customerMergeBackups, linked.customerMergeBackups],
    // Operations
    [schema.deliveries, o.deliveries],
    [schema.trucks, o.trucks],
    [schema.dailyReports, o.dailyReports],
    [schema.dailyReportTransfers, o.dailyReportTransfers],
    [schema.dailyReportContainers, o.dailyReportContainers],
    [schema.dailyReportLog, o.dailyReportLog],
    [schema.paymentsReceived, o.paymentsReceived],
    [schema.paymentHistory, o.paymentHistory],
    // Check In, Cart & Holds
    [schema.officeCheckIns, ch.officeCheckIns],
    [schema.checkInSelections, ch.checkInSelections],
    [schema.salesCarts, ch.salesCarts],
    [schema.salesCartLines, ch.salesCartLines],
    [schema.salesHolds, ch.salesHolds],
    [schema.salesHoldLines, ch.salesHoldLines],
    [schema.salesSlabReservations, ch.salesSlabReservations],
    [schema.salesCounters, ch.salesCounters],
    [schema.salesHoldHistory, ch.salesHoldHistory],
    // Inventory
    [schema.inventoryItems, inv.inventoryItems],
    [schema.inventorySalesRecords, inv.inventorySalesRecords],
    [schema.inventoryTransitShipments, inv.inventoryTransitShipments],
    [schema.inventoryTransitLines, inv.inventoryTransitLines],
    [schema.inventoryTransitReports, inv.inventoryTransitReports],
    [schema.inventoryTransitEvents, inv.inventoryTransitEvents],
    [schema.inventoryRevision, inv.inventoryRevision],
    [schema.inventoryStockImports, inv.inventoryStockImports],
    [schema.inventoryStockBackups, inv.inventoryStockBackups],
    [schema.inventoryStockState, inv.inventoryStockState],
    // Purchasing
    [schema.purchasingScopes, pur.purchasingScopes],
    [schema.purchasingScopeAliases, pur.purchasingScopeAliases],
    [schema.purchasingScopePolicies, pur.purchasingScopePolicies],
    [schema.purchasingInbound, pur.purchasingInbound],
    [schema.purchasingDrafts, pur.purchasingDrafts],
    [schema.purchasingDraftHistory, pur.purchasingDraftHistory],
    [schema.purchasingLocks, pur.purchasingLocks],
    [schema.purchasingPoLinks, pur.purchasingPoLinks],
    // Accounting, Fuel Man
    [schema.acctCarriers, acc.acctCarriers],
    [schema.acctCarrierInvoices, acc.acctCarrierInvoices],
    [schema.acctFreightCharges, acc.acctFreightCharges],
    [schema.acctFreightChargeFlags, acc.acctFreightChargeFlags],
    [schema.acctInvoiceCharges, acc.acctInvoiceCharges],
    [schema.acctPayments, acc.acctPayments],
    [schema.acctPaymentCharges, acc.acctPaymentCharges],
    [schema.acctAudit, acc.acctAudit],
    [schema.fuelReports, acc.fuelReports],
    [schema.fuelAssignments, acc.fuelAssignments],
    [schema.fuelAssignmentAllocations, acc.fuelAssignmentAllocations],
    [schema.fuelProfiles, acc.fuelProfiles],
    [schema.fuelSources, acc.fuelSources],
    [schema.fuelExpenses, acc.fuelExpenses],
    [schema.fuelState, acc.fuelState],
    [schema.fuelPeriods, acc.fuelPeriods],
    [schema.fuelHistory, acc.fuelHistory],
    // Credit Card Receipts, Suppliers
    [schema.companyCards, cs.companyCards],
    [schema.receiptCategories, cs.receiptCategories],
    [schema.cardExpenses, cs.cardExpenses],
    [schema.cardExpenseHistory, cs.cardExpenseHistory],
    [schema.suppliers, cs.suppliers],
    [schema.supplierHistory, cs.supplierHistory],
    [schema.supplierLogins, cs.supplierLogins],
    [schema.supplierPos, cs.supplierPos],
    [schema.supplierPoLines, cs.supplierPoLines],
    [schema.supplierPoHistory, cs.supplierPoHistory],
    [schema.supplierBlocks, cs.supplierBlocks],
    [schema.supplierBundles, cs.supplierBundles],
    [schema.supplierBlockHistory, cs.supplierBlockHistory],
    // Permits
    [schema.permits, per.permits],
    [schema.permitContacts, per.permitContacts],
    [schema.permitRuns, per.permitRuns],
    [schema.permitChecks, per.permitChecks],
    [schema.permitContractors, per.permitContractors],
    [schema.permitContractorNames, per.permitContractorNames],
    // Everything else
    [schema.lostSales, misc.lostSales],
    [schema.products, misc.products],
    [schema.productColors, misc.productColors],
    [schema.productBundles, misc.productBundles],
    [schema.easyStonesColors, misc.easyStonesColors],
    [schema.crossoverColors, misc.crossoverColors],
    [schema.crossovers, misc.crossovers],
    [schema.appSettings, misc.appSettings],
    [schema.importMemories, misc.importMemories],
    [schema.contactSubmissions, misc.contactSubmissions],
    [schema.teamFiles, misc.teamFiles],
    [schema.salesResources, misc.salesResources],
    [schema.spsImportRuns, misc.spsImportRuns],
    [schema.spsImportItems, misc.spsImportItems],
    [schema.cloudinaryToS3Backups, misc.cloudinaryToS3Backups],
    [schema.legacyLeads, misc.legacyLeads],
    [schema.legacySalesCustomers, misc.legacySalesCustomers]
  ];
  return steps;
}

export interface CopyReport {
  copiedAt: string;
  source: Record<string, number>;
  tables: Record<string, number>;
  /** Problems grouped: "table.field · reason · outcome" → count. */
  summary: Record<string, number>;
  problems: CopyProblem[];
}

export function summarize(problems: CopyProblem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of problems) {
    const key = `${p.table}.${p.field} · ${p.reason} · ${p.outcome}`;
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export class CopyLockedError extends Error {
  constructor(lockedAt: Date, lockedBy: string) {
    super(`This database was locked for copies on ${lockedAt.toISOString()} by ${lockedBy || 'someone'}: it holds live data now.`);
    this.name = 'CopyLockedError';
  }
}

const CHUNK = 500;

/** Map everything first (no writes), then replace the tables in one transaction. */
export async function copyFromMongo(db: Db, src: CopySource, options: { write: boolean }): Promise<CopyReport> {
  const problems: CopyProblem[] = [];
  const steps = copyPlan(src, problems);
  const report: CopyReport = {
    copiedAt: new Date().toISOString(),
    source: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, (v as unknown[]).length])),
    tables: Object.fromEntries(steps.map(([t, rows]) => [getTableName(t), rows.length])),
    summary: summarize(problems),
    problems
  };
  if (!options.write) return report;

  await db.transaction(async tx => {
    const [state] = await tx.select().from(schema.mongoCopyState).where(eq(schema.mongoCopyState.id, 1)).for('update');
    if (state?.lockedAt) throw new CopyLockedError(state.lockedAt, state.lockedBy);
    // One TRUNCATE naming every table, no CASCADE: if a table from another area
    // ever points at these, this fails instead of quietly emptying it too.
    const names = steps.map(([t]) => sql.identifier(getTableName(t)));
    await tx.execute(sql`truncate table ${sql.join(names, sql`, `)}`);
    for (const [table, rows] of steps) {
      for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(table).values(rows.slice(i, i + CHUNK));
    }
    // Explicit copy ordinals don't advance an identity sequence. The next app
    // insert must follow every copied customer, including after an empty/repeated copy.
    const nextOrder = report.tables.customers + 1;
    if (!Number.isSafeInteger(nextOrder) || nextOrder < 1 || nextOrder > 2_147_483_647) throw new Error('Customer match order exceeds the identity range');
    // RESTART is transactional, unlike setval(): a failed copy restores both the
    // old rows and their generator, so the next customer cannot collide or move up.
    await tx.execute(sql`alter table customers alter column match_order restart with ${sql.raw(String(nextOrder))}`);
    const brief = { ...report, problems: undefined, problemCount: problems.length };
    await tx.insert(schema.mongoCopyState).values({ id: 1, lastCopyAt: new Date(report.copiedAt), lastCopyReport: brief })
      .onConflictDoUpdate({ target: schema.mongoCopyState.id, set: { lastCopyAt: new Date(report.copiedAt), lastCopyReport: brief } });
  });
  return report;
}

/** A table's primary key, as the property names its rows use. */
function primaryKeyOf(table: PgTable): string[] {
  const columns = Object.entries(getTableColumns(table));
  const single = columns.filter(([, col]) => col.primary).map(([key]) => key);
  if (single.length) return single;
  const composite = getTableConfig(table).primaryKeys[0];
  if (!composite) throw new Error(`${getTableName(table)} has no primary key`);
  return composite.columns.map(col => columns.find(([, c]) => c.name === col.name)![0]);
}

/** Normalize a value read back from either side so equal data compares equal. */
function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `bytes:${Buffer.from(v).toString('base64')}`;
  if (v === undefined) return null;
  if (typeof v === 'string') {
    // Postgres prints a local time without trailing zero milliseconds, and numerics at their scale.
    const t = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(v);
    if (t) return `${t[1]}.${(t[2] || '').padEnd(3, '0')}`;
  }
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]));
  return v;
}

/**
 * The tables the customer area owns once `DB_CUSTOMERS=postgres` — the customer, its children, calendar, activity log,
 * backups, import state — plus the reference tables customers point at (users, roles, locations, type lists).
 * Everything else (deliveries, payments, permits…) is still written live on MongoDB and keeps drifting.
 */
export const CUSTOMER_AREA_TABLES = new Set([
  'customers', 'customer_logins', 'customer_contacts', 'customer_links', 'visits', 'visit_attachments', 'visit_reactions',
  'visit_follow_up_events', 'resources', 'resource_attachments', 'schedules', 'activity_logs', 'customer_delete_backups',
  'customer_merge_backups', 'import_memories', 'sps_import_runs', 'sps_import_items',
  'locations', 'roles', 'users', 'user_locations', 'location_report_recipients', 'visit_types', 'resource_families', 'resource_types'
]);

/** Columns that change by the minute on MongoDB (who is online) and say nothing about customers: not compared in the customer-area check. */
const CUSTOMER_SCOPE_IGNORES: Record<string, string[]> = { users: ['lastSeenAt', 'lastLoginAt', 'updatedAt'] };

/** The staff area's tables (Users, Roles, Locations): moved by an in-place sync, never a truncating copy — everything points at them. */
export const STAFF_AREA_TABLES = new Set(['locations', 'roles', 'users', 'user_locations', 'location_report_recipients']);

/** Sign-in counters and the online stamps keep moving while people sign in: not compared in the staff check. */
const STAFF_SCOPE_IGNORES: Record<string, string[]> = { users: ['loginAttempts', 'lockUntil', 'lastSeenAt', 'lastLoginAt', 'updatedAt'] };

/** The visit / resource type lists: moved by an in-place sync too (customers' records point at them by name). */
export const TYPES_AREA_TABLES = new Set(['visit_types', 'resource_families', 'resource_types']);

export interface VerifyOptions {
  /** 'customers': only CUSTOMER_AREA_TABLES, and not the by-the-minute columns above. 'staff' / 'types': only that area's tables. Default: every table, every column. */
  scope?: 'customers' | 'staff' | 'types';
}

/**
 * Check Postgres holds exactly what MongoDB maps to: same rows per table and
 * every column equal. Returns the differences (empty = verified).
 */
export async function verifyCopy(db: Db, src: CopySource, limitPerTable = 20, options: VerifyOptions = {}): Promise<string[]> {
  const diffs: string[] = [];
  for (const [table, expected] of copyPlan(src, [])) {
    const name = getTableName(table);
    if (options.scope === 'customers' && !CUSTOMER_AREA_TABLES.has(name)) continue;
    if (options.scope === 'staff' && !STAFF_AREA_TABLES.has(name)) continue;
    if (options.scope === 'types' && !TYPES_AREA_TABLES.has(name)) continue;
    const ignored = new Set(options.scope === 'customers' ? CUSTOMER_SCOPE_IGNORES[name] ?? [] : options.scope === 'staff' ? STAFF_SCOPE_IGNORES[name] ?? [] : []);
    // numeric columns come back at their scale ('10.00'): compare those as numbers, nothing else.
    const numeric = new Set(Object.entries(getTableColumns(table)).filter(([, col]) => col.columnType === 'PgNumeric').map(([key]) => key));
    const value = (col: string, v: unknown) => numeric.has(col) && v != null ? Number(v) : norm(v);
    const actual = (await db.select().from(table)) as Loose[];
    // A copy numbers the source collection densely; normal deletes leave identity
    // gaps. Compare this internal ordering column by rank, not by its arbitrary
    // numeric labels. Every row's relative position is checked, not omitted.
    const matchRank = name === 'customers' ? new Map([...actual]
      .sort((a, b) => a.matchOrder - b.matchOrder || String(a.id).localeCompare(String(b.id)))
      .map((row, position) => [row.id, position + 1])) : undefined;
    if (matchRank) {
      // Relative ranks alone are insufficient if the next generated ordinal
      // would collide or sort before existing rows. Inspect without consuming it.
      const sequence = await db.execute(sql`select last_value, is_called from customers_match_order_seq`) as unknown as {
        rows: { last_value: number | string; is_called: boolean }[];
      };
      const state = sequence.rows[0];
      const nextOrder = Number(state.last_value) + (state.is_called ? 1 : 0);
      const maxOrder = actual.reduce((max, row) => Math.max(max, row.matchOrder), 0);
      if (nextOrder <= maxOrder) diffs.push('customers: matchOrder generator does not append after existing customers');
    }
    if (actual.length !== expected.length) diffs.push(`${name}: ${actual.length} rows in Postgres, ${expected.length} expected`);
    const pk = primaryKeyOf(table);
    const keyOf = (row: Loose) => JSON.stringify(pk.length === 1 ? row[pk[0]] : pk.map(k => row[k]));
    const byKey = new Map(actual.map(row => [keyOf(row), row]));
    let shown = 0;
    for (const want of expected) {
      const got = byKey.get(keyOf(want));
      const problem = !got ? 'missing' : Object.entries(want)
        .filter(([col]) => !ignored.has(col))
        .filter(([col, v]) => JSON.stringify(value(col, v)) !== JSON.stringify(value(col,
          col === 'matchOrder' && matchRank ? matchRank.get(got.id) : got[col])))
        .map(([col]) => col).join(', ');
      if (problem && shown++ < limitPerTable) diffs.push(`${name} ${keyOf(want)}: ${problem === 'missing' ? 'missing' : `differs in ${problem}`}`);
    }
    if (shown > limitPerTable) diffs.push(`${name}: ${shown - limitPerTable} more differences`);
  }
  return diffs;
}

/** The tables an area owns once it moves on its own (deliveries are the first). */
export const COPY_AREAS = {
  deliveries: ['deliveries', 'trucks'],
  /** Payments, Check In + Selection Sheet and Daily Reports move in one window (Daily Reports derives from the other two). */
  operations: [
    'payments_received', 'payment_history', 'office_check_ins', 'check_in_selections',
    'daily_reports', 'daily_report_transfers', 'daily_report_containers', 'daily_report_log'
  ],
  /** Credit Card Receipts: cards, the category list and the expenses with their history. */
  card_receipts: ['company_cards', 'receipt_categories', 'card_expenses', 'card_expense_history'],
  /** Lost Sales: one table, its own small cutover. */
  lost_sales: ['lost_sales'],
  /** Inventory, in-transit shipments and Purchasing: one switch (`DB_INVENTORY`), one cutover. */
  inventory: [
    'inventory_items', 'inventory_sales_records', 'inventory_transit_shipments', 'inventory_transit_lines',
    'inventory_transit_reports', 'inventory_transit_events', 'inventory_revision', 'inventory_stock_imports',
    'inventory_stock_backups', 'inventory_stock_state',
    'purchasing_scopes', 'purchasing_scope_aliases', 'purchasing_scope_policies', 'purchasing_inbound',
    'purchasing_drafts', 'purchasing_draft_history', 'purchasing_locks', 'purchasing_po_links'
  ],
  /** Cart & Holds: carts, holds with their slabs, the slab locks, the hold counter and the history. */
  holds: [
    'sales_carts', 'sales_cart_lines', 'sales_holds', 'sales_hold_lines', 'sales_slab_reservations', 'sales_counters', 'sales_hold_history'
  ],
  /** Fuel Man: statements, who held each card, the published costs, the months and the history (Accounting's tables stay out). */
  fuelman: [
    'acct_fuelman_reports', 'acct_fuelman_sources', 'acct_fuelman_assignments', 'acct_fuelman_assignment_allocations',
    'acct_fuelman_profiles', 'acct_fuelman_expenses', 'acct_fuelman_state', 'acct_fuelman_periods', 'acct_fuelman_history'
  ],
  /** Suppliers and the supplier portal: suppliers, their logins, POs with lines, blocks with bundles, and the history lines. */
  suppliers: [
    'suppliers', 'supplier_history', 'supplier_logins', 'supplier_pos', 'supplier_po_lines', 'supplier_po_history',
    'supplier_blocks', 'supplier_bundles', 'supplier_block_history'
  ],
  /**
   * App settings (the side nav's order, `DB_SETTINGS`) plus three tables no code reads any more — the file-move
   * backups and the two legacy lists — so the cutover copies them once. Import memory, the activity log and the
   * customer backups moved with Customers; stock-import backups with Inventory.
   */
  settings: ['app_settings', 'cloudinary_to_s3_backups', 'legacy_leads', 'legacy_sales_customers'],
  /** Accounting's 3rd-party freight (Fuel Man is its own area): carriers, charges with flags, carrier invoices, payments, the audit. */
  /**
   * The small ones, one switch (`DB_SMALL`, owner: "one cutover for the tiny ones"): the public site's products with their
   * colours and bundles, the Easy Stones colour catalog, the Crossover Sheet, the contact form, Team Files and the old
   * sales-resources list. Permits is its own area (it runs on Lambda).
   */
  small: [
    'products', 'product_colors', 'product_bundles', 'easy_stones_colors', 'crossover_colors', 'crossovers',
    'contact_submissions', 'team_files', 'sales_resources'
  ],
  /** Permits (`DB_PERMITS`): the permits with their contacts, the pull runs and month checks, the WA contractor registry cache. */
  permits: ['permits', 'permit_contacts', 'permit_runs', 'permit_checks', 'permit_contractors', 'permit_contractor_names'],
  accounting: [
    'acct_carriers', 'acct_carrier_invoices', 'acct_freight_charges', 'acct_freight_charge_flags', 'acct_invoice_charges',
    'acct_payments', 'acct_payment_charges', 'acct_audit'
  ]
} as const;
export type CopyArea = keyof typeof COPY_AREAS;
export const isCopyArea = (v: unknown): v is CopyArea => typeof v === 'string' && Object.hasOwn(COPY_AREAS, v);

export class AreaLockedError extends Error {
  constructor(area: string) {
    super(`The ${area} area is locked for copies: Postgres holds its live data now.`);
    this.name = 'AreaLockedError';
  }
}

/**
 * One area's tables, as MongoDB maps to them. Links to customers are checked against the customers
 * **in Postgres** (live since 2026-11-12), not MongoDB's stale list, so a ticket for a customer made
 * since then keeps its link.
 */
async function areaPlan(db: Db, src: CopySource, area: CopyArea, problems: CopyProblem[]): Promise<[PgTable, Loose[]][]> {
  const ref = referenceRows(src, problems);
  const customerIds = new Set((await db.select({ id: schema.customers.id }).from(schema.customers)).map(r => r.id));
  const ops = operationsRows(src, ref.index, { customerIds } as never, problems);
  const names = new Set<string>(COPY_AREAS[area]);
  const all: [PgTable, Loose[]][] = [[schema.deliveries, ops.rows.deliveries], [schema.trucks, ops.rows.trucks]];
  if (area === 'operations') {
    const ch = checkInsHoldsRows(src, ref.index, { customerIds } as never, problems);
    // Parents before children (the insert order).
    all.push(
      [schema.paymentsReceived, ops.rows.paymentsReceived], [schema.paymentHistory, ops.rows.paymentHistory],
      [schema.officeCheckIns, ch.officeCheckIns], [schema.checkInSelections, ch.checkInSelections],
      [schema.dailyReports, ops.rows.dailyReports], [schema.dailyReportTransfers, ops.rows.dailyReportTransfers],
      [schema.dailyReportContainers, ops.rows.dailyReportContainers], [schema.dailyReportLog, ops.rows.dailyReportLog]
    );
  }
  if (area === 'card_receipts') {
    const cs = cardsSuppliersRows(src, ref.index, { customerIds } as never, problems);
    all.push(
      [schema.companyCards, cs.companyCards], [schema.receiptCategories, cs.receiptCategories],
      [schema.cardExpenses, cs.cardExpenses], [schema.cardExpenseHistory, cs.cardExpenseHistory]
    );
  }
  if (area === 'inventory') {
    const inv = inventoryRows(src as never, problems);
    const pur = purchasingRows(src as never, problems);
    // Parents before children (the insert order).
    all.push(
      [schema.inventoryItems, inv.inventoryItems], [schema.inventorySalesRecords, inv.inventorySalesRecords],
      [schema.inventoryTransitShipments, inv.inventoryTransitShipments], [schema.inventoryTransitLines, inv.inventoryTransitLines],
      [schema.inventoryTransitReports, inv.inventoryTransitReports], [schema.inventoryTransitEvents, inv.inventoryTransitEvents],
      [schema.inventoryRevision, inv.inventoryRevision], [schema.inventoryStockImports, inv.inventoryStockImports],
      [schema.inventoryStockBackups, inv.inventoryStockBackups], [schema.inventoryStockState, inv.inventoryStockState],
      [schema.purchasingScopes, pur.purchasingScopes], [schema.purchasingScopeAliases, pur.purchasingScopeAliases],
      [schema.purchasingScopePolicies, pur.purchasingScopePolicies], [schema.purchasingInbound, pur.purchasingInbound],
      [schema.purchasingDrafts, pur.purchasingDrafts], [schema.purchasingDraftHistory, pur.purchasingDraftHistory],
      [schema.purchasingLocks, pur.purchasingLocks], [schema.purchasingPoLinks, pur.purchasingPoLinks]
    );
  }
  if (area === 'holds') {
    const ch = checkInsHoldsRows(src, ref.index, { customerIds } as never, problems);
    // Parents before children (the insert order).
    all.push(
      [schema.salesCarts, ch.salesCarts], [schema.salesCartLines, ch.salesCartLines],
      [schema.salesHolds, ch.salesHolds], [schema.salesHoldLines, ch.salesHoldLines],
      [schema.salesSlabReservations, ch.salesSlabReservations], [schema.salesCounters, ch.salesCounters],
      [schema.salesHoldHistory, ch.salesHoldHistory]
    );
  }
  if (area === 'small') {
    const misc = miscRows(src, ref.index, { customerIds } as never, problems);
    // Parents before children (the insert order).
    all.push(
      [schema.products, misc.products], [schema.productColors, misc.productColors], [schema.productBundles, misc.productBundles],
      [schema.easyStonesColors, misc.easyStonesColors], [schema.crossoverColors, misc.crossoverColors], [schema.crossovers, misc.crossovers],
      [schema.contactSubmissions, misc.contactSubmissions], [schema.teamFiles, misc.teamFiles], [schema.salesResources, misc.salesResources]
    );
  }
  if (area === 'permits') {
    const per = permitsRows(src, problems);
    // Parents before children (the insert order).
    all.push(
      [schema.permits, per.permits], [schema.permitContacts, per.permitContacts], [schema.permitRuns, per.permitRuns],
      [schema.permitChecks, per.permitChecks], [schema.permitContractors, per.permitContractors], [schema.permitContractorNames, per.permitContractorNames]
    );
  }
  if (area === 'accounting') {
    const acc = accountingRows(src as never, ref.index, ops.index, problems);
    // Parents before children (the insert order): invoices before the charges that sit on them.
    all.push(
      [schema.acctCarriers, acc.acctCarriers], [schema.acctCarrierInvoices, acc.acctCarrierInvoices],
      [schema.acctFreightCharges, acc.acctFreightCharges], [schema.acctFreightChargeFlags, acc.acctFreightChargeFlags],
      [schema.acctInvoiceCharges, acc.acctInvoiceCharges], [schema.acctPayments, acc.acctPayments],
      [schema.acctPaymentCharges, acc.acctPaymentCharges], [schema.acctAudit, acc.acctAudit]
    );
  }
  if (area === 'fuelman') {
    // The same builder makes Accounting's rows too; only Fuel Man's problems belong to this area's report.
    const seen: CopyProblem[] = [];
    const acc = accountingRows(src as never, ref.index, ops.index, seen);
    problems.push(...seen.filter(p => p.table.startsWith('acct_fuelman')));
    // Parents before children (the insert order).
    all.push(
      [schema.fuelReports, acc.fuelReports], [schema.fuelSources, acc.fuelSources], [schema.fuelAssignments, acc.fuelAssignments],
      [schema.fuelAssignmentAllocations, acc.fuelAssignmentAllocations], [schema.fuelProfiles, acc.fuelProfiles],
      [schema.fuelExpenses, acc.fuelExpenses], [schema.fuelState, acc.fuelState], [schema.fuelPeriods, acc.fuelPeriods], [schema.fuelHistory, acc.fuelHistory]
    );
  }
  if (area === 'suppliers') {
    const cs = cardsSuppliersRows(src, ref.index, { customerIds } as never, problems);
    // Parents before children (the insert order).
    all.push(
      [schema.suppliers, cs.suppliers], [schema.supplierHistory, cs.supplierHistory], [schema.supplierLogins, cs.supplierLogins],
      [schema.supplierPos, cs.supplierPos], [schema.supplierPoLines, cs.supplierPoLines], [schema.supplierPoHistory, cs.supplierPoHistory],
      [schema.supplierBlocks, cs.supplierBlocks], [schema.supplierBundles, cs.supplierBundles], [schema.supplierBlockHistory, cs.supplierBlockHistory]
    );
  }
  if (area === 'settings') {
    const misc = miscRows(src, ref.index, { customerIds } as never, problems);
    all.push([schema.appSettings, misc.appSettings], [schema.cloudinaryToS3Backups, misc.cloudinaryToS3Backups],
      [schema.legacyLeads, misc.legacyLeads], [schema.legacySalesCustomers, misc.legacySalesCustomers]);
  }
  if (area === 'lost_sales') all.push([schema.lostSales, miscRows(src, ref.index, { customerIds } as never, problems).lostSales]);
  return all.filter(([t]) => names.has(getTableName(t)));
}

/** Replace only this area's tables (one transaction). The global lock does not apply; the area's own lock does. */
export async function copyAreaFromMongo(db: Db, src: CopySource, area: CopyArea, options: { write: boolean }): Promise<CopyReport> {
  const problems: CopyProblem[] = [];
  const steps = await areaPlan(db, src, area, problems);
  const report: CopyReport = {
    copiedAt: new Date().toISOString(),
    source: { [area]: steps.reduce((n, [, rows]) => n + rows.length, 0) },
    tables: Object.fromEntries(steps.map(([t, rows]) => [getTableName(t), rows.length])),
    summary: summarize(problems),
    problems
  };
  if (!options.write) return report;
  await db.transaction(async tx => {
    const [state] = await tx.select().from(schema.mongoCopyState).where(eq(schema.mongoCopyState.id, 1)).for('update');
    if (state?.lockedAreas?.includes(area)) throw new AreaLockedError(area);
    // Re-read the customers inside the lock so a customer added a moment ago is seen.
    const fresh = await areaPlan(tx as unknown as Db, src, area, []);
    const names = fresh.map(([t]) => sql.identifier(getTableName(t)));
    await tx.execute(sql`truncate table ${sql.join(names, sql`, `)}`);
    for (const [table, rows] of fresh) {
      for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(table).values(rows.slice(i, i + CHUNK));
    }
  });
  return report;
}

/** Compare only this area's tables, every row and column. Empty = equal. */
export async function verifyArea(db: Db, src: CopySource, area: CopyArea, limitPerTable = 20): Promise<string[]> {
  const diffs: string[] = [];
  for (const [table, expected] of await areaPlan(db, src, area, [])) {
    const name = getTableName(table);
    const actual = (await db.select().from(table)) as Loose[];
    if (actual.length !== expected.length) diffs.push(`${name}: ${actual.length} rows in Postgres, ${expected.length} expected`);
    const pk = primaryKeyOf(table);
    const keyOf = (row: Loose) => JSON.stringify(pk.length === 1 ? row[pk[0]] : pk.map(k => row[k]));
    const byKey = new Map(actual.map(row => [keyOf(row), row]));
    const numeric = new Set(Object.entries(getTableColumns(table)).filter(([, col]) => col.columnType === 'PgNumeric').map(([key]) => key));
    const value = (col: string, v: unknown) => numeric.has(col) && v != null ? Number(v) : norm(v);
    let shown = 0;
    for (const want of expected) {
      const got = byKey.get(keyOf(want));
      const problem = !got ? 'missing' : Object.entries(want)
        .filter(([col, v]) => JSON.stringify(value(col, v)) !== JSON.stringify(value(col, got[col]))).map(([col]) => col).join(', ');
      if (problem && shown++ < limitPerTable) diffs.push(`${name} ${keyOf(want)}: ${problem === 'missing' ? 'missing' : `differs in ${problem}`}`);
    }
    if (shown > limitPerTable) diffs.push(`${name}: ${shown - limitPerTable} more differences`);
  }
  return diffs;
}

/**
 * The staff area's cutover copy: Users, Roles and Locations brought in line **in place**
 * (src/db/reference/syncReference.ts) — a truncating copy can't be used, every other table points at them.
 * Dry run (write: false) only counts. Refuses once the area is locked.
 */
export async function syncStaffFromMongo(db: Db, src: CopySource, options: { write: boolean }): Promise<CopyReport> {
  const problems: CopyProblem[] = [];
  const { rows } = referenceRows(src, problems);
  const counts = { locations: rows.locations.length, roles: rows.roles.length, users: rows.users.length, user_locations: rows.userLocations.length, location_report_recipients: rows.locationReportRecipients.length };
  const report: CopyReport = { copiedAt: new Date().toISOString(), source: { staff: rows.users.length }, tables: counts, summary: summarize(problems), problems };
  if (!options.write) return report;
  const [state] = await db.select().from(schema.mongoCopyState).where(eq(schema.mongoCopyState.id, 1));
  if (state?.lockedAreas?.includes('staff')) throw new AreaLockedError('staff');
  // Only Users, Roles and Locations: the type lists move on their own switch (syncTypesFromMongo).
  const sync = await syncReference(db, src, { staff: true, types: false });
  if (sync.kept.length) report.problems.push(...sync.kept.map(k => ({ table: 'staff', id: k, field: '', reason: 'removed from MongoDB but Postgres still needs it: kept', outcome: 'skipped' as const })));
  return report;
}

/**
 * The type lists' cutover copy: visit types, resource types and families brought in line **in place**
 * (a truncating copy can't be used — customers' records point at them). Dry run only counts.
 */
export async function syncTypesFromMongo(db: Db, src: CopySource, options: { write: boolean }): Promise<CopyReport> {
  const problems: CopyProblem[] = [];
  const { rows } = referenceRows(src, problems);
  const counts = { visit_types: rows.visitTypes.length, resource_families: rows.resourceFamilies.length, resource_types: rows.resourceTypes.length };
  const report: CopyReport = { copiedAt: new Date().toISOString(), source: { types: rows.visitTypes.length + rows.resourceTypes.length }, tables: counts, summary: summarize(problems), problems };
  if (!options.write) return report;
  const [state] = await db.select().from(schema.mongoCopyState).where(eq(schema.mongoCopyState.id, 1));
  if (state?.lockedAreas?.includes('types')) throw new AreaLockedError('types');
  const sync = await syncReference(db, src, { staff: false, types: true });
  if (sync.kept.length) report.problems.push(...sync.kept.map(k => ({ table: 'types', id: k, field: '', reason: 'removed from MongoDB but Postgres still needs it: kept', outcome: 'skipped' as const })));
  return report;
}

/** After this area's cutover: its scoped copy refuses for good. */
export async function lockArea(db: Db, area: CopyArea | 'staff' | 'types', by: string): Promise<void> {
  const [state] = await db.select().from(schema.mongoCopyState).where(eq(schema.mongoCopyState.id, 1));
  const areas = [...new Set([...(state?.lockedAreas ?? []), area])];
  await db.insert(schema.mongoCopyState).values({ id: 1, lockedAreas: areas })
    .onConflictDoUpdate({ target: schema.mongoCopyState.id, set: { lockedAreas: areas } });
  console.log(`${area} locked by ${by}`);
}

/** At cutover: stop copies for good on this database. */
export async function lockCopies(db: Db, by: string): Promise<void> {
  await db.insert(schema.mongoCopyState).values({ id: 1, lockedAt: new Date(), lockedBy: by })
    .onConflictDoUpdate({ target: schema.mongoCopyState.id, set: { lockedAt: new Date(), lockedBy: by } });
}
