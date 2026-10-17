// The delivery board's per-branch column order (GET / PUT
// /api/delivery-columns) against a throwaway in-memory MongoDB: anyone who
// sees the board reads it, only Arrange Driver Columns
// (arrange_delivery_columns) sets it — and only for the person's own
// locations — a bad list is refused, and open boards are told which branch
// changed.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createDeliveriesRouter } = await import('./deliveries.js');
const { default: Location } = await import('../models/Location.js');

let mongo;
let app;
const emit = vi.fn();

const VIEWER = { username: 'sam', permissions: ['view_delivery_schedule'] };
const DISPATCHER = { username: 'dee', permissions: ['view_delivery_schedule', 'edit_delivery_schedule'] };
const ADMIN = { username: 'krish', permissions: ['view_delivery_schedule', 'edit_delivery_schedule', 'arrange_delivery_columns'], assignedLocations: ['*'] };
// A manager an admin gave the switch to, for Seattle only.
const MANAGER = { username: 'mo', permissions: ['view_delivery_schedule', 'edit_delivery_schedule', 'arrange_delivery_columns'], assignedLocations: ['Seattle'] };
// manage_users used to be the check; sales reps hold it too.
const USER_MANAGER = { username: 'rep', permissions: ['view_delivery_schedule', 'edit_delivery_schedule', 'manage_users'], assignedLocations: ['*'] };
const as = (user) => ({ 'x-test-user': JSON.stringify(user) });
const put = (location, body, user = ADMIN) =>
  request(app).put(`/api/delivery-columns/${encodeURIComponent(location)}`).set(as(user)).send(body);

const has = (req, p) => (req.user.permissions || []).includes(p);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.set('io', { emit, to: () => ({ emit }) });
  app.use('/api', createDeliveriesRouter({
    authenticate: (req, res, next) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (...ps) => (req, res, next) => (ps.every((p) => has(req, p)) ? next() : res.status(403).json({})),
    requireAnyPermission: (...ps) => (req, res, next) => (ps.some((p) => has(req, p)) ? next() : res.status(403).json({})),
    getPerformerInfo: async () => ({}),
    processBase64Images: async (x) => x,
    getNowLocalISO: () => new Date().toISOString()
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  emit.mockClear();
  await Location.collection.deleteMany({});
  await Location.collection.insertMany([
    { name: 'Seattle', deliveryColumns: ['drv_brock', 'drv_angel'] },
    { name: 'Salt Lake City' } // saved before the field existed
  ]);
});

describe('GET /api/delivery-columns', () => {
  it('gives every branch its order, an empty list where none is set', async () => {
    const res = await request(app).get('/api/delivery-columns').set(as(VIEWER)).expect(200);
    expect(res.body).toEqual({ Seattle: ['drv_brock', 'drv_angel'], 'Salt Lake City': [] });
  });

  it('needs the board', async () => {
    await request(app).get('/api/delivery-columns').set(as({ permissions: [] })).expect(403);
  });
});

describe('PUT /api/delivery-columns/:location', () => {
  it('stores an admin\'s order and tells open boards which branch changed', async () => {
    const order = ['drv_angel', '__will_call__', 'drv_3rd party - contract'];
    const res = await put('Salt Lake City', { columns: order }).expect(200);
    expect(res.body).toEqual({ location: 'Salt Lake City', columns: order });
    expect((await Location.findOne({ name: 'Salt Lake City' }).lean()).deliveryColumns).toEqual(order);
    expect(emit).toHaveBeenCalledWith('delivery_columns_update', { location: 'Salt Lake City' });
  });

  it('an empty list puts the branch back on the default order', async () => {
    await put('Seattle', { columns: [] }).expect(200);
    expect((await Location.findOne({ name: 'Seattle' }).lean()).deliveryColumns).toEqual([]);
  });

  it('needs Arrange Driver Columns — a dispatcher, viewer or user manager can\'t change it', async () => {
    await put('Seattle', { columns: ['drv_angel'] }, DISPATCHER).expect(403);
    await put('Seattle', { columns: ['drv_angel'] }, VIEWER).expect(403);
    await put('Seattle', { columns: ['drv_angel'] }, USER_MANAGER).expect(403);
    expect((await Location.findOne({ name: 'Seattle' }).lean()).deliveryColumns).toEqual(['drv_brock', 'drv_angel']);
    expect(emit).not.toHaveBeenCalled();
  });

  it('someone given the switch arranges their own locations only', async () => {
    await put('Seattle', { columns: ['drv_angel', 'drv_brock'] }, MANAGER).expect(200);
    const res = await put('Salt Lake City', { columns: ['drv_angel'] }, MANAGER).expect(403);
    expect(res.body.error).toMatch(/your own locations/);
    expect((await Location.findOne({ name: 'Salt Lake City' }).lean()).deliveryColumns ?? []).toEqual([]);
  });

  it('refuses a bad list and keeps the saved one', async () => {
    for (const columns of [undefined, 'drv_angel', ['drv_angel', 'drv_angel'], ['drv_angel', 7], ['']]) {
      await put('Seattle', { columns }).expect(400);
    }
    expect((await Location.findOne({ name: 'Seattle' }).lean()).deliveryColumns).toEqual(['drv_brock', 'drv_angel']);
  });

  it('answers 404 for a branch that doesn\'t exist', async () => {
    await put('Atlantis', { columns: [] }).expect(404);
  });
});
