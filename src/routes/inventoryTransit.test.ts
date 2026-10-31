import { beforeEach, afterEach, beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import InventoryTransitReport, { InventoryTransitEvent } from '../models/InventoryTransitReport.ts';
import { inventoryRevision } from '../services/inventoryTransaction.ts';
import { utils, write } from 'xlsx';
import InventorySalesRecord from '../models/InventorySalesRecord.ts';
import { PurchasingScope } from '../purchasing/models.ts';
import Location from '../models/Location.ts';
import { sourceData } from '../purchasing/data.ts';
import { reportIdentity } from '../purchasing/reportIdentity.ts';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import createRouter from './inventoryAnalysis.ts';
import InventoryTransitShipment from '../models/InventoryTransitShipment.ts';

let app: express.Express;
let rs: MongoMemoryReplSet;
let emit: ReturnType<typeof vi.fn>;
const file = (slabs = 31) => Buffer.from(`Product\tPO#\tContainer#\tLocation\tSlabs\tQuantity\tUnits\tETADate\tStatus\nCarrara Prima Select 3CM\t15364\tTEMU1379996\tRichmond\t${slabs} Slabs\t2,237.89\tSF\t11/24/26\tINTRANSIT\nCarrara Prima Select 3CM\t15364\tTEMU1379996\tRichmond\t21 Slabs\t1,515.99\tSF\t11/24/26\tINTRANSIT`);
const post = (path: string, buffer = file()) => request(app).post(`/import/transit/${path}`).attach('file', buffer, 'SPS.xls');
beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(rs.getUri());
  await Promise.all([InventoryTransitShipment.init(), InventoryTransitReport.init(), InventoryTransitEvent.init(), InventorySalesRecord.init(), PurchasingScope.init(), Location.init()]);
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await rs?.stop(); });
beforeEach(async () => {
  await Promise.all([InventoryTransitShipment.deleteMany({}), InventoryTransitReport.deleteMany({}), InventoryTransitEvent.deleteMany({}), InventorySalesRecord.deleteMany({}), PurchasingScope.deleteMany({}), Location.deleteMany({})]);
  emit = vi.fn();
  app = express(); app.use(express.json()); app.set('io', { emit });
  app.use(createRouter({
    authenticate: (req, res, next) => { req.user = { id: String(req.headers['x-user'] || 'u1'), username: 'Krish', permissions: [] }; next(); },
    requirePermission: permission => (req, res, next) => req.headers['x-deny'] === permission ? res.sendStatus(403) : next(),
    uploadMemory: multer({ storage: multer.memoryStorage() })
  }));
});
afterEach(() => vi.restoreAllMocks());

describe('in-transit preview, persistence and display API', () => {
  it('previews PO details, applies cached data, and returns them for display', async () => {
    const preview = await post('preview');
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ totalRows: 2, shipmentCount: 1 });
    expect(preview.body.sample[0]).toMatchObject({ poNumber: '15364', containerNumber: 'TEMU1379996', quantity: 2237.89 });
    expect(await InventoryTransitShipment.countDocuments()).toBe(0);
    const applied = await request(app).post('/import/transit/apply').send({ uploadId: preview.body.uploadId });
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ count: 2, shipmentCount: 1 });
    const list = await request(app).get('/in-transit');
    expect(list.body.shipments[0]).toMatchObject({ poNumber: '15364', containerNumber: 'TEMU1379996', location: 'Richmond' });
    expect(list.body.shipments[0].lines.map((row: { slabs: number }) => row.slabs)).toEqual([31, 21]);
    expect(emit).toHaveBeenCalledWith('inventory_analysis_update');
  });
  it('reimports update the shipment without doubling or discarding repeated lots', async () => {
    expect((await post('apply')).status).toBe(200);
    expect((await post('apply', file(30))).status).toBe(200);
    expect(await InventoryTransitShipment.countDocuments()).toBe(1);
    expect((await InventoryTransitShipment.findOne().lean())!.lines.map(row => row.slabs)).toEqual([30, 21]);
  });
  it('refuses invalid data without writing a shipment', async () => {
    const response = await post('apply', Buffer.from(file().toString().replaceAll('2,237.89', 'invalid')));
    expect(response.status).toBe(400);
    expect(await InventoryTransitShipment.countDocuments()).toBe(0);
  });
  it('keeps cached uploads scoped to the importing user', async () => {
    const preview = await post('preview');
    const response = await request(app).post('/import/transit/apply').set('x-user', 'other').send({ uploadId: preview.body.uploadId });
    expect(response.status).toBe(410);
    expect(await InventoryTransitShipment.countDocuments()).toBe(0);
  });
  it('requires import and view permissions', async () => {
    expect((await request(app).post('/import/transit/preview').set('x-deny', 'import_inventory_analysis')).status).toBe(403);
    expect((await request(app).get('/in-transit').set('x-deny', 'view_inventory_analysis')).status).toBe(403);
  });
});

describe('transit report lifecycle', () => {
  it('archives absent shipments in a complete branch report without inferring receipt', async () => {
    await post('apply').expect(200);
    const other = Buffer.from(file().toString().replaceAll('TEMU1379996', 'CONT2').replaceAll('15364', 'P2'));
    await post('apply', other).expect(200);
    const records = await InventoryTransitShipment.find().lean();
    expect(records).toHaveLength(2);
    expect(records.find(s => s.poNumber === '15364')).toMatchObject({ active: false, inactiveReason: 'not-reported' });
    expect((await request(app).get('/in-transit')).body.shipments).toHaveLength(1);
    expect(await InventoryTransitEvent.countDocuments({ action: 'not-reported' })).toBe(1);
  });
  it('retains absent shipments for a partial report and preserves other branches', async () => {
    await post('apply').expect(200);
    const other = Buffer.from(file().toString().replaceAll('TEMU1379996', 'CONT2').replaceAll('15364', 'P2'));
    await request(app).post('/import/transit/apply').field('complete', 'false').attach('file', other, 'partial.xls').expect(200);
    expect(await InventoryTransitShipment.countDocuments({ active: true })).toBe(2);
    const seattle = Buffer.from(file().toString().replaceAll('Richmond', 'Seattle'));
    await post('apply', seattle).expect(200);
    expect(await InventoryTransitShipment.countDocuments({ active: true })).toBe(3);
  });
  it('requires an explicit empty complete report before clearing a branch', async () => {
    await post('apply').expect(200);
    const headerOnly = Buffer.from(file().toString().split('\n')[0]);
    const preview = await post('preview', headerOnly).expect(200);
    expect(preview.body.totalRows).toBe(0);
    await post('apply', headerOnly).expect(400);
    await request(app).post('/import/transit/apply').field('complete', 'true').field('confirmEmpty', 'true')
      .field('branches', JSON.stringify(['Richmond'])).attach('file', headerOnly, 'empty.xls').expect(200);
    expect(await InventoryTransitShipment.countDocuments({ active: true })).toBe(0);
  });
  it('rolls back the entire import and revision when publication fails', async () => {
    await post('apply').expect(200);
    const version = await inventoryRevision();
    vi.spyOn(InventoryTransitReport, 'create').mockRejectedValueOnce(new Error('Test publication failure'));
    await post('apply', file(30)).expect(400);
    expect((await InventoryTransitShipment.findOne().lean())!.lines[0].slabs).toBe(31);
    expect(await inventoryRevision()).toBe(version);
    expect(await InventoryTransitReport.countDocuments()).toBe(1);
  });
});

describe('atomic sales report replacement', () => {
  const start = '2026-01-01', end = '2026-09-30';
  const salesFile = () => { const book = utils.book_new(); utils.book_append_sheet(book, utils.json_to_sheet([{ Name: 'Quartz 3CM', Slabs: 5, Quantity: 375, UOM: 'SF' }]), 'Sales'); return write(book, { type: 'buffer', bookType: 'xlsx' }); };
  async function priorReport() {
    await Location.collection.insertOne({ name: 'Seattle' });
    const sale = await InventorySalesRecord.create({ product: 'Quartz 3CM', location: 'Seattle', periodStart: new Date(start), periodEnd: new Date(end), quantitySold: 300, slabsSold: 4, uom: 'SF', importedAt: new Date('2026-09-08') });
    const identity = reportIdentity('Seattle', start, end, '', [sale.toObject()]);
    const scope = await PurchasingScope.create({ name: 'Seattle', branches: ['Seattle'], cohortId: identity.legacyId, fullSalesCoverage: true });
    return { identity, scope };
  }
  const apply = (a = start, b = end) => request(app).post('/import/sales/apply').field('location', 'Seattle').field('periodStart', a).field('periodEnd', b).attach('file', salesFile(), 'sales.xlsx');
  it('keeps a legacy view attached to its report and invalidates only source coverage on reimport', async () => {
    const { identity, scope } = await priorReport();
    await apply().expect(200);
    const saved = await PurchasingScope.findById(scope._id).lean();
    expect(saved!.cohortId).toBe(identity.id);
    const source = await sourceData({ assignedLocations: ['*'] });
    expect(source.cohorts[0].id).toBe(identity.id);
    expect(source.scopes[0].fullSalesCoverage).toBe(false);
    expect(source.cohorts[0].records[0].quantitySold).toBe(375);
    expect(await InventorySalesRecord.countDocuments()).toBe(1);
  });
  it('restores neither partially replaced sales nor a partial legacy migration after failure', async () => {
    const { identity, scope } = await priorReport();
    const before = await inventoryRevision();
    vi.spyOn(InventorySalesRecord, 'insertMany').mockRejectedValueOnce(new Error('Test sales insertion failure'));
    await apply().expect(400);
    expect((await PurchasingScope.findById(scope._id).lean())!.cohortId).toBe(identity.legacyId);
    expect((await InventorySalesRecord.findOne().lean())!.quantitySold).toBe(300);
    expect(await inventoryRevision()).toBe(before);
  });
  it('accepts one-day report periods and rejects impossible calendar dates', async () => {
    await apply('2026-09-30', '2026-09-30').expect(200);
    await apply('2026-02-30', '2026-03-01').expect(400);
  });
});
