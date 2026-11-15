/**
 * Inventory stock and sales on MongoDB — the routes' and the import's own Mongoose calls,
 * moved here unchanged (the stock publication used to be src/services/inventoryStockImport.ts).
 */
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import type { ClientSession, QueryFilter } from 'mongoose';
import InventoryItem from '../../models/InventoryItem.ts';
import type { InventoryStockItem } from '../../models/InventoryItem.ts';
import InventorySalesRecord from '../../models/InventorySalesRecord.ts';
import InventoryRevision from '../../models/InventoryRevision.ts';
import { InventoryStockImport, InventoryStockBackup, InventoryStockState } from '../../models/InventoryStockImport.ts';
import { inInventoryTransaction, prepareInventoryRevision, touchInventoryRevision } from '../../services/inventoryTransaction.ts';
import { withDbRetry } from '../../utils/dbRetry.ts';
import { newId } from '../ids.ts';
import { locationList, type StockFilter } from './rules.ts';
import type { Loose } from '../../types/records.ts';
import type { StockImportInput, StockImportResult, SalesPeriodInput, BeforeReplace, StockGroup } from './types.ts';

export const STOCK_BACKUP_DAYS = 7;
const BACKUP_CHUNK_SIZE = 500;
const INSERT_BATCH_SIZE = 1000;

const inventoryLocationMatch = (location: unknown) => {
  const list = locationList(location);
  if (!list.length) return undefined;
  return list.length === 1 ? list[0] : { $in: list };
};

/** Shared by the summary and the lists so they never drift apart on what a filter matches. */
const buildInventoryItemQuery = ({ search = '', category = '', location = '', status = '', product = '' }: StockFilter = {}) => {
  const query: QueryFilter<InventoryStockItem> = {};
  if (product) query.product = product as string;
  if (category) query.category = category as string;
  const locationMatch = inventoryLocationMatch(location);
  if (locationMatch) query.location = locationMatch;
  if (status === 'available') query.slabStatus = '';
  else if (status) query.slabStatus = status as string;
  if (search) {
    const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ product: re }, { sku: re }, { supplier: re }, { block: re }, { serialNumber: re }];
  }
  return query;
};

export async function summary(filter: StockFilter, now: Date) {
  const filterQuery = buildInventoryItemQuery(filter);
  const [[totals], byCategory, agingBuckets, distinctProducts, latest] = await Promise.all([
    InventoryItem.aggregate([
      { $match: filterQuery },
      { $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalAssetValue: { $sum: '$assetValue' },
          totalAvailableQty: { $sum: '$availableQuantity' }
      } }
    ]),
    InventoryItem.aggregate([
      { $match: filterQuery },
      { $group: {
          _id: '$category',
          items: { $sum: 1 },
          assetValue: { $sum: '$assetValue' },
          availableQty: { $sum: '$availableQuantity' }
      } },
      { $sort: { assetValue: -1 } },
      { $project: { _id: 0, category: { $ifNull: ['$_id', 'Uncategorized'] }, items: 1, assetValue: 1, availableQty: 1 } }
    ]),
    InventoryItem.aggregate([
      { $match: { ...filterQuery, receivedDate: { $ne: null } } },
      { $project: {
          assetValue: 1,
          ageDays: { $divide: [{ $subtract: [now, '$receivedDate'] }, 1000 * 60 * 60 * 24] }
      } },
      { $bucket: {
          groupBy: '$ageDays',
          boundaries: [0, 30, 60, 90, 180, 365, Infinity],
          default: 'unknown',
          output: { count: { $sum: 1 }, assetValue: { $sum: '$assetValue' } }
      } }
    ]),
    InventoryItem.distinct('product', filterQuery),
    // "Last synced" always reflects the most recent import overall, not the filtered subset.
    InventoryItem.findOne().sort({ importedAt: -1 }).select('importedAt importedByName').lean()
  ]);
  return {
    totalItems: totals?.totalItems || 0,
    totalAssetValue: totals?.totalAssetValue || 0,
    totalAvailableQty: totals?.totalAvailableQty || 0,
    distinctProductCount: distinctProducts.length,
    byCategory: byCategory as Loose[],
    agingBuckets: agingBuckets as Loose[],
    lastImportedAt: (latest?.importedAt as Date | undefined) || null,
    lastImportedByName: latest?.importedByName || ''
  };
}

export async function filterValues() {
  const [categories, locations, statuses] = await Promise.all([
    InventoryItem.distinct('category'),
    InventoryItem.distinct('location'),
    InventoryItem.distinct('slabStatus')
  ]);
  return { categories: categories as string[], locations: locations as string[], statuses: statuses as string[] };
}

export async function listItems(filter: StockFilter, page: number, limit: number) {
  const query = buildInventoryItemQuery(filter);
  const [items, total] = await Promise.all([
    InventoryItem.find(query).sort({ receivedDate: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    InventoryItem.countDocuments(query)
  ]);
  return { items: items as unknown as Loose[], total };
}

export async function groupedItems(filter: StockFilter, page: number, limit: number) {
  const filterQuery = buildInventoryItemQuery(filter);
  const [result] = await InventoryItem.aggregate([
    { $match: filterQuery },
    { $group: {
        _id: '$product',
        category: { $first: '$category' },
        units: { $first: '$units' },
        slabCount: { $sum: 1 },
        totalOnHand: { $sum: '$instockQty' },
        totalAvailable: { $sum: '$availableQuantity' },
        totalAssetValue: { $sum: '$assetValue' },
        locations: { $addToSet: '$location' },
        oldestReceivedDate: { $min: '$receivedDate' },
        statuses: { $push: '$slabStatus' }
    } },
    // Product name breaks ties: products received the same day used to come back in a
    // different order on every request, so paging could show one twice and skip another.
    { $sort: { oldestReceivedDate: 1, _id: 1 } },
    { $facet: {
        data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        totalCount: [{ $count: 'count' }]
    } }
  ]);
  return { groups: (result?.data || []) as StockGroup[], total: (result?.totalCount?.[0]?.count || 0) as number };
}

/** On-hand per product + location, and the latest sales period per product + location (the Reorder view's two inputs). */
export async function velocityInputs(location: unknown) {
  const locationMatch = inventoryLocationMatch(location);
  const stockMatch = locationMatch ? { location: locationMatch } : {};
  const onHand = await InventoryItem.aggregate([
    { $match: stockMatch },
    { $group: {
        _id: { product: '$product', location: '$location' },
        availableQuantity: { $sum: '$availableQuantity' },
        assetValue: { $sum: '$assetValue' },
        units: { $first: '$units' },
        category: { $first: '$category' }
    } }
  ]);
  const salesMatch = locationMatch ? { location: locationMatch } : {};
  const latestPerKey = await InventorySalesRecord.aggregate([
    { $match: salesMatch },
    { $sort: { periodEnd: -1 } },
    { $group: {
        _id: { product: '$product', location: '$location' },
        quantitySold: { $first: '$quantitySold' },
        periodStart: { $first: '$periodStart' },
        periodEnd: { $first: '$periodEnd' }
    } }
  ]);
  return { onHand: onHand as Loose[], latestPerKey: latestPerKey as Loose[] };
}

/** Slabs by serial #: case-insensitive on the serial index first, then the rest matched trimmed and upper-cased. */
const SERIAL_COLLATION = { locale: 'en', strength: 2 };
const SLAB_FIELDS = 'type serialNumber barcodeId product category bundle slabNumber block bin location dimensions instockQty slabStatus';
export async function findSlabsByKeys(wanted: string[], keyOf: (serial: unknown) => string): Promise<Loose[]> {
  if (!wanted.length) return [];
  const first = await InventoryItem.find({ serialNumber: { $in: wanted } }, SLAB_FIELDS).collation(SERIAL_COLLATION).lean() as unknown as Loose[];
  const found = new Set(first.map(i => keyOf(i.serialNumber)));
  const missing = wanted.filter(k => !found.has(k));
  if (!missing.length) return first;
  const rest = await InventoryItem.aggregate([
    { $addFields: { _key: { $toUpper: { $trim: { input: { $ifNull: ['$serialNumber', ''] } } } } } },
    { $match: { _key: { $in: missing } } },
    { $project: { _key: 0 } }
  ]);
  return [...first, ...rest];
}

export async function findSlabByBarcode(value: string): Promise<Loose | null> {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return InventoryItem.findOne({ barcodeId: { $regex: `^${escaped}$`, $options: 'i' } }, SLAB_FIELDS).lean() as unknown as Promise<Loose | null>;
}

export async function inventoryRevision(): Promise<number> {
  return (await InventoryRevision.findById('inventory').lean())?.revision || 0;
}

/**
 * Publish one complete stock catalog. Existing readers keep using InventoryItems:
 * MongoDB exposes the old or committed replacement, never partially inserted rows.
 * Writing one shared state record serializes competing publications; the driver's
 * transaction retry restarts a conflicting import against the committed catalog.
 */
export async function importStock({ rows, sourceFilename = '', sourceHash = '', importedById = null, importedByName = '' }: StockImportInput): Promise<StockImportResult> {
  if (!rows.length) throw new Error('No stock rows to import');
  const importId = randomUUID();
  const importedAt = new Date();
  const backupExpiresAt = new Date(importedAt.getTime() + STOCK_BACKUP_DAYS * 86400000);
  const docs = rows.map(row => ({ ...row, _id: new mongoose.Types.ObjectId(newId()), importedAt,
    importedById, importedByName, createdAt: importedAt, updatedAt: importedAt, __v: 0 }));

  // Collections must exist before the snapshot transaction starts. Startup also
  // creates their indexes through INDEXED_MODELS (autoIndex is disabled there).
  await Promise.all([InventoryItem.createCollection(), InventoryStockImport.createCollection(), InventoryStockBackup.createCollection()]);
  await withDbRetry(() => InventoryStockState.updateOne(
    { _id: 'stock' }, { $setOnInsert: { version: 0 } }, { upsert: true },
  ));
  await prepareInventoryRevision();
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      await touchInventoryRevision(session);
      const state = await InventoryStockState.findOneAndUpdate(
        { _id: 'stock' }, { $inc: { version: 1 }, $set: { importId } },
        { session, returnDocument: 'after' },
      );
      if (!state) throw new Error('Could not obtain the stock import publication record');
      const previous = await InventoryItem.find().session(session).lean();
      let backupChunks = 0;
      for (let start = 0; start < previous.length; start += BACKUP_CHUNK_SIZE) {
        await InventoryStockBackup.create([{
          _id: `${importId}:${backupChunks}`, importId, chunk: backupChunks,
          items: previous.slice(start, start + BACKUP_CHUNK_SIZE), expiresAt: backupExpiresAt,
        }], { session });
        backupChunks++;
      }
      await InventoryItem.deleteMany({}, { session });
      for (let start = 0; start < docs.length; start += INSERT_BATCH_SIZE) {
        await InventoryItem.insertMany(docs.slice(start, start + INSERT_BATCH_SIZE), {
          session, ordered: true, lean: true,
        });
      }
      await InventoryStockImport.create([{
        _id: importId, version: state.version, sourceFilename, sourceHash,
        count: docs.length, previousCount: previous.length, backupChunks,
        importedAt, importedById, importedByName, backupExpiresAt,
      }], { session });
      return { importId, count: docs.length, importedAt, version: state.version };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    if (!result) throw new Error('Stock import was not committed');
    return result;
  } catch (error) {
    if (error instanceof Error && /Transaction numbers are only allowed|deployment does not support retryable writes/.test(error.message))
      throw new Error('Stock was not changed. Atomic inventory imports require a MongoDB replica set with transaction support.');
    throw error;
  } finally {
    await session.endSession();
  }
}

/** Replace one location + period's sales in a single transaction; `beforeReplace` sees what is being replaced, inside it. */
export async function replaceSalesPeriod(input: SalesPeriodInput, beforeReplace?: BeforeReplace): Promise<void> {
  const { location, periodStart, periodEnd, rows, importedAt, importedByName, importedById } = input;
  await InventorySalesRecord.createCollection();
  await inInventoryTransaction(async (session: ClientSession) => {
    const previous = await InventorySalesRecord.find({ location, periodStart, periodEnd }).session(session).sort({ _id: 1 }).lean();
    if (previous.length && beforeReplace) await beforeReplace(previous as unknown as Loose[], { session });
    await InventorySalesRecord.deleteMany({ location, periodStart, periodEnd }, { session });
    for (let start = 0; start < rows.length; start += 1000) {
      await InventorySalesRecord.insertMany(rows.slice(start, start + 1000).map(r => ({ _id: new mongoose.Types.ObjectId(newId()), ...r,
        location, periodStart, periodEnd, importedAt, importedByName, importedById })), { session, ordered: true });
    }
  });
}
