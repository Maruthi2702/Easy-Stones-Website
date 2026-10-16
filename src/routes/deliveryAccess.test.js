// Delivery Schedule write access and live updates against a throwaway
// in-memory MongoDB:
//  - O4: a read-only login can't create, rewrite, re-status or "receive" a
//    ticket; a driver can only sign for one that exists, and only the ePOD and
//    "completed" are written, whatever else the phone sends back.
//  - O8: a packing-list upload can't be keyed on another branch's ticket.
//  - O6: a reorder isn't refused because of tickets the board doesn't show in
//    that cell (cancelled, will calls sharing the '' key, other branches).
//  - O5: an update for a ticket with no branch reaches every open branch room.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createDeliveriesRouter, deliveryRoomsFor } = await import('./deliveries.js');
const { default: Delivery } = await import('../models/Delivery.js');

let mongo;
let app;
const emit = vi.fn();
const roomsEmittedTo = [];
let openRooms = ['delivery-location:Seattle', 'delivery-location:Spokane', 'delivery-location:*', 'some-socket-id'];

const VIEW_ONLY = { username: 'sam', role: 'sales_rep', permissions: ['view_delivery_schedule'], assignedLocations: ['Seattle'] };
const DRIVER = { username: 'angel', role: 'driver', permissions: ['view_delivery_schedule', 'delivery_driver_view'], assignedLocations: ['Seattle'] };
const OFFICE = { username: 'dee', role: 'manager', permissions: ['view_delivery_schedule', 'edit_delivery_schedule'], assignedLocations: ['Seattle'] };
const as = (user) => ({ 'x-test-user': JSON.stringify(user) });
const has = (req, p) => (req.user.permissions || []).includes(p);

const DAY = '2026-10-16';
const ticket = (id, truckId, routeNumber, over = {}) => ({
  id, truckId, routeNumber, date: DAY, location: 'Seattle', deliveryType: 'jobsite', status: 'scheduled',
  customerName: id, address: '1 Main St', numberOfSlabs: 2, ...over
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json({ limit: '5mb' }));
  app.set('io', {
    emit,
    to: (room) => ({ emit: (...args) => { roomsEmittedTo.push(room); emit(...args); } }),
    sockets: { adapter: { rooms: { keys: () => openRooms[Symbol.iterator]() } } }
  });
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
  roomsEmittedTo.length = 0;
  await Delivery.collection.deleteMany({});
  await Delivery.collection.insertMany([
    ticket('a', 'drv_angel', 1),
    ticket('b', 'drv_angel', 2),
    ticket('spokane', 'drv_x', 1, { location: 'Spokane', customerName: 'Spokane Co' })
  ]);
});

describe('O4 — who may write a ticket', () => {
  it('refuses a read-only login every write', async () => {
    await request(app).post('/api/deliveries').set(as(VIEW_ONLY)).send(ticket('new', 'drv_angel', 1)).expect(403);
    await request(app).post('/api/deliveries').set(as(VIEW_ONLY)).send({ ...ticket('a', 'drv_angel', 1), customerName: 'Hacked' }).expect(403);
    await request(app).patch('/api/deliveries/a/status').set(as(VIEW_ONLY)).send({ status: 'completed' }).expect(403);
    await request(app).patch('/api/deliveries/a/receive').set(as(VIEW_ONLY)).send({}).expect(403);
    const a = await Delivery.findOne({ id: 'a' }).lean();
    expect(a.customerName).toBe('a');
    expect(a.status).toBe('scheduled');
    expect(await Delivery.countDocuments({ id: 'new' })).toBe(0);
  });

  it('lets the office save a whole ticket, create included', async () => {
    await request(app).post('/api/deliveries').set(as(OFFICE)).send({ ...ticket('a', 'drv_angel', 1), customerName: 'Renamed' }).expect(200);
    await request(app).post('/api/deliveries').set(as(OFFICE)).send(ticket('new', 'drv_angel', 9)).expect(200);
    expect((await Delivery.findOne({ id: 'a' }).lean()).customerName).toBe('Renamed');
    expect(await Delivery.countDocuments({ id: 'new' })).toBe(1);
  });

  it('lets a driver sign for an existing ticket, writing only the ePOD and completed', async () => {
    const res = await request(app).post('/api/deliveries').set(as(DRIVER)).send({
      ...ticket('a', 'drv_other', 7, { customerName: 'Hacked', address: 'Elsewhere', deliveryType: 'return' }),
      status: 'scheduled',
      pod: { receivedByName: 'Pat', notes: 'left at gate' }
    }).expect(200);
    expect(res.body.status).toBe('completed');
    const a = await Delivery.findOne({ id: 'a' }).lean();
    expect(a).toMatchObject({ status: 'completed', customerName: 'a', address: '1 Main St', truckId: 'drv_angel', deliveryType: 'jobsite', routeNumber: 1 });
    expect(a.pod.receivedByName).toBe('Pat');
  });

  it('refuses a driver a new ticket, or a save with no ePOD in it', async () => {
    await request(app).post('/api/deliveries').set(as(DRIVER)).send({ ...ticket('new', 'drv_angel', 1), pod: { notes: 'x' } }).expect(403);
    await request(app).post('/api/deliveries').set(as(DRIVER)).send({ ...ticket('a', 'drv_angel', 1), customerName: 'Hacked' }).expect(403);
    expect(await Delivery.countDocuments({ id: 'new' })).toBe(0);
    expect((await Delivery.findOne({ id: 'a' }).lean()).customerName).toBe('a');
  });

  it('still lets a driver set their stop\'s status', async () => {
    await request(app).patch('/api/deliveries/a/status').set(as(DRIVER)).send({ status: 'delayed' }).expect(200);
    expect((await Delivery.findOne({ id: 'a' }).lean()).status).toBe('delayed');
  });
});

describe('O8 — packing-list upload', () => {
  const pdf = Buffer.from('%PDF-1.4\n%fake\n');
  const upload = (deliveryId, user = OFFICE) => request(app).post('/api/deliveries/upload-packing-list')
    .set(as(user)).field('deliveryId', deliveryId).attach('file', pdf, { filename: 'pl.pdf', contentType: 'application/pdf' });

  it('refuses another branch\'s ticket id before storing anything', async () => {
    const res = await upload('spokane').expect(403);
    expect(res.body.error).toMatch(/access/i);
  });
});

describe('O6 — reorder isn\'t refused over tickets the board doesn\'t show', () => {
  const order = (updates, user = OFFICE) => request(app).patch('/api/deliveries/order').set(as(user)).send({ updates });

  it('ignores a cancelled ticket, a will call and a dated Pending order that share the cell\'s key', async () => {
    await Delivery.collection.insertMany([
      ticket('cancelled', 'drv_angel', 2, { status: 'cancelled' }),
      ticket('wc', 'drv_angel', 1, { deliveryType: 'will_call' }),
      // Pending with a date: truckId '' — the same key a will call is filed under.
      ticket('pending', '', 1, { status: 'pending' }),
      ticket('wcA', '', 1, { deliveryType: 'will_call' }),
      ticket('wcB', '', 2, { deliveryType: 'will_call' })
    ]);
    await order([{ id: 'b', routeNumber: 1 }, { id: 'a', routeNumber: 2 }]).expect(200);
    await order([{ id: 'wcB', routeNumber: 1 }, { id: 'wcA', routeNumber: 2 }]).expect(200);
    expect((await Delivery.findOne({ id: 'b' }).lean()).routeNumber).toBe(1);
    expect((await Delivery.findOne({ id: 'a' }).lean()).routeNumber).toBe(2);
  });

  it('ignores another branch\'s ticket on a shared column the user can\'t see', async () => {
    await Delivery.collection.insertMany([
      ticket('mine', 'drv_3rd', 1),
      ticket('theirs', 'drv_3rd', 2, { location: 'Spokane' }),
      ticket('mine2', 'drv_3rd', 3)
    ]);
    await order([{ id: 'mine2', routeNumber: 1 }, { id: 'mine', routeNumber: 2 }]).expect(200);
  });

  it('still refuses when a ticket the board shows holds a number being assigned', async () => {
    await Delivery.collection.insertOne(ticket('late', 'drv_angel', 2));
    const res = await order([{ id: 'a', routeNumber: 2 }]).expect(409);
    expect(res.body.error).toMatch(/changed since you loaded/);
  });
});

describe('O5 — a ticket with no branch reaches every open branch room', () => {
  it('lists every joined branch room for it, and only its own branch\'s for a branch ticket', () => {
    const io = { sockets: { adapter: { rooms: { keys: () => openRooms[Symbol.iterator]() } } } };
    const branchless = deliveryRoomsFor({ location: '' }, io);
    expect(branchless).toEqual(expect.arrayContaining(['delivery-location:*', 'delivery-location:Seattle', 'delivery-location:Spokane']));
    expect(branchless).not.toContain('some-socket-id');
    expect(deliveryRoomsFor({}, io)).toEqual(expect.arrayContaining(['delivery-location:Spokane']));
    expect(deliveryRoomsFor({ location: '*' }, io)).toEqual(expect.arrayContaining(['delivery-location:Seattle']));
    expect(deliveryRoomsFor({ location: 'Seattle' }, io)).toEqual(['delivery-location:*', 'delivery-location:Seattle']);
    // no server to ask: the all-branches room alone, as before
    expect(deliveryRoomsFor({ location: '' })).toEqual(['delivery-location:*']);
  });

  it('is what a save broadcasts', async () => {
    await Delivery.collection.insertOne(ticket('old', 'drv_angel', 3, { location: '' }));
    await request(app).patch('/api/deliveries/old/status').set(as({ ...OFFICE, assignedLocations: ['*'] })).send({ status: 'delayed' }).expect(200);
    expect(new Set(roomsEmittedTo)).toEqual(new Set(['delivery-location:*', 'delivery-location:Seattle', 'delivery-location:Spokane']));
  });
});
