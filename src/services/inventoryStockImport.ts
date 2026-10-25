import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import InventoryItem from '../models/InventoryItem.ts';
import { InventoryStockImport, InventoryStockBackup, InventoryStockState } from '../models/InventoryStockImport.ts';
import { prepareInventoryRevision, touchInventoryRevision } from './inventoryTransaction.ts';
import { withDbRetry } from '../utils/dbRetry.js';

export const STOCK_BACKUP_DAYS = 7;
const BACKUP_CHUNK_SIZE = 500;
const INSERT_BATCH_SIZE = 1000;
interface StockImportInput {
  rows: Record<string, unknown>[];
  sourceFilename?: string;
  sourceHash?: string;
  importedById?: string | null;
  importedByName?: string;
}
export interface StockImportResult {
  importId: string;
  count: number;
  importedAt: Date;
  version: number;
}

/**
 * Publish one complete stock catalog. Existing readers keep using InventoryItems:
 * MongoDB exposes the old or committed replacement, never partially inserted rows.
 * Writing one shared state record serializes competing publications; the driver's
 * transaction retry restarts a conflicting import against the committed catalog.
 */
export async function importInventoryStock({ rows, sourceFilename = '', sourceHash = '', importedById = null, importedByName = '' }: StockImportInput): Promise<StockImportResult> {
  if (!rows.length) throw new Error('No stock rows to import');
  const importId = randomUUID();
  const importedAt = new Date();
  const backupExpiresAt = new Date(importedAt.getTime() + STOCK_BACKUP_DAYS * 86400000);
  const docs = rows.map(row => ({ ...row, _id: new mongoose.Types.ObjectId(), importedAt,
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
