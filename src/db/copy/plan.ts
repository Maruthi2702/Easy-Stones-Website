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

export interface VerifyOptions {
  /** 'customers': only CUSTOMER_AREA_TABLES, and not the by-the-minute columns above. Default: every table, every column. */
  scope?: 'customers';
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
    const ignored = new Set(options.scope === 'customers' ? CUSTOMER_SCOPE_IGNORES[name] ?? [] : []);
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

/** At cutover: stop copies for good on this database. */
export async function lockCopies(db: Db, by: string): Promise<void> {
  await db.insert(schema.mongoCopyState).values({ id: 1, lockedAt: new Date(), lockedBy: by })
    .onConflictDoUpdate({ target: schema.mongoCopyState.id, set: { lockedAt: new Date(), lockedBy: by } });
}
