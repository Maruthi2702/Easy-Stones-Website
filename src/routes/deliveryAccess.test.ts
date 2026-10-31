import type { Loose } from '../types/records.ts';
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

const { default: createDeliveriesRouter, deliveryRoomsFor } = await import('./deliveries.ts');
const { default: Delivery } = await import('../models/Delivery.ts');

let mongo;
let app;
const emit = vi.fn();
const roomsEmittedTo = [];
let openRooms = ['delivery-location:Seattle', 'delivery-location:Spokane', 'delivery-location:*', 'some-socket-id'];

const VIEW_ONLY = { username: 'sam', role: 'sales_rep', permissions: ['view_delivery_schedule'], assignedLocations: ['Seattle'] };
const DRIVER = { username: 'angel', role: 'driver', permissions: ['view_delivery_schedule', 'delivery_driver_view'], assignedLocations: ['Seattle'] };
const OFFICE = { username: 'dee', role: 'manager', permissions: ['view_delivery_schedule', 'edit_delivery_schedule'], assignedLocations: ['Seattle'] };
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const has = (req: Loose, p: Loose) => (req.user.permissions || []).includes(p);

const DAY = '2026-10-16';
const ticket = (id: string, truckId: Loose, routeNumber: Loose, over: Loose = {}) => ({
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
    to: (room: Loose) => ({ emit: (...args: Loose[]) => { roomsEmittedTo.push(room); emit(...args); } }),
    sockets: { adapter: { rooms: { keys: () => openRooms[Symbol.iterator]() } } }
  });
  app.use('/api', createDeliveriesRouter({
    authenticate: (req: Loose, res: Loose, next: Loose) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (...ps: Loose[]) => (req: Loose, res: Loose, next: Loose) => (ps.every((p) => has(req, p)) ? next() : res.status(403).json({})),
    requireAnyPermission: (...ps: Loose[]) => (req: Loose, res: Loose, next: Loose) => (ps.some((p) => has(req, p)) ? next() : res.status(403).json({})),
    getPerformerInfo: async () => ({}),
    processBase64Images: async (x: Loose) => x,
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

describe('O2 — saving an ePOD writes the ePOD and nothing else', () => {
  const sign = (id: string, body: Loose, user = OFFICE) => request(app).patch(`/api/deliveries/${id}/pod`).set(as(user)).send(body);

  it('keeps edits made to the ticket while someone was signing', async () => {
    // The office edited the address and driver after the signer's copy was loaded.
    await Delivery.collection.updateOne({ id: 'a' }, { $set: { address: '9 New Rd', truckId: 'drv_brock', routeNumber: 4 } });
    const res = await sign('a', {
      pod: { signeeName: 'Pat' },
      // whatever else a stale copy carries is ignored
      address: '1 Main St', truckId: 'drv_angel', customerName: 'Hacked'
    }).expect(200);
    expect(res.body.status).toBe('completed');
    const a = await Delivery.findOne({ id: 'a' }).lean();
    expect(a).toMatchObject({ status: 'completed', address: '9 New Rd', truckId: 'drv_brock', customerName: 'a' });
    expect(a.pod.signeeName).toBe('Pat');
  });

  it('leaves a transfer\'s ship date alone', async () => {
    await Delivery.collection.insertOne(ticket('tr', 'drv_3rd', 1, {
      deliveryType: 'transfer', transferDestination: 'Spokane', date: '2026-10-14', expectedArrivalDate: '2026-10-16'
    }));
    await sign('tr', { pod: { signeeName: 'Pat' }, date: '2026-10-16' }).expect(200);
    expect((await Delivery.findOne({ id: 'tr' }).lean()).date).toBe('2026-10-14');
  });

  it('refuses a ticket that doesn\'t exist, a body with no ePOD, and a view-only login', async () => {
    await sign('nope', { pod: { signeeName: 'Pat' } }).expect(404);
    expect(await Delivery.countDocuments({ id: 'nope' })).toBe(0);
    await sign('a', {}).expect(400);
    await sign('a', { pod: { signeeName: 'Pat' } }, VIEW_ONLY).expect(403);
    expect((await Delivery.findOne({ id: 'a' }).lean()).status).toBe('scheduled');
  });

  it('is open to a driver, for any ticket they can reach', async () => {
    await sign('a', { pod: { signeeName: 'Pat' } }, DRIVER).expect(200);
    await sign('spokane', { pod: { signeeName: 'Pat' } }, DRIVER).expect(403);
  });
});

describe('O8 — packing-list upload', () => {
  const pdf = Buffer.from('%PDF-1.4\n%fake\n');
  const upload = (deliveryId: Loose, user = OFFICE) => request(app).post('/api/deliveries/upload-packing-list')
    .set(as(user)).field('deliveryId', deliveryId).attach('file', pdf, { filename: 'pl.pdf', contentType: 'application/pdf' });

  it('refuses another branch\'s ticket id before storing anything', async () => {
    const res = await upload('spokane').expect(403);
    expect(res.body.error).toMatch(/access/i);
  });
});

describe('O6 — reorder isn\'t refused over tickets the board doesn\'t show', () => {
  const order = (updates: Loose, user = OFFICE) => request(app).patch('/api/deliveries/order').set(as(user)).send({ updates });

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

describe('incoming transfers — receiving edits only', () => {
  const incoming = () => Delivery.create(ticket('incoming', '', 1, {
    location: 'Spokane', transferDestination: 'Seattle', deliveryType: 'transfer',
    date: DAY, expectedArrivalDate: '2026-10-18', driver: 'Sending driver'
  }));
  it('lets the receiving branch update ETA and slab count without touching shipment fields', async () => {
    await incoming();
    await request(app).patch('/api/deliveries/incoming/receiving').set(as(OFFICE))
      .send({ expectedArrivalDate: '2026-10-20', numberOfSlabs: 8 }).expect(200);
    const saved = await Delivery.findOne({ id: 'incoming' }).lean();
    expect(saved.expectedArrivalDate).toBe('2026-10-20'); expect(saved.numberOfSlabs).toBe(8);
    expect(saved.date).toBe(DAY); expect(saved.driver).toBe('Sending driver'); expect(saved.location).toBe('Spokane');
    expect(roomsEmittedTo).toContain('delivery-location:Seattle'); expect(roomsEmittedTo).toContain('delivery-location:Spokane');
  });
  it('rejects changing shipment fields, dispatch, status and deletion from the receiving branch', async () => {
    await incoming();
    await request(app).patch('/api/deliveries/incoming/receiving').set(as(OFFICE)).send({ date: '2026-10-30', truckId: 'drv_angel' }).expect(400);
    await request(app).post('/api/deliveries').set(as(OFFICE)).send({ id: 'incoming', date: '2026-10-30' }).expect(403);
    await request(app).patch('/api/deliveries/incoming/assignment').set(as(OFFICE)).send({ truckId: 'drv_angel', deliveryType: 'transfer', date: '2026-10-30' }).expect(404);
    await request(app).patch('/api/deliveries/incoming/status').set(as(OFFICE)).send({ status: 'cancelled' }).expect(404);
    await request(app).delete('/api/deliveries/incoming').set(as({ ...OFFICE, permissions: [...OFFICE.permissions, 'delete_delivery_schedule'] })).expect(404);
    expect((await Delivery.findOne({ id: 'incoming' }).lean()).date).toBe(DAY);
  });
  it('checks permission, branch access, real dates and whole slab counts', async () => {
    await incoming();
    const path = '/api/deliveries/incoming/receiving';
    await request(app).patch(path).set(as(VIEW_ONLY)).send({ numberOfSlabs: 8 }).expect(403);
    await request(app).patch(path).set(as({ ...OFFICE, assignedLocations: ['Houston'] })).send({ numberOfSlabs: 8 }).expect(404);
    for (const numberOfSlabs of [-1, 1.5, null, '']) await request(app).patch(path).set(as(OFFICE)).send({ numberOfSlabs }).expect(400);
    for (const expectedArrivalDate of ['2026-02-30', '2026-10-15', '']) await request(app).patch(path).set(as(OFFICE)).send({ expectedArrivalDate }).expect(400);
    await request(app).patch(path).set(as(OFFICE)).send({ numberOfSlabs: 0 }).expect(200);
  });
  it('marks incoming Pending entries non-dispatchable while preserving sender access', async () => {
    await incoming();
    const { body } = await request(app).get('/api/deliveries?pending=true').set(as(OFFICE)).expect(200);
    expect(body.find((d: Loose) => d.id === 'incoming').receivingOnly).toBe(true);
    const sender = { ...OFFICE, assignedLocations: ['Spokane'] };
    await request(app).patch('/api/deliveries/incoming/assignment').set(as(sender)).send({ truckId: 'drv_sending', deliveryType: 'transfer', date: DAY }).expect(200);
  });
});
