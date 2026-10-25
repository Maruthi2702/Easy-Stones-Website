import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import mongoose from 'mongoose';
import type { InsertManyOptions } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { utils, write } from 'xlsx';
import InventoryItem from '../models/InventoryItem.ts';
import { InventoryStockImport, InventoryStockBackup, InventoryStockState } from '../models/InventoryStockImport.ts';
import { importInventoryStock } from './inventoryStockImport.ts';
import createRouter from '../routes/inventoryAnalysis.ts';

let database: MongoMemoryReplSet;
// Narrow Mongoose's overloaded method for failure/visibility instrumentation.
const batchWriter = InventoryItem as unknown as {
  insertMany: (docs: Record<string, unknown>[], options?: InsertManyOptions) => Promise<unknown>;
};
const row = (product: string) => ({ product, location: 'Seattle', units: 'SF', type: 'SLAB',
  serialNumber: product, instockQty: 75, availableQuantity: 75, availableSlabs: 1,
  receivedDate: new Date('2026-10-25'), unitLandedCost: 15, assetValue: 1125 });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
beforeAll(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(database.getUri());
  await Promise.all([InventoryItem.init(), InventoryStockImport.init(), InventoryStockBackup.init(), InventoryStockState.init()]);
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await database?.stop(); });
beforeEach(async () => {
  await Promise.all([InventoryItem.deleteMany({}), InventoryStockImport.deleteMany({}),
    InventoryStockBackup.deleteMany({}), InventoryStockState.deleteMany({})]);
  await InventoryItem.create([row('OLD-1'), row('OLD-2')]);
});
afterEach(() => vi.restoreAllMocks());

describe('atomic stock publication', () => {
  it('publishes complete stock and retains the exact previous records for recovery', async () => {
    const previous = await InventoryItem.find().sort({ product: 1 }).lean();
    const result = await importInventoryStock({ rows: [row('NEW-1')], sourceFilename: 'stock.xlsx', sourceHash: 'hash', importedByName: 'Buyer' });
    expect(await InventoryItem.distinct('product')).toEqual(['NEW-1']);
    expect(result).toMatchObject({ count: 1, version: 1 });
    const history = await InventoryStockImport.findById(result.importId).lean();
    expect(history).toMatchObject({ count: 1, previousCount: 2, backupChunks: 1, sourceFilename: 'stock.xlsx', sourceHash: 'hash', importedByName: 'Buyer' });
    const chunks = await InventoryStockBackup.find({ importId: result.importId }).lean();
    expect(chunks.flatMap(chunk => chunk.items).sort((a, b) => String(a.product).localeCompare(String(b.product)))).toEqual(previous);
    expect(chunks[0].expiresAt.getTime() - result.importedAt.getTime()).toBe(7 * 86400000);
  });
  it('keeps old stock visible until the whole replacement has committed', async () => {
    const entered = deferred(), release = deferred();
    const original = batchWriter.insertMany.bind(InventoryItem);
    vi.spyOn(batchWriter, 'insertMany').mockImplementationOnce(async (docs, options) => {
      const inserted = await original(docs, options);
      entered.resolve();
      await release.promise;
      return inserted;
    });
    const importing = importInventoryStock({ rows: Array.from({ length: 1001 }, (_, i) => row(`NEW-${i}`)) });
    try {
      await entered.promise;
      expect(await InventoryItem.distinct('product')).toEqual(expect.arrayContaining(['OLD-1', 'OLD-2']));
      expect(await InventoryItem.countDocuments()).toBe(2);
      expect(await InventoryItem.findOne({ serialNumber: 'NEW-0' })).toBeNull();
      expect(await InventoryStockImport.countDocuments()).toBe(0);
      expect(await InventoryStockBackup.countDocuments()).toBe(0);
    } finally { release.resolve(); }
    await importing;
    expect(await InventoryItem.countDocuments()).toBe(1001);
    expect(await InventoryItem.countDocuments({ product: /^OLD/ })).toBe(0);
  });
  it('rolls back inserted rows, deletion, backup and version if a later batch fails', async () => {
    const previous = await InventoryItem.find().lean();
    const original = batchWriter.insertMany.bind(InventoryItem);
    vi.spyOn(batchWriter, 'insertMany')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Injected second batch failure'));
    await expect(importInventoryStock({ rows: Array.from({ length: 1001 }, (_, i) => row(`NEW-${i}`)) })).rejects.toThrow('second batch failure');
    expect(await InventoryItem.find().lean()).toEqual(previous);
    expect(await InventoryStockImport.countDocuments()).toBe(0);
    expect(await InventoryStockBackup.countDocuments()).toBe(0);
    expect((await InventoryStockState.findById('stock').lean())?.version).toBe(0);
  });
  it('serializes two concurrent imports without deleting either committed catalog', async () => {
    const results = await Promise.all([
      importInventoryStock({ rows: Array.from({ length: 1001 }, (_, i) => row(`A-${i}`)), sourceFilename: 'A.xlsx' }),
      importInventoryStock({ rows: Array.from({ length: 1001 }, (_, i) => row(`B-${i}`)), sourceFilename: 'B.xlsx' }),
    ]);
    expect(results.map(result => result.version).sort()).toEqual([1, 2]);
    const products = await InventoryItem.distinct('product');
    expect(products).toHaveLength(1001);
    const prefix = products[0].slice(0, 2);
    expect(products.every(product => product.startsWith(prefix))).toBe(true);
    expect(await InventoryStockImport.countDocuments()).toBe(2);
    const history = await InventoryStockImport.find().sort({ version: 1 }).lean();
    expect(history.map(run => run.previousCount)).toEqual([2, 1001]);
    expect((await InventoryStockState.findById('stock').lean())?.version).toBe(2);
  }, 30000);
  it('retries a transaction write conflict without publishing a partial catalog', async () => {
    const conflict = new mongoose.mongo.MongoServerError({
      errmsg: 'Injected write conflict', code: 112, errorLabels: ['TransientTransactionError'],
    });
    vi.spyOn(batchWriter, 'insertMany').mockRejectedValueOnce(conflict);
    const result = await importInventoryStock({ rows: [row('RETRIED')] });
    expect(result.version).toBe(1);
    expect(await InventoryItem.distinct('product')).toEqual(['RETRIED']);
    expect(await InventoryStockImport.countDocuments()).toBe(1);
    expect(await InventoryStockBackup.countDocuments()).toBe(1);
  });
});

describe('existing stock import API', () => {
  const file = () => {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([
      ['Product', 'Received Date', 'Instock Qty', 'Available Slabs', 'Available Quantity', 'Units', 'Location'],
      ['API-NEW', '10/25/2026', 75, 1, 75, 'SF', 'Seattle'],
    ]), 'Sheet 1');
    return write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };
  const app = () => {
    const instance = express(); instance.use(express.json());
    const emit = vi.fn(); instance.set('io', { emit });
    instance.use(createRouter({
      authenticate: (req, _res, next) => { req.user = { id: 'buyer', permissions: ['view_inventory_analysis', 'import_inventory_analysis'] }; next(); },
      requirePermission: () => (_req, _res, next) => next(),
      uploadMemory: multer({ storage: multer.memoryStorage() }),
    }));
    return { instance, emit };
  };
  it('keeps preview/apply compatible and broadcasts only a committed import', async () => {
    const { instance, emit } = app();
    const preview = await request(instance).post('/import/stock/preview').attach('file', file(), 'source.xlsx').expect(200);
    expect(await InventoryItem.countDocuments()).toBe(2);
    const applied = await request(instance).post('/import/stock/apply').send({ uploadId: preview.body.uploadId }).expect(200);
    expect(applied.body).toMatchObject({ success: true, count: 1, version: 1 });
    expect(await InventoryItem.distinct('product')).toEqual(['API-NEW']);
    expect((await InventoryStockImport.findById(applied.body.importId).lean())?.sourceFilename).toBe('source.xlsx');
    expect(emit).toHaveBeenCalledExactlyOnceWith('inventory_analysis_update');
  });
  it('leaves old stock intact and emits no update on import failure', async () => {
    const { instance, emit } = app();
    vi.spyOn(batchWriter, 'insertMany').mockRejectedValueOnce(new Error('Injected failure'));
    const response = await request(instance).post('/import/stock/apply').attach('file', file(), 'source.xlsx');
    expect(response.status).toBe(400);
    expect(await InventoryItem.distinct('product')).toEqual(expect.arrayContaining(['OLD-1', 'OLD-2']));
    expect(await InventoryStockImport.countDocuments()).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });
});
