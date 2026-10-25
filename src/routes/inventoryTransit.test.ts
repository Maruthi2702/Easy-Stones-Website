import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import createRouter from './inventoryAnalysis.ts';
import InventoryTransitShipment from '../models/InventoryTransitShipment.ts';

let app: express.Express;
let stored: Map<string, any>;
let emit: ReturnType<typeof vi.fn>;
const file = (slabs = 31) => Buffer.from(`Product\tPO#\tContainer#\tLocation\tSlabs\tQuantity\tUnits\tETADate\tStatus\nCarrara Prima Select 3CM\t15364\tTEMU1379996\tRichmond\t${slabs} Slabs\t2,237.89\tSF\t11/24/26\tINTRANSIT\nCarrara Prima Select 3CM\t15364\tTEMU1379996\tRichmond\t21 Slabs\t1,515.99\tSF\t11/24/26\tINTRANSIT`);
const post = (path: string, buffer = file()) => request(app).post(`/import/transit/${path}`).attach('file', buffer, 'SPS.xls');
beforeEach(() => {
  stored = new Map(); emit = vi.fn();
  vi.spyOn(InventoryTransitShipment, 'bulkWrite').mockImplementation(async operations => {
    for (const operation of operations) {
      if (!('updateOne' in operation)) continue;
      const { updateOne } = operation;
      if (Array.isArray(updateOne.update)) throw new Error('Unexpected pipeline update');
      stored.set(JSON.stringify(updateOne.filter), { _id: 'test-shipment', ...updateOne.update.$set });
    }
    return {} as Awaited<ReturnType<typeof InventoryTransitShipment.bulkWrite>>;
  });
  vi.spyOn(InventoryTransitShipment, 'find').mockImplementation(() => ({ sort: () => ({ lean: async () => [...stored.values()] }) }) as unknown as ReturnType<typeof InventoryTransitShipment.find>);
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
    expect(stored.size).toBe(0);
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
    expect(stored.size).toBe(1);
    expect([...stored.values()][0].lines.map((row: { slabs: number }) => row.slabs)).toEqual([30, 21]);
  });
  it('refuses invalid data without writing a shipment', async () => {
    const response = await post('apply', Buffer.from(file().toString().replaceAll('2,237.89', 'invalid')));
    expect(response.status).toBe(400);
    expect(stored.size).toBe(0);
  });
  it('keeps cached uploads scoped to the importing user', async () => {
    const preview = await post('preview');
    const response = await request(app).post('/import/transit/apply').set('x-user', 'other').send({ uploadId: preview.body.uploadId });
    expect(response.status).toBe(410);
    expect(stored.size).toBe(0);
  });
  it('requires import and view permissions', async () => {
    expect((await request(app).post('/import/transit/preview').set('x-deny', 'import_inventory_analysis')).status).toBe(403);
    expect((await request(app).get('/in-transit').set('x-deny', 'view_inventory_analysis')).status).toBe(403);
  });
});
