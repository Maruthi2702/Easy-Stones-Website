// Stop numbers stay 1, 2, 3… in every driver's run (renumberRuns in
// deliveries.js) against a throwaway in-memory MongoDB: a delete, a cancel, a
// drag to another driver or day, an edit that moves a ticket, and a reorder
// from a searched board each close the gap they leave, a ticket dragged into
// a run joins its end, shared stops stay shared, and the startup pass closes
// up numbers saved before the rule.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createDeliveriesRouter, renumberAllRuns } = await import('./deliveries.js');
const { default: Delivery } = await import('../models/Delivery.js');

let mongo;
let app;
const emit = vi.fn();

const ADMIN = {
  username: 'krish',
  permissions: ['view_delivery_schedule', 'edit_delivery_schedule', 'delete_delivery_schedule'],
  assignedLocations: ['*']
};
const as = (user = ADMIN) => ({ 'x-test-user': JSON.stringify(user) });
const has = (req, p) => (req.user.permissions || []).includes(p);

const DAY = '2026-10-16';
const NEXT = '2026-10-19';
const ticket = (id, truckId, routeNumber, over = {}) => ({
  id, truckId, routeNumber, date: DAY, location: 'Seattle', deliveryType: 'jobsite', status: 'scheduled', customerName: id, ...over
});

/** { id: routeNumber } for one run, read back from the database. */
const run = async (truckId, date = DAY) => Object.fromEntries(
  (await Delivery.find({ truckId, date, status: { $ne: 'cancelled' }, deliveryType: { $ne: 'will_call' } }).lean())
    .map(d => [d.id, d.routeNumber])
);
// Each record goes to its branch's room and the all-branches one; counted once.
const broadcastIds = () => [...new Set(emit.mock.calls
  .filter(([event]) => event === 'delivery_update')
  .map(([, payload]) => payload.delivery?.id)
  .filter(Boolean))];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json({ limit: '5mb' }));
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
  await Delivery.collection.deleteMany({});
  // Angel's Friday: stops 1, 2 (two invoices, one stop), 3. A transfer and an
  // older will call still pointing at the truck sit outside the run's numbers.
  await Delivery.collection.insertMany([
    ticket('a', 'angel', 1),
    ticket('b1', 'angel', 2),
    ticket('b2', 'angel', 2),
    ticket('c', 'angel', 3),
    ticket('wc', 'angel', 7, { deliveryType: 'will_call' }),
    ticket('t1', 'brock', 1),
    ticket('t2', 'brock', 2)
  ]);
});

describe('closing up a run', () => {
  it('a delete moves the stops after it up', async () => {
    await request(app).delete('/api/deliveries/a').set(as()).expect(200);
    expect(await run('angel')).toEqual({ b1: 1, b2: 1, c: 2 });
    expect(broadcastIds()).toEqual(expect.arrayContaining(['b1', 'b2', 'c']));
  });

  it('a cancel does too, and the cancelled ticket keeps its number to come back to', async () => {
    await request(app).patch('/api/deliveries/a/status').set(as()).send({ status: 'cancelled' }).expect(200);
    expect(await run('angel')).toEqual({ b1: 1, b2: 1, c: 2 });
    expect((await Delivery.findOne({ id: 'a' }).lean()).routeNumber).toBe(1);
  });

  it('a drag to another driver joins the end of their run and closes the old one', async () => {
    const res = await request(app).patch('/api/deliveries/a/assignment').set(as())
      .send({ truckId: 'brock', deliveryType: 'jobsite', date: DAY }).expect(200);
    expect(res.body.routeNumber).toBe(3);
    expect(await run('brock')).toEqual({ t1: 1, t2: 2, a: 3 });
    expect(await run('angel')).toEqual({ b1: 1, b2: 1, c: 2 });
  });

  it('a drag to an empty day becomes its Stop #1', async () => {
    const res = await request(app).patch('/api/deliveries/c/assignment').set(as())
      .send({ truckId: 'angel', deliveryType: 'jobsite', date: NEXT }).expect(200);
    expect(res.body.routeNumber).toBe(1);
  });

  it('a cancelled ticket dragged back onto its own run joins the end', async () => {
    await request(app).patch('/api/deliveries/a/status').set(as()).send({ status: 'cancelled' }).expect(200);
    const res = await request(app).patch('/api/deliveries/a/assignment').set(as())
      .send({ truckId: 'angel', deliveryType: 'jobsite', date: DAY }).expect(200);
    expect(res.body.routeNumber).toBe(3);
    expect(await run('angel')).toEqual({ b1: 1, b2: 1, c: 2, a: 3 });
  });

  it('an edit that moves the ticket closes the run it left, and the reply carries its new number', async () => {
    const res = await request(app).post('/api/deliveries').set(as())
      .send({ ...ticket('b1', 'brock', 9) }).expect(200);
    expect(res.body.routeNumber).toBe(3);
    expect(await run('brock')).toEqual({ t1: 1, t2: 2, b1: 3 });
    expect(await run('angel')).toEqual({ a: 1, b2: 2, c: 3 });
  });

  it('a reorder that covered only the searched cards still leaves no gap', async () => {
    const res = await request(app).patch('/api/deliveries/order').set(as())
      .send({ updates: [{ id: 'c', routeNumber: 5 }] }).expect(200);
    expect(await run('angel')).toEqual({ a: 1, b1: 2, b2: 2, c: 3 });
    expect(res.body.find(d => d.id === 'c').routeNumber).toBe(3);
  });

  it('leaves a run already in order alone', async () => {
    await request(app).patch('/api/deliveries/t2/status').set(as()).send({ status: 'completed' }).expect(200);
    expect(await run('brock')).toEqual({ t1: 1, t2: 2 });
    expect(broadcastIds()).toEqual(['t2']);
  });
});

describe('renumberAllRuns (startup)', () => {
  it('closes up numbers saved with gaps, once', async () => {
    await Delivery.collection.updateOne({ id: 'a' }, { $set: { routeNumber: 4 } });
    await Delivery.collection.updateOne({ id: 't1' }, { $set: { routeNumber: 3 } });
    expect(await renumberAllRuns()).toBe(6);
    expect(await run('angel')).toEqual({ b1: 1, b2: 1, c: 2, a: 3 });
    expect(await run('brock')).toEqual({ t2: 1, t1: 2 });
    expect((await Delivery.findOne({ id: 'wc' }).lean()).routeNumber).toBe(7);
    expect(await renumberAllRuns()).toBe(0);
  });
});
