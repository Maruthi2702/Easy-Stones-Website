/**
 * Inventory stock and sales on Postgres, answering in MongoDB's shape (itemDoc.ts).
 *
 * A write builds each record as MongoDB would hold it (same defaults, trimming and stamps),
 * then makes its row with the copy's own builder (`inventoryRows`), so it writes what a
 * re-copy of MongoDB would. The stock import is ONE transaction here too: the revision and
 * state rows are updated first (their row locks serialise competing imports, as the shared
 * state record does on MongoDB), then the backup, the replacement and the import's own row.
 */
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { and, asc, desc, eq, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import {
  inventoryItems, inventorySalesRecords, inventoryRevision as revisionTable, inventoryStockImports, inventoryStockBackups, inventoryStockState
} from '../schema/inventory.ts';
import { inventoryRows, type InventorySource } from '../copy/inventoryRows.ts';
import { snapshotJson } from '../copy/linkedRows.ts';
import type { CopyProblem } from '../copy/values.ts';
import { newId } from '../ids.ts';
import { itemDoc, salesDoc } from './itemDoc.ts';
import { AGING_BOUNDS, locationList, type StockFilter } from './rules.ts';
import type { StockImportInput, StockImportResult, SalesPeriodInput, BeforeReplace, StockGroup } from './types.ts';
import type { Loose } from '../../types/records.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const STOCK_BACKUP_DAYS = 7;
const BACKUP_CHUNK_SIZE = 500;
const INSERT_BATCH_SIZE = 1000;
const DAY_MS = 86400000;

const I = inventoryItems;

/** The same filter MongoDB's regex $or / equality clauses make. */
function where(f: StockFilter): SQL | undefined {
  const locs = locationList(f.location);
  const search = f.search ? `%${String(f.search).replace(/[\\%_]/g, '\\$&')}%` : '';
  return and(
    f.product ? eq(I.product, String(f.product)) : undefined,
    f.category ? eq(I.category, String(f.category)) : undefined,
    locs.length ? (locs.length === 1 ? eq(I.location, locs[0]) : inArray(I.location, locs)) : undefined,
    f.status === 'available' ? eq(I.slabStatus, '') : f.status ? eq(I.slabStatus, String(f.status)) : undefined,
    search ? or(ilike(I.product, search), ilike(I.sku, search), ilike(I.supplier, search), ilike(I.block, search), ilike(I.serialNumber, search)) : undefined
  );
}

const num = (v: unknown) => Number(v ?? 0);
/** The first value in id (= insertion) order, which is what MongoDB's $first gives with no sort. */
const firstBy = (col: unknown) => sql`(array_agg(${col} order by ${I.id}))[1]`;

export async function summary(db: Db, filter: StockFilter, now: Date) {
  const w = where(filter);
  const [[totals], byCategory, aging, [distinct], [latest]] = await Promise.all([
    db.select({ n: sql<number>`count(*)`, value: sql<string | null>`sum(${I.assetValue})`, qty: sql<string | null>`sum(${I.availableQuantity})` }).from(I).where(w),
    db.select({ category: I.category, items: sql<number>`count(*)`, value: sql<string>`sum(${I.assetValue})`, qty: sql<string>`sum(${I.availableQuantity})` })
      .from(I).where(w).groupBy(I.category).orderBy(desc(sql`sum(${I.assetValue})`), asc(I.category)),
    (() => {
      const age = sql`extract(epoch from (${now.toISOString()}::timestamptz - ${I.receivedDate})) / 86400`;
      const bucket = sql<number | null>`case when ${age} < 0 then null ${sql.join(AGING_BOUNDS.map((b, i) => {
        const next = AGING_BOUNDS[i + 1];
        return sql` when ${age} >= ${b}${next === undefined ? sql`` : sql` and ${age} < ${next}`} then ${b}`;
      }), sql``)} else null end`;
      const aged = db.select({ bucket: bucket.as('bucket'), value: I.assetValue }).from(I).where(and(w, sql`${I.receivedDate} is not null`)).as('aged');
      return db.select({ bucket: aged.bucket, count: sql<number>`count(*)`, value: sql<string>`sum(${aged.value})` }).from(aged).groupBy(aged.bucket);
    })(),
    db.select({ n: sql<number>`count(distinct ${I.product})` }).from(I).where(w),
    db.select({ importedAt: I.importedAt, importedByName: I.importedByName }).from(I).orderBy(desc(I.importedAt)).limit(1)
  ]);
  const agingBuckets = aging
    .map(a => ({ _id: a.bucket === null ? 'unknown' : Number(a.bucket), count: num(a.count), assetValue: num(a.value) }))
    .sort((a, b) => (a._id === 'unknown' ? 1 : b._id === 'unknown' ? -1 : (a._id as number) - (b._id as number)));
  return {
    totalItems: num(totals?.n),
    totalAssetValue: num(totals?.value),
    totalAvailableQty: num(totals?.qty),
    distinctProductCount: num(distinct?.n),
    byCategory: byCategory.map(c => ({ category: c.category, items: num(c.items), assetValue: num(c.value), availableQty: num(c.qty) })) as Loose[],
    agingBuckets: agingBuckets as Loose[],
    lastImportedAt: latest?.importedAt ?? null,
    lastImportedByName: latest?.importedByName ?? ''
  };
}

export async function filterValues(db: Db) {
  const [categories, locations, statuses] = await Promise.all([
    db.selectDistinct({ v: I.category }).from(I),
    db.selectDistinct({ v: I.location }).from(I),
    db.selectDistinct({ v: I.slabStatus }).from(I)
  ]);
  return { categories: categories.map(r => r.v), locations: locations.map(r => r.v), statuses: statuses.map(r => r.v) };
}

export async function listItems(db: Db, filter: StockFilter, page: number, limit: number) {
  const w = where(filter);
  const [rows, [count]] = await Promise.all([
    // Oldest received first, no date first (as MongoDB sorts a null); id breaks ties.
    db.select().from(I).where(w).orderBy(sql`${I.receivedDate} asc nulls first`, asc(I.id)).limit(limit).offset((page - 1) * limit),
    db.select({ n: sql<number>`count(*)` }).from(I).where(w)
  ]);
  return { items: rows.map(itemDoc), total: num(count?.n) };
}

export async function groupedItems(db: Db, filter: StockFilter, page: number, limit: number) {
  const w = where(filter);
  const oldest = sql`min(${I.receivedDate})`;
  const [rows, [count]] = await Promise.all([
    db.select({
      product: I.product, category: firstBy(I.category), units: firstBy(I.units), slabCount: sql<number>`count(*)`,
      onHand: sql<string>`sum(${I.instockQty})`, available: sql<string>`sum(${I.availableQuantity})`, value: sql<string>`sum(${I.assetValue})`,
      locations: sql<string[]>`array_agg(distinct ${I.location})`, oldest: oldest.mapWith(I.receivedDate), statuses: sql<string[]>`array_agg(${I.slabStatus})`
    }).from(I).where(w).groupBy(I.product)
      // Byte order on the name, as MongoDB's default string sort.
      .orderBy(sql`${oldest} asc nulls first`, sql`${I.product} collate "C"`).limit(limit).offset((page - 1) * limit),
    db.select({ n: sql<number>`count(distinct ${I.product})` }).from(I).where(w)
  ]);
  return {
    groups: rows.map(g => ({
      _id: g.product, category: g.category, units: g.units, slabCount: num(g.slabCount), totalOnHand: num(g.onHand),
      totalAvailable: num(g.available), totalAssetValue: num(g.value), locations: g.locations, oldestReceivedDate: g.oldest ?? null, statuses: g.statuses
    })) as StockGroup[],
    total: num(count?.n)
  };
}

export async function velocityInputs(db: Db, location: unknown) {
  const locs = locationList(location);
  const stockMatch = locs.length ? inArray(I.location, locs) : undefined;
  const S = inventorySalesRecords;
  const salesMatch = locs.length ? inArray(S.location, locs) : undefined;
  const [onHand, latest] = await Promise.all([
    db.select({
      product: I.product, location: I.location, availableQuantity: sql<string>`sum(${I.availableQuantity})`, assetValue: sql<string>`sum(${I.assetValue})`,
      units: firstBy(I.units), category: firstBy(I.category)
    }).from(I).where(stockMatch).groupBy(I.product, I.location).orderBy(asc(I.product), asc(I.location)),
    db.selectDistinctOn([S.product, S.location], { product: S.product, location: S.location, quantitySold: S.quantitySold, periodStart: S.periodStart, periodEnd: S.periodEnd })
      .from(S).where(salesMatch).orderBy(asc(S.product), asc(S.location), desc(S.periodEnd), asc(S.id))
  ]);
  return {
    onHand: onHand.map(r => ({ _id: { product: r.product, location: r.location }, availableQuantity: num(r.availableQuantity), assetValue: num(r.assetValue), units: r.units, category: r.category })) as Loose[],
    latestPerKey: latest.map(r => ({ _id: { product: r.product, location: r.location }, quantitySold: num(r.quantitySold), periodStart: r.periodStart, periodEnd: r.periodEnd })) as Loose[]
  };
}

const SLAB_COLUMNS = {
  _id: I.id, type: I.type, serialNumber: I.serialNumber, barcodeId: I.barcodeId, product: I.product, category: I.category, bundle: I.bundle,
  slabNumber: I.slabNumber, block: I.block, bin: I.bin, location: I.location, dimensions: I.dimensions, instockQty: I.instockQty, slabStatus: I.slabStatus
};
const slabDoc = (r: Loose): Loose => ({ ...r, instockQty: Number(r.instockQty) });

/** Slabs whose serial #, trimmed and upper-cased, is one of the keys (MongoDB's two passes, in one). */
export async function findSlabsByKeys(db: Db, wanted: string[]): Promise<Loose[]> {
  if (!wanted.length) return [];
  const rows = await db.select(SLAB_COLUMNS).from(I).where(inArray(sql`upper(trim(${I.serialNumber}))`, wanted));
  return rows.map(slabDoc);
}

export async function findSlabByBarcode(db: Db, value: string): Promise<Loose | null> {
  const [row] = await db.select(SLAB_COLUMNS).from(I).where(sql`lower(${I.barcodeId}) = lower(${value})`).limit(1);
  return row ? slabDoc(row) : null;
}

export async function inventoryRevision(db: Db): Promise<number> {
  const [row] = await db.select().from(revisionTable).where(eq(revisionTable.id, 'inventory'));
  return row?.revision || 0;
}

function sourceOf(part: Partial<InventorySource>): InventorySource {
  return {
    inventoryItems: [], inventorySalesRecords: [], inventoryTransitShipments: [], inventoryTransitReports: [], inventoryTransitEvents: [],
    inventoryRevision: [], inventoryStockImports: [], inventoryStockBackups: [], inventoryStockState: [], ...part
  };
}

function rowsOrThrow<T>(table: string, made: T[], expected: number, problems: CopyProblem[]): T[] {
  if (made.length !== expected) throw new Error(`Inventory ${table} could not be stored: ${problems.map(p => `${p.field} ${p.reason}`).join('; ') || 'a row has no id'}`);
  return made;
}

/** What `touch` does on MongoDB: make sure the guard rows exist (outside the transaction), and bump the revision inside it. */
async function ensureGuards(db: Db) {
  await db.insert(revisionTable).values({ id: 'inventory', revision: 0 }).onConflictDoNothing();
  await db.insert(inventoryStockState).values({ id: 'stock', version: 0 }).onConflictDoNothing();
}
const touchRevision = (tx: Db | Tx) => (tx as Db).update(revisionTable).set({ revision: sql`${revisionTable.revision} + 1` }).where(eq(revisionTable.id, 'inventory'));

/** A catalog item as MongoDB holds it in a backup: its ObjectId, plain fields, the driver's version counter. */
const backupItem = (r: typeof I.$inferSelect): Loose => ({ ...itemDoc(r), _id: new mongoose.Types.ObjectId(r.id), __v: 0 });

export async function importStock(db: Db, { rows, sourceFilename = '', sourceHash = '', importedById = null, importedByName = '' }: StockImportInput): Promise<StockImportResult> {
  if (!rows.length) throw new Error('No stock rows to import');
  const importId = randomUUID();
  const importedAt = new Date();
  const backupExpiresAt = new Date(importedAt.getTime() + STOCK_BACKUP_DAYS * DAY_MS);
  const docs = rows.map(row => ({ ...row, _id: newId(), importedAt, importedById, importedByName, createdAt: importedAt, updatedAt: importedAt }));
  const problems: CopyProblem[] = [];
  const newRows = rowsOrThrow('items', inventoryRows(sourceOf({ inventoryItems: docs }), problems).inventoryItems, docs.length, problems);

  await ensureGuards(db);
  return db.transaction(async tx => {
    await touchRevision(tx);
    const [state] = await tx.update(inventoryStockState).set({ version: sql`${inventoryStockState.version} + 1`, importId })
      .where(eq(inventoryStockState.id, 'stock')).returning({ version: inventoryStockState.version });
    if (!state) throw new Error('Could not obtain the stock import publication record');
    // MongoDB's TTL index removes backups after seven days; here the next import does.
    await tx.delete(inventoryStockBackups).where(lt(inventoryStockBackups.expiresAt, importedAt));
    const previous = await tx.select().from(I).orderBy(asc(I.id));
    let backupChunks = 0;
    for (let start = 0; start < previous.length; start += BACKUP_CHUNK_SIZE) {
      await tx.insert(inventoryStockBackups).values({
        id: `${importId}:${backupChunks}`, importId, chunk: backupChunks,
        items: snapshotJson(previous.slice(start, start + BACKUP_CHUNK_SIZE).map(backupItem)), expiresAt: backupExpiresAt
      });
      backupChunks++;
    }
    await tx.delete(I);
    for (let start = 0; start < newRows.length; start += INSERT_BATCH_SIZE) await tx.insert(I).values(newRows.slice(start, start + INSERT_BATCH_SIZE));
    await tx.insert(inventoryStockImports).values({
      id: importId, version: state.version, sourceFilename, sourceHash, count: docs.length, previousCount: previous.length, backupChunks,
      importedAt, importedById, importedByName, backupExpiresAt
    });
    return { importId, count: docs.length, importedAt, version: state.version };
  });
}

/** What Mongoose's schema does on an insert: trim the product, default what is missing, refuse a missing product or location. */
function salesChecked(r: Record<string, unknown>, at: SalesPeriodInput): Loose {
  const out: Loose = { ...r, location: at.location, periodStart: at.periodStart, periodEnd: at.periodEnd, importedAt: at.importedAt, importedByName: at.importedByName, importedById: at.importedById };
  if (typeof out.product === 'string') out.product = out.product.trim();
  if (!out.product) throw new Error('InventorySalesRecord validation failed: product: Path `product` is required.');
  return out;
}

export async function replaceSalesPeriod(db: Db, input: SalesPeriodInput, beforeReplace?: BeforeReplace): Promise<void> {
  const { location, periodStart, periodEnd } = input;
  const now = new Date();
  const docs = input.rows.map(r => ({ ...salesChecked(r, input), _id: newId(), createdAt: now, updatedAt: now }));
  const problems: CopyProblem[] = [];
  const newRows = rowsOrThrow('sales', inventoryRows(sourceOf({ inventorySalesRecords: docs }), problems).inventorySalesRecords, docs.length, problems);
  const S = inventorySalesRecords;
  const period = and(eq(S.location, location), eq(S.periodStart, periodStart), eq(S.periodEnd, periodEnd));
  await ensureGuards(db);
  await db.transaction(async tx => {
    await touchRevision(tx);
    const previous = await tx.select().from(S).where(period).orderBy(asc(S.id));
    if (previous.length && beforeReplace) await beforeReplace(previous.map(salesDoc), {});
    await tx.delete(S).where(period);
    for (let start = 0; start < newRows.length; start += INSERT_BATCH_SIZE) await tx.insert(S).values(newRows.slice(start, start + INSERT_BATCH_SIZE));
  });
}
