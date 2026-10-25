import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import createRouter from './router.js';
import {
  PurchasingScope,
  PurchasingInbound,
  PurchasingDraft,
  PurchasingLock,
  PurchasingPoLink,
} from './models.js';
import InventoryItem from '../models/InventoryItem.js';
import InventorySalesRecord from '../models/InventorySalesRecord.js';
import Location from '../models/Location.js';
import { SlabReservation } from '../holds/models.js';
let rs, app;
const clock = new Date('2026-10-24T20:00:00Z');
const ADMIN = {
  id: 'buyer1',
  displayName: 'Buyer',
  assignedLocations: ['*'],
  permissions: ['view_inventory_analysis', 'view_purchasing', 'manage_purchasing', 'approve_purchasing'],
};
const as = (user) => ({ 'x-user': JSON.stringify(user) });
const api = (method, path, user = ADMIN) =>
  request(app)
    [method]('/api/purchasing' + path)
    .set(as(user));
const policy = {
  product: 'Quartz 3CM',
  supplier: 'ABC',
  bundleSlabs: 6,
  minimumSlabs: 0,
  sfPerSlab: 1,
  weightKg: 400,
  mixGroup: 'same-origin-window',
  active: true,
};
const supply = {
  po: 'P1',
  line: '1',
  product: 'Quartz 3CM',
  branch: 'Seattle',
  supplier: 'ABC',
  ordered: 24,
  received: 0,
  cancelled: 0,
  eta: '2026-12-08',
  confirmed: true,
  shipment: '',
  shipped: 0,
  shipmentReceived: 0,
  shipmentEta: '',
};
async function setup(over = {}) {
  const meta = (await api('get', '/metadata')).body;
  const body = {
    name: 'Seattle buying',
    branches: ['Seattle'],
    cohortId: meta.cohorts[0].id,
    observedThrough: '2026-10-24',
    fullSalesCoverage: true,
    stockSnapshotId: meta.stockSnapshotId,
    stockCoverageConfirmed: true,
    freeStockValidated: true,
    policyConfirmed: true,
    reviewDays: 7,
    bufferDays: 21,
    stockMaxHours: 24,
    salesMaxDays: 14,
    aliases: [],
    policies: [policy],
    container: { payloadKg: 25000, tareKg: 600, maxSlabs: 60, layoutConfirmed: true, mixingConfirmed: true },
    ...over,
  };
  const res = await api('post', '/scopes').send(body).expect(201);
  const id = res.body._id;
  await api('post', `/scopes/${id}/inbound`)
    .send({ complete: true, rows: [supply] })
    .expect(201);
  return { id, body };
}
const plan = async (id) => (await api('get', `/scopes/${id}/plan`).expect(200)).body;
const draftBody = (p) => ({
  fingerprint: p.fingerprint,
  lines: [{ key: p.rows[0].key, branch: 'Seattle', quantity: p.rows[0].protective.proposedSlabs }],
  note: 'Weekly replenishment',
});
beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(rs.getUri());
  await Promise.all([
    PurchasingScope.init(),
    PurchasingInbound.init(),
    PurchasingDraft.init(),
    PurchasingLock.init(),
    PurchasingPoLink.init(),
    InventoryItem.init(),
    InventorySalesRecord.init(),
    Location.init(),
    SlabReservation.init(),
  ]);
  app = express();
  app.use(express.json());
  app.use(
    '/api/purchasing',
    createRouter({
      now: () => clock,
      authenticate: (req, res, next) => {
        if (!req.headers['x-user']) return res.sendStatus(401);
        req.user = JSON.parse(req.headers['x-user']);
        next();
      },
    }),
  );
}, 180000);
afterAll(async () => {
  await mongoose.disconnect();
  await rs?.stop();
});
beforeEach(async () => {
  await Promise.all([
    PurchasingScope.deleteMany({}),
    PurchasingInbound.deleteMany({}),
    PurchasingDraft.deleteMany({}),
    PurchasingLock.deleteMany({}),
    PurchasingPoLink.deleteMany({}),
    InventoryItem.deleteMany({}),
    InventorySalesRecord.deleteMany({}),
    Location.deleteMany({}),
    SlabReservation.deleteMany({}),
  ]);
  await Location.collection.insertMany([{ name: 'Seattle' }, { name: 'Spokane' }]);
  await InventoryItem.collection.insertOne({
    product: 'Quartz 3CM',
    location: 'Seattle',
    units: 'SF',
    availableSlabs: 42,
    availableQuantity: 42,
    slabStatus: '',
    remnant: '',
    serialNumber: 'SER1',
    importedAt: clock,
  });
  await InventorySalesRecord.collection.insertOne({
    product: 'Quartz 3CM',
    location: 'Seattle',
    uom: 'SF',
    slabsSold: 54,
    quantitySold: 54,
    periodStart: new Date('2026-09-25T00:00:00Z'),
    periodEnd: new Date('2026-10-31T00:00:00Z'),
    importedAt: clock,
  });
});
describe('purchasing access and input validation', () => {
  it('requires both view permissions and independent write/approval permissions', async () => {
    await request(app).get('/api/purchasing/metadata').expect(401);
    await api('get', '/metadata', { ...ADMIN, permissions: ['view_inventory_analysis'] }).expect(403);
    const viewer = { ...ADMIN, permissions: ['view_inventory_analysis', 'view_purchasing'] };
    await api('get', '/metadata', viewer).expect(200);
    await api('post', '/scopes', viewer).send({}).expect(403);
    const { id } = await setup();
    await api('post', `/scopes/${id}/inbound`, viewer).send({ complete: true, rows: [] }).expect(403);
  });
  it('does not let a branch user read or alter another scope', async () => {
    const { id } = await setup();
    const other = { ...ADMIN, assignedLocations: ['Spokane'] };
    await api('get', `/scopes/${id}/plan`, other).expect(403);
    await api('post', `/scopes/${id}/inbound`, other).send({ complete: true, rows: [] }).expect(403);
    expect((await api('get', '/metadata', other)).body.cohorts).toHaveLength(0);
  });
  it('rejects a future observed cutoff and a wrong single-branch scope', async () => {
    const { id, body } = await setup();
    await api('put', `/scopes/${id}`)
      .send({ ...body, observedThrough: '2026-10-31', version: 0 })
      .expect(400);
    await api('put', `/scopes/${id}`)
      .send({ ...body, branches: ['Spokane'], version: 0 })
      .expect(400);
  });
  it('uses inclusive confirmed coverage and ignores the future requested end', async () => {
    const { id } = await setup();
    const p = await plan(id);
    expect(p.blockers).toEqual([]);
    expect(p.rows[0].protective.proposedSlabs).toBe(150);
    expect(p.rows[0].baseline.proposedSlabs).toBe(96);
  });
  it('keeps unvalidated combined-scope coverage blocked and never splits labels', async () => {
    await InventorySalesRecord.updateMany({}, { $set: { location: 'Seattle Spokane' } });
    const { id } = await setup({ branches: ['Seattle', 'Spokane'], fullSalesCoverage: false });
    const p = await plan(id);
    expect(p.rows[0].protective).toBeNull();
    expect(p.blockers.join(' ')).toMatch(/branch scope/);
  });
  it('invalidates the stock confirmation when a new import replaces the snapshot', async () => {
    const { id } = await setup();
    await InventoryItem.updateMany({}, { $set: { importedAt: new Date('2026-10-24T20:01:00Z') } });
    const p = await plan(id);
    expect(p.blockers.join(' ')).toMatch(/exact stock snapshot/);
    expect(p.rows[0].protective).toBeNull();
  });
  it('keeps missing variants visible and does not assume missing policies mean zero stock', async () => {
    await InventorySalesRecord.collection.insertOne({
      product: 'Missing 2CM',
      location: 'Seattle',
      uom: 'SF',
      quantitySold: 100,
      slabsSold: 20,
      periodStart: new Date('2026-09-25'),
      periodEnd: new Date('2026-10-31'),
      importedAt: clock,
    });
    const { id } = await setup();
    const r = (await plan(id)).rows.find((r) => r.product === 'Missing 2CM');
    expect(r.hasStock).toBe(false);
    expect(r.readySlabs).toBeNull();
    expect(r.protective).toBeNull();
  });
  it('excludes transit, remnants and app reservations without subtracting SPS holds twice', async () => {
    const { id } = await setup();
    await InventoryItem.updateMany(
      {},
      { $set: { slabStatus: 'ONHOLD', availableQuantity: 0, availableSlabs: 0 } },
    );
    const meta = (await api('get', '/metadata')).body;
    const scope = await PurchasingScope.findById(id);
    scope.stockSnapshotId = meta.stockSnapshotId;
    await scope.save();
    // One record already excluded by SPS status; app lock is not subtracted again.
    await SlabReservation.collection.insertOne({
      slabKey: 'SER1',
      branch: 'Seattle',
      holdId: new mongoose.Types.ObjectId(),
    });
    const r = (await plan(id)).rows[0];
    expect(r.readySlabs).toBe(0);
    expect(r.protective.proposedSlabs).toBe(192);
  });
  it('does not replace a valid supply snapshot when shipment totals are invalid', async () => {
    const { id } = await setup();
    await api('post', `/scopes/${id}/inbound`)
      .send({ complete: true, rows: [{ ...supply, received: 30 }] })
      .expect(400);
    expect(await PurchasingInbound.countDocuments({ scopeId: id })).toBe(1);
  });
  it('blocks unconfirmed incoming ETAs rather than silently generating duplicate buys', async () => {
    const { id } = await setup();
    await api('post', `/scopes/${id}/inbound`)
      .send({ complete: true, rows: [{ ...supply, confirmed: false }] })
      .expect(201);
    expect((await plan(id)).rows[0].blockers.join(' ')).toMatch(/unconfirmed/);
  });
});
describe('container draft workflow', () => {
  it('keeps an unrecognized SPS status out of automatic buying decisions', async () => {
    await InventoryItem.updateMany({}, { $set: { slabStatus: 'NEW-UNKNOWN-CODE' } });
    const { id } = await setup();
    const row = (await plan(id)).rows[0];
    expect(row.protective).toBeNull();
    expect(row.blockers.join(' ')).toMatch(/Unknown SPS/);
  });
  it('rejects unverified new aliases instead of treating a typo as zero stock', async () => {
    const { id, body } = await setup();
    await api('put', `/scopes/${id}`)
      .send({ ...body, version: 0, aliases: [{ salesProduct: 'Quartz 3CM', stockProduct: 'Typo variant' }] })
      .expect(400);
  });

  it('plans from actual usable SF, keeping physical slab counts separate', async () => {
    await InventoryItem.updateMany({}, { $set: { availableQuantity: 84 } });
    const { id } = await setup();
    const row = (await plan(id)).rows[0];
    expect(row.readySlabs).toBe(42);
    expect(row.protective.ready).toBe(84);
    expect(row.protective.proposedSlabs).toBe(108);
  });
  it('does not infer zero stock across incompatible units', async () => {
    await InventoryItem.updateMany({}, { $set: { units: 'EA' } });
    const { id } = await setup();
    const row = (await plan(id)).rows.find((r) => r.uom === 'SF');
    expect(row.blockers.join(' ')).toMatch(/UOM do not match/);
    expect(row.protective).toBeNull();
  });
  it('keeps a covered total with an early gap visible as an expedite exception', async () => {
    const { id } = await setup();
    await api('post', `/scopes/${id}/inbound`)
      .send({ complete: true, rows: [{ ...supply, ordered: 1000 }] })
      .expect(201);
    const row = (await plan(id)).rows[0];
    expect(row.protective.proposedSlabs).toBe(0);
    expect(row.protective.bridgeShortfall).toBeGreaterThan(0);
    expect(row.action).toBe('Expedite existing supply');
  });
  it('requires container confirmation without preventing investigation setup', async () => {
    const { id } = await setup({
      container: { payloadKg: 0, tareKg: 0, maxSlabs: 0, layoutConfirmed: false, mixingConfirmed: false },
    });
    const p = await plan(id);
    expect(p.rows[0].protective.proposedSlabs).toBe(150);
    await api('post', `/scopes/${id}/drafts`).send(draftBody(p)).expect(400);
    expect(await PurchasingDraft.countDocuments()).toBe(0);
  });
  it('cannot attribute an existing incoming PO to a newly created draft', async () => {
    const { id } = await setup();
    const p = await plan(id),
      body = draftBody(p);
    body.lines[0].quantity = 18;
    const d = (await api('post', `/scopes/${id}/drafts`).send(body).expect(201)).body;
    expect(d.inputSnapshot.rows[0].protective.proposedSlabs).toBe(150);
    await api('post', `/drafts/${d._id}/approve`)
      .send({ version: 0, note: 'Manual quantity review' })
      .expect(200);
    await api('post', `/drafts/${d._id}/link`)
      .send({ version: 1, note: 'Old PO', poLines: [JSON.stringify(['P1', '1'])] })
      .expect(400);
    expect(await PurchasingLock.countDocuments()).toBe(1);
  });
  it('serializes two approval attempts using the draft version', async () => {
    const { id } = await setup();
    const p = await plan(id),
      d = (await api('post', `/scopes/${id}/drafts`).send(draftBody(p))).body;
    const results = await Promise.all([
      api('post', `/drafts/${d._id}/approve`).send({ version: 0, note: 'First buyer' }),
      api('post', `/drafts/${d._id}/approve`).send({ version: 0, note: 'Second buyer' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('reserves variants atomically against simultaneous buyer drafts', async () => {
    const { id } = await setup();
    const p = await plan(id),
      body = draftBody(p);
    const results = await Promise.all([
      api('post', `/scopes/${id}/drafts`).send(body),
      api('post', `/scopes/${id}/drafts`).send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await PurchasingDraft.countDocuments()).toBe(1);
    expect(await PurchasingLock.countDocuments()).toBe(1);
    expect((await plan(id)).rows[0].draftId).toBeTruthy();
  });
  it('refuses stale fingerprints and quantity overrides without a note', async () => {
    const { id } = await setup();
    const p = await plan(id);
    await api('post', `/scopes/${id}/drafts`)
      .send({ ...draftBody(p), fingerprint: 'stale' })
      .expect(409);
    const body = draftBody(p);
    body.lines[0].quantity = 156;
    body.note = '';
    await api('post', `/scopes/${id}/drafts`).send(body).expect(400);
  });
  it('checks approval permissions, source freshness and decision versions', async () => {
    const { id } = await setup();
    const p = await plan(id);
    const d = (await api('post', `/scopes/${id}/drafts`).send(draftBody(p)).expect(201)).body;
    const editor = { ...ADMIN, permissions: ADMIN.permissions.filter((p) => p !== 'approve_purchasing') };
    await api('post', `/drafts/${d._id}/approve`, editor).send({ version: 0, note: 'ok' }).expect(403);
    await api('post', `/drafts/${d._id}/approve`).send({ version: 0, note: 'Reviewed' }).expect(200);
    await api('get', `/drafts/${d._id}/export`).expect(200);
    await InventoryItem.updateMany({}, { $set: { availableSlabs: 40, availableQuantity: 40 } });
    await api('get', `/drafts/${d._id}/export`).expect(409);
    await api('post', `/drafts/${d._id}/cancel`).send({ version: 0, note: 'old version' }).expect(409);
    await api('post', `/drafts/${d._id}/cancel`)
      .send({ version: 1, note: 'Refresh changed stock' })
      .expect(200);
    expect(await PurchasingLock.countDocuments()).toBe(0);
  });
  it('links approved drafts to imported SPS orders before releasing reservations', async () => {
    const { id } = await setup();
    const p = await plan(id);
    let d = (await api('post', `/scopes/${id}/drafts`).send(draftBody(p))).body;
    d = (await api('post', `/drafts/${d._id}/approve`).send({ version: 0, note: 'Reviewed' })).body;
    await api('post', `/scopes/${id}/inbound`)
      .send({ complete: true, rows: [supply, { ...supply, po: 'P2', ordered: 150 }] })
      .expect(201);
    await api('post', `/drafts/${d._id}/link`)
      .send({ version: d.__v, note: 'Placed in SPS', poLines: [JSON.stringify(['P2', '1'])] })
      .expect(200);
    expect(await PurchasingLock.countDocuments()).toBe(0);
    expect(await PurchasingPoLink.countDocuments()).toBe(1);
    expect((await plan(id)).rows[0].protective.proposedSlabs).toBe(0);
  });
});
