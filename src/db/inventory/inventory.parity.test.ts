/**
 * Inventory stock and sales, through the real router and the import: each request run on
 * MongoDB, then on Postgres, must answer the same and leave the same records behind
 * (Postgres' rows are compared with what the copy makes of MongoDB's — inventoryRows is the spec).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import { asc } from 'drizzle-orm';
import { utils, write } from 'xlsx';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import InventoryItem from '../../models/InventoryItem.ts';
import InventorySalesRecord from '../../models/InventorySalesRecord.ts';
import { InventoryStockImport, InventoryStockBackup } from '../../models/InventoryStockImport.ts';
import { inventoryItems, inventorySalesRecords } from '../schema/inventory.ts';
import { inventoryRows } from '../copy/inventoryRows.ts';
import createInventoryAnalysisRouter from '../../routes/inventoryAnalysis.ts';
import { importInventoryStock, replaceSalesPeriod, findSlabsByKeys, findSlabByBarcode, inventoryRevision } from './index.ts';
import { slabKeyOf } from '../../holds/holdRules.ts';
import type { Loose } from '../../types/records.ts';

const made = vi.hoisted(() => ({ ids: [] as string[], idUsed: 0, uuids: [] as string[], uuidUsed: 0 }));
// A new record's id (and an import's id) is made inside the save: both runs of one request must get the same one.
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { made.ids[made.idUsed] ??= real.newId(); return made.ids[made.idUsed++]; } };
});
vi.mock('node:crypto', async original => {
  const real = await original<typeof import('node:crypto')>();
  const randomUUID = () => { made.uuids[made.uuidUsed] ??= real.randomUUID(); return made.uuids[made.uuidUsed++]; };
  return { ...real, default: { ...real, randomUUID }, randomUUID };
});
const resetIds = () => { made.ids.length = 0; made.idUsed = 0; made.uuids.length = 0; made.uuidUsed = 0; };
const rewindIds = () => { made.idUsed = 0; made.uuidUsed = 0; };

const NOW = new Date('2026-11-10T17:30:00.000Z');
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const ADMIN = { id: 'a'.repeat(24), username: 'root', permissions: ['view_inventory_analysis', 'view_inventory_prices', 'import_inventory_analysis'] };
const NO_PRICES = { ...ADMIN, permissions: ['view_inventory_analysis'] };
const NOBODY = { ...ADMIN, permissions: [] };

// Every field set: MongoDB's import stores the parser's rows as they come (no defaults), so a
// backup of an imported catalog only matches Postgres' when the rows are complete (see the README).
const item = (product: string, over: Loose = {}) => ({
  genericSku: '', subCategory: '', group: '', kind: '', bundle: '', slabNumber: '', idFour: '', idFive: '', suppBarcodeId: '', bin: '', dimensions: '', notes: '', remnant: '',
  product, sku: `SKU-${product}`, type: 'SLAB', category: 'Quartz', units: 'SF', serialNumber: `SN-${product}`, barcodeId: `BC-${product}`,
  location: 'Seattle', slabStatus: '', instockQty: 75, availableSlabs: 1, availableQuantity: 75, assetValue: 1125, unitLandedCost: 15, unitFobCost: 10, purchaseCost: 12,
  supplier: 'Acme', block: 'B1', receivedDate: day('2026-10-01'), importedAt: day('2026-11-01'), importedByName: 'Buyer', ...over
});
const sale = (product: string, over: Loose = {}) => ({
  product, category: 'Quartz', uom: 'SF', slabsSold: 2, quantitySold: 150, saleValue: 3000, cost: 2000, avgSellingPrice: 20, avgCost: 13, margin: 1000, marginPercent: 33,
  location: 'Seattle', periodStart: day('2026-09-01'), periodEnd: day('2026-09-30'), importedAt: day('2026-11-01'), importedByName: 'Buyer', ...over
});

let t: WriteParity;
let app: express.Express;

beforeAll(async () => {
  t = await openWriteParity(async () => {
    await InventoryItem.insertMany([
      item('Calacatta', { receivedDate: day('2026-08-01'), assetValue: 2000, availableQuantity: 100, instockQty: 100, slabStatus: 'Hold' }),
      item('Calacatta', { serialNumber: 'sn-cal-2', barcodeId: 'BC-CAL-2', receivedDate: day('2026-09-15'), location: 'Spokane', assetValue: 1000, availableQuantity: 50, instockQty: 50 }),
      item('Taj Mahal', { category: 'Granite', receivedDate: day('2026-10-20'), assetValue: 500, availableQuantity: 25, instockQty: 25, slabStatus: 'SO' }),
      item('Nero', { category: 'Granite', receivedDate: day('2025-06-01'), assetValue: 3000, availableQuantity: 200, instockQty: 200 }),
      item('Zebra 100%_', { category: '', receivedDate: null, assetValue: 0, availableQuantity: 0, instockQty: 0, supplier: 'Zed' }),
      item('Future', { receivedDate: day('2027-01-01'), assetValue: 10, availableQuantity: 1, instockQty: 1, serialNumber: ' fut-1 ' }),
    ]);
    await InventorySalesRecord.insertMany([
      sale('Calacatta'), sale('Calacatta', { periodStart: day('2026-10-01'), periodEnd: day('2026-10-31'), quantitySold: 300 }),
      sale('Taj Mahal', { quantitySold: 0 }), sale('Calacatta', { location: 'Spokane', quantitySold: 60 })
    ]);
  }, 'DB_INVENTORY');

  app = express();
  app.use(express.json());
  const need = (permission: string) => (req: Loose, res: Loose, next: () => void) => (req.user.permissions.includes(permission) ? next() : res.status(403).json({ message: 'no' }));
  app.use('/api/inventory-analysis', createInventoryAnalysisRouter({
    authenticate: ((req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }) as never,
    requirePermission: need as never,
    uploadMemory: multer({ storage: multer.memoryStorage() })
  }));
}, 240000);

afterAll(async () => { await t?.close(); });

async function same(user: Loose, send: (a: ReturnType<typeof request>) => request.Test) {
  resetIds();
  const ask = async () => { rewindIds(); const r = await send(request(app)).set(as(user)); return { status: r.status, body: r.body }; };
  const { mongo, postgres } = await t.both(ask);
  expect(postgres.status).toBe(mongo.status);
  expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  return mongo;
}

/** Postgres' rows = what the copy makes of MongoDB's now. */
async function expectSameRows() {
  const items = (await InventoryItem.find().lean()) as Loose[];
  const sales = (await InventorySalesRecord.find().lean()) as Loose[];
  const built = inventoryRows({ inventoryItems: items, inventorySalesRecords: sales, inventoryTransitShipments: [], inventoryTransitReports: [],
    inventoryTransitEvents: [], inventoryRevision: [], inventoryStockImports: [], inventoryStockBackups: [], inventoryStockState: [] }, []);
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  expect(await t.pg.db.select().from(inventoryItems).orderBy(asc(inventoryItems.id))).toEqual(byId(built.inventoryItems));
  expect(await t.pg.db.select().from(inventorySalesRecords).orderBy(asc(inventorySalesRecords.id))).toEqual(byId(built.inventorySalesRecords));
}

describe('reading stock', () => {
  it('summary: totals, categories by value, aging buckets, distinct products — with and without prices', async () => {
    const all = await same(ADMIN, a => a.get('/api/inventory-analysis/summary'));
    expect(all.body.totalItems).toBe(6);
    expect(all.body.byCategory[0]).toMatchObject({ category: 'Granite' });
    expect(all.body.agingBuckets.map((b: Loose) => b._id)).toContain('unknown');
    await same(NO_PRICES, a => a.get('/api/inventory-analysis/summary'));
    await same(ADMIN, a => a.get('/api/inventory-analysis/summary?location=Seattle,Spokane&status=available'));
    await same(ADMIN, a => a.get('/api/inventory-analysis/summary?search=zebra%20100%25_'));
    await same(ADMIN, a => a.get('/api/inventory-analysis/summary?search=nothing-matches'));
    await same(ADMIN, a => a.get('/api/inventory-analysis/summary?status=Hold&category=Quartz'));
  });

  it('filters lists the categories, locations and statuses', async () => {
    const r = await same(ADMIN, a => a.get('/api/inventory-analysis/filters'));
    expect(r.body.locations).toEqual(['Seattle', 'Spokane']);
  });

  it('items: paged, oldest received first, prices only with the permission', async () => {
    const r = await same(ADMIN, a => a.get('/api/inventory-analysis/items?limit=3'));
    expect(r.body.items[0].product).toBe('Zebra 100%_');
    await same(ADMIN, a => a.get('/api/inventory-analysis/items?limit=2&page=2'));
    await same(NO_PRICES, a => a.get('/api/inventory-analysis/items?search=SN-CAL'));
    await same(ADMIN, a => a.get('/api/inventory-analysis/items?product=Calacatta&location=Spokane'));
    await same(ADMIN, a => a.get('/api/inventory-analysis/items?search=BLOCK'));
    await same(ADMIN, a => a.get('/api/inventory-analysis/items?search=b1&limit=200'));
  });

  it('grouped items: one row per product, oldest first, status counts', async () => {
    const r = await same(ADMIN, a => a.get('/api/inventory-analysis/items/grouped'));
    expect(r.body.total).toBe(5);
    await same(ADMIN, a => a.get('/api/inventory-analysis/items/grouped?limit=2&page=2'));
    await same(NO_PRICES, a => a.get('/api/inventory-analysis/items/grouped?category=Granite'));
    await same(ADMIN, a => a.get('/api/inventory-analysis/items/grouped?location=Seattle'));
  });

  it('velocity: days of supply from the latest period per product + location', async () => {
    const sortedRows = async (user: Loose, url: string) => {
      resetIds();
      const ask = async () => { const r = await request(app).get(url).set(as(user)); return { status: r.status, body: r.body }; };
      const { mongo, postgres } = await t.both(ask);
      const order = (rows: Loose[]) => [...rows].sort((a, b) => `${a.product}${a.location}`.localeCompare(`${b.product}${b.location}`));
      expect(postgres.status).toBe(mongo.status);
      expect(normalize(order(postgres.body.rows))).toEqual(normalize(order(mongo.body.rows)));
      return mongo;
    };
    const r = await sortedRows(ADMIN, '/api/inventory-analysis/velocity');
    expect(r.body.rows.find((x: Loose) => x.product === 'Calacatta' && x.location === 'Seattle').quantitySoldInPeriod).toBe(300);
    await sortedRows(NO_PRICES, '/api/inventory-analysis/velocity?location=Seattle');
    await sortedRows(ADMIN, '/api/inventory-analysis/velocity?location=Seattle,Spokane');
  });

  it('refuses a login without the page', async () => {
    expect((await same(NOBODY, a => a.get('/api/inventory-analysis/summary'))).status).toBe(403);
  });
});

describe('the reads Cart & Holds will need', () => {
  it('finds slabs by trimmed, upper-cased serial #, and a slab by barcode', async () => {
    const wanted = ['SN-CALACATTA', 'SN-CAL-2', 'FUT-1', 'NOPE'];
    const ask = async () => (await findSlabsByKeys(wanted, slabKeyOf)).map(s => slabKeyOf(s.serialNumber)).sort();
    const { mongo, postgres } = await t.both(ask);
    expect(postgres).toEqual(mongo);
    expect(mongo).toEqual(['FUT-1', 'SN-CAL-2', 'SN-CALACATTA']);
    const byCode = await t.both(() => findSlabByBarcode('bc-cal-2'));
    expect(normalize(byCode.postgres)).toEqual(normalize(byCode.mongo));
    expect(byCode.mongo?.serialNumber).toBe('sn-cal-2');
    const none = await t.both(() => findSlabByBarcode('missing'));
    expect(none).toEqual({ mongo: null, postgres: null });
  });
});

describe('publishing stock', () => {
  it('replaces the catalog, keeps the previous one as a backup, counts a version and a revision', async () => {
    resetIds();
    const rows = [item('New A', { receivedDate: day('2026-11-05') }), item('New B', { location: 'Spokane' })].map(({ importedAt: _i, importedByName: _n, ...r }) => r);
    const input = { rows, sourceFilename: 'stock.xlsx', sourceHash: 'abc', importedByName: 'Buyer', importedById: 'b'.repeat(24) };
    const revisionBefore = await t.on('mongo', () => inventoryRevision());
    const { mongo, postgres } = await t.both(async () => { rewindIds(); return importInventoryStock(input); });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(mongo.count).toBe(2);
    expect(await t.on('mongo', () => inventoryRevision())).toBe(revisionBefore + 1);
    expect(await t.on('postgres', () => inventoryRevision())).toBe(await t.on('mongo', () => inventoryRevision()));
    await expectSameRows();
    expect(await t.differences()).toEqual([]);
    const backups = await InventoryStockBackup.find().lean();
    expect(backups.flatMap(b => b.items)).toHaveLength(6);
  });

  it('a second import: the first one becomes the backup, the version counts on, the previous count is kept', async () => {
    resetIds();
    const rows = [item('Newer', { receivedDate: day('2026-11-08') })].map(({ importedAt: _i, importedByName: _n, ...r }) => r);
    const { mongo, postgres } = await t.both(async () => { rewindIds(); return importInventoryStock({ rows, sourceFilename: 'again.xlsx', importedByName: 'Buyer' }); });
    expect(mongo.version).toBe(2);
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect((await InventoryStockImport.find().lean()).map(i => i.previousCount).sort()).toEqual([2, 6]);
    expect(await t.differences()).toEqual([]);
  });

  it('refuses an empty file and changes nothing', async () => {
    const both = await t.both(() => importInventoryStock({ rows: [] }).then(() => 'ok', (e: Error) => e.message));
    expect(both.postgres).toBe(both.mongo);
    expect(both.mongo).toBe('No stock rows to import');
  });

  it('through the route, from a real workbook', async () => {
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet([
      ['Product', 'Received Date', 'Instock Qty', 'Available Slabs', 'Available Quantity', 'Units', 'Location'],
      ['Sheet Slab', '2026-10-25', 75, 1, 75, 'SF', 'Seattle']
    ]), 'Sheet1');
    const file = write(book, { type: 'buffer', bookType: 'xlsx' });
    resetIds();
    const ask = async () => { rewindIds(); const r = await request(app).post('/api/inventory-analysis/import/stock/apply').set(as(ADMIN)).attach('file', file, 'source.xlsx'); return { status: r.status, body: r.body }; };
    const { mongo, postgres } = await t.both(ask);
    expect(mongo.status).toBe(200);
    expect(postgres.status).toBe(200);
    expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
    await expectSameRows();
    expect(await t.differences()).toEqual([]);
  });

  it('1,001 rows go in two batches in one transaction on both', async () => {
    resetIds();
    const rows = Array.from({ length: 1001 }, (_, i) => item(`Bulk ${i}`, { serialNumber: `BULK-${i}` })).map(({ importedAt: _i, importedByName: _n, ...r }) => r);
    const { mongo, postgres } = await t.both(async () => { rewindIds(); return importInventoryStock({ rows, sourceFilename: 'bulk.xlsx' }); });
    expect(postgres.count).toBe(mongo.count);
    expect((await t.pg.db.select().from(inventoryItems)).length).toBe(1001);
    await expectSameRows();
    expect(await t.differences()).toEqual([]);
  }, 120000);
});

describe('replacing a period of sales', () => {
  const rows = [{ product: ' Calacatta ', category: 'Quartz', uom: 'SF', slabsSold: 5, quantitySold: 400, saleValue: 8000, cost: 5000, avgSellingPrice: 20, avgCost: 12.5, margin: 3000, marginPercent: 37.5 },
    { product: 'Brand New', uom: 'SF', quantitySold: 10 }];
  const period = { location: 'Seattle', periodStart: day('2026-10-01'), periodEnd: day('2026-10-31'), importedByName: 'Buyer', importedById: 'b'.repeat(24) };

  it('replaces only that location + period, hands the old rows to the callback inside the transaction, and counts a revision', async () => {
    resetIds();
    const seen: unknown[] = [];
    const revisionBefore = await t.on('mongo', () => inventoryRevision());
    await t.both(async () => {
      rewindIds();
      await replaceSalesPeriod({ ...period, rows, importedAt: new Date() }, async (previous, ctx) => { seen.push([previous.length, Boolean(ctx.session), previous.map(p => p.product)]); });
    });
    // MongoDB's run has a session, Postgres' does not; both saw the one old record.
    expect(seen).toEqual([[1, true, ['Calacatta']], [1, false, ['Calacatta']]]);
    expect(await t.on('mongo', () => inventoryRevision())).toBe(revisionBefore + 1);
    expect(await t.on('postgres', () => inventoryRevision())).toBe(revisionBefore + 1);
    await expectSameRows();
    expect(await t.differences()).toEqual([]);
  });

  it('a period with nothing before it just inserts; a row with no product rolls everything back on both', async () => {
    resetIds();
    const fresh = { ...period, periodStart: day('2026-11-01'), periodEnd: day('2026-11-09') };
    await t.both(async () => { rewindIds(); await replaceSalesPeriod({ ...fresh, rows, importedAt: new Date() }); });
    await expectSameRows();
    const bad = await t.both(() => replaceSalesPeriod({ ...fresh, rows: [{ product: 'Ok', quantitySold: 1 }, { quantitySold: 2 }], importedAt: new Date() }).then(() => 'ok', (e: Error) => e.message.includes('product')));
    expect(bad).toEqual({ mongo: true, postgres: true });
    await expectSameRows();
    expect(await t.differences()).toEqual([]);
  });
});
