/**
 * The Delivery Schedule's writes, through the real router: the same request run on
 * MongoDB, then on Postgres, must answer the same and leave the same tickets behind
 * (the Postgres rows are compared with what the copy makes of MongoDB's tickets —
 * deliveryRowOf is the spec). Row ids are the one thing allowed to differ: each
 * database makes its own for a new ticket.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { asc } from 'drizzle-orm';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import Delivery from '../../models/Delivery.ts';
import Truck from '../../models/Truck.ts';
import ActivityLog from '../../models/ActivityLog.ts';
import { deliveries as deliveriesTable, trucks as trucksTable } from '../schema/operations.ts';
import { activityLogs } from '../schema/customers.ts';
import { deliveryRowOf } from '../copy/operationsRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import type { Loose } from '../../types/records.ts';

vi.mock('../../services/transferArrivalEmail.ts', () => ({ notifyArrivalLogged: async () => {} }));

const oid = () => new mongoose.Types.ObjectId();
const has = (req: Loose, p: string) => (req.user.permissions || []).includes(p);
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const ALL = ['view_delivery_schedule', 'edit_delivery_schedule', 'delete_delivery_schedule', 'clear_pod_signatures'];
const SEATTLE = { username: 'dee', role: 'manager', permissions: ALL, assignedLocations: ['Seattle'] };
const SPOKANE = { username: 'sam', role: 'manager', permissions: ALL, assignedLocations: ['Spokane'] };
const DRIVER = { username: 'angel', role: 'driver', permissions: ['view_delivery_schedule', 'delivery_driver_view'], assignedLocations: ['Seattle'] };

let t: WriteParity;
let app: express.Express;

const ticket = (id: string, over: Loose = {}) => ({
  _id: oid(), id, truckId: 'drv_angel', routeNumber: 1, date: '2026-11-10', time: '09:00 AM', location: 'Seattle',
  deliveryType: 'jobsite', status: 'scheduled', customerName: `Customer ${id}`, address: '1 Main St', numberOfSlabs: 2,
  soNumber: `SO-${id}`, createdAt: new Date('2026-11-01T10:00:00Z'), updatedAt: new Date('2026-11-09T10:00:00Z'), ...over
});

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Spokane', 'Kent'].map(name => ({ _id: oid(), name })));
    await Delivery.insertMany([
      ticket('a'), ticket('b', { routeNumber: 2, notes: 'Gate code 1234' }), ticket('c', { routeNumber: 3 }),
      ticket('p', { truckId: '', date: '', status: 'pending' }),
      ticket('x', { truckId: 'drv_k', location: 'Kent', customerName: 'Kent Co' }),
      ticket('signed', { truckId: 'drv_signed', routeNumber: 1, status: 'completed', pod: {
        signeeName: 'Pat', driverName: 'Angel', customerSignature: 'https://x.test/c.png', driverSignature: 'https://x.test/d.png',
        photos: ['https://x.test/1.jpg'], verified: true, signedAt: new Date('2026-11-10T20:00:00Z'), notes: 'left at gate' } }),
      ticket('tr', { deliveryType: 'transfer', location: 'Seattle', transferDestination: 'Spokane', truckId: 'drv_angel', routeNumber: 4,
        date: '2026-11-10', expectedArrivalDate: '2026-11-11', numberOfSlabs: 8 })
    ]);
    await Truck.create({ id: 'truck1', name: 'Truck 1', driver: 'Angel', color: '#111', location: 'Seattle' });
  }, 'DB_DELIVERIES');

  app = express();
  app.use(express.json());
  app.set('io', { emit: () => {}, to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: { keys: () => [][Symbol.iterator]() } } } });
  const { default: createDeliveriesRouter } = await import('../../routes/deliveries.ts');
  app.use('/api', createDeliveriesRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (...ps: string[]) => (req: Loose, res: Loose, next: () => void) => (ps.every(p => has(req, p)) ? next() : res.status(403).json({})),
    requireAnyPermission: (...ps: string[]) => (req: Loose, res: Loose, next: () => void) => (ps.some(p => has(req, p)) ? next() : res.status(403).json({})),
    getPerformerInfo: async () => ({ id: 'u1', name: 'Dee' }),
    processBase64Images: async (x: unknown[]) => x,
    getNowLocalISO: () => '2026-11-10T09:30:00.000'
  }));
}, 240000);

afterAll(async () => { await t?.close(); });

/** An answer without row ids; a list of records in id order (the two databases list trucks in their own order). */
const scrub = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === '_id' || k === 'entityId' ? undefined : x)),
  (_k, x) => (Array.isArray(x) && x.length > 1 && x.every(r => r && typeof r.id === 'string') ? [...x].sort((a, b) => a.id.localeCompare(b.id)) : x));

type Send = (r: request.Agent) => Promise<request.Response> | request.Test;

/** The same request on each database; same answer; same tickets afterwards. */
async function same(user: Loose, send: (agent: ReturnType<typeof request>) => request.Test) {
  const ask = async () => { const r = await send(request(app)).set(as(user)); return { status: r.status, body: r.body }; };
  const { mongo, postgres } = await t.both(ask);
  expect(postgres.status).toBe(mongo.status);
  expect(normalize(scrub(postgres.body))).toEqual(normalize(scrub(mongo.body)));
  await expectSameTickets();
  return mongo;
}

/** Postgres' tickets and trucks = what the copy makes of MongoDB's now (row ids aside). */
async function expectSameTickets() {
  const ref = await referenceIndexOf(t.pg.db);
  const strip = ({ id: _id, ...rest }: Loose) => rest;
  const fromMongo = (await Delivery.find().lean()).map(d => strip(deliveryRowOf(d as Loose, ref, { customerIds: new Set() }, []))).sort((a, b) => a.ticketId.localeCompare(b.ticketId));
  const inPostgres = (await t.pg.db.select().from(deliveriesTable).orderBy(asc(deliveriesTable.ticketId))).map(strip);
  expect(inPostgres).toEqual(fromMongo);
}

describe('saving a ticket (POST /api/deliveries)', () => {
  it('creates one and edits one', async () => {
    await same(SEATTLE, a => a.post('/api/deliveries').send(ticket('new1', { _id: undefined, routeNumber: 9, customerName: 'New Co', notes: 'Call first', salesRepName: 'Dee' })));
    await same(SEATTLE, a => a.post('/api/deliveries').send({ id: 'a', time: '11:30 AM', address: '9 Elm', notes: 'moved' }));
  });

  it('a transfer gets its arrival day; a bad one is refused', async () => {
    await same(SEATTLE, a => a.post('/api/deliveries').send(ticket('t2', { _id: undefined, deliveryType: 'transfer', transferDestination: 'Spokane', date: '2026-11-12' })));
    await same(SEATTLE, a => a.post('/api/deliveries').send(ticket('t3', { _id: undefined, deliveryType: 'transfer', transferDestination: 'Seattle' })));
    await same(SEATTLE, a => a.post('/api/deliveries').send(ticket('t4', { _id: undefined, deliveryType: 'transfer', transferDestination: '' })));
  });

  it('a driver may only sign for a ticket; the office may write the proof', async () => {
    await same(DRIVER, a => a.post('/api/deliveries').send({ id: 'b', customerName: 'Hacked', pod: { signeeName: 'Pat', notes: 'ok' } }));
    await same(SEATTLE, a => a.patch('/api/deliveries/c/pod').send({ pod: { signeeName: 'Lee', driverName: 'Angel', customerSignature: 'https://x.test/c2.png', driverSignature: 'https://x.test/d2.png', photos: [] } }));
  });

  it('refuses another branch and counts a ticket with no branch', async () => {
    await same(SEATTLE, a => a.post('/api/deliveries').send({ id: 'x', notes: 'not mine' }));
    await same(SEATTLE, a => a.post('/api/deliveries').send(ticket('nb', { _id: undefined, location: '' })));
  });
});

describe('moving tickets', () => {
  it('status, with the stops after it moving up', async () => {
    await same(SEATTLE, a => a.patch('/api/deliveries/b/status').send({ status: 'cancelled' }));
    await same(SEATTLE, a => a.patch('/api/deliveries/a/status').send({ status: 'delayed' }));
    await same(SEATTLE, a => a.patch('/api/deliveries/a/status').send({ status: 'nonsense' }));
    await same(SEATTLE, a => a.patch('/api/deliveries/zzz/status').send({ status: 'completed' }));
  });

  it('assignment: to another truck and day, back to Pending, a restored cancelled one, a will call', async () => {
    await same(SEATTLE, a => a.patch('/api/deliveries/c/assignment').send({ deliveryType: 'jobsite', truckId: 'drv_other', date: '2026-11-12' }));
    await same(SEATTLE, a => a.patch('/api/deliveries/a/assignment').send({ deliveryType: 'jobsite', truckId: '', date: '' }));
    await same(SEATTLE, a => a.patch('/api/deliveries/b/assignment').send({ deliveryType: 'jobsite', truckId: 'drv_angel', date: '2026-11-10' }));
    await same(SEATTLE, a => a.patch('/api/deliveries/p/assignment').send({ deliveryType: 'will_call', truckId: 'drv_x', date: '2026-11-13' }));
    await same(SEATTLE, a => a.patch('/api/deliveries/tr/assignment').send({ deliveryType: 'transfer', truckId: 'drv_angel', date: '2026-11-12' }));
    await same(SEATTLE, a => a.patch('/api/deliveries/c/assignment').send({ deliveryType: 'jobsite', truckId: 5, date: '2026-11-12' }));
  });

  it('a reorder, and one that clashes with a stop it did not know about', async () => {
    await same(SEATTLE, a => a.patch('/api/deliveries/order').send({ updates: [{ id: 'b', routeNumber: 1 }, { id: 'tr', routeNumber: 2 }] }));
    await same(SEATTLE, a => a.patch('/api/deliveries/order').send({ updates: [{ id: 'tr', routeNumber: 1 }] }));
    await same(SEATTLE, a => a.patch('/api/deliveries/order').send({ updates: [{ id: 'x', routeNumber: 1 }] }));
  });
});

describe('transfers', () => {
  it('the receiving branch changes the date, slabs and status — and a stale change is refused', async () => {
    await same(SPOKANE, a => a.patch('/api/deliveries/tr/receiving').send({ expectedArrivalDate: '2026-11-14', numberOfSlabs: 7 }));
    await same(SPOKANE, a => a.patch('/api/deliveries/tr/receiving').send({ status: 'completed' }));
    await same(SPOKANE, a => a.patch('/api/deliveries/tr/receiving').send({ status: 'delayed' }));
    await same(SPOKANE, a => a.patch('/api/deliveries/tr/receiving').send({ numberOfSlabs: 'x' }));
    await same(SPOKANE, a => a.patch('/api/deliveries/tr/receiving').send({ driver: 'nope' }));
  });

  it('Mark received completes it; the sender cannot', async () => {
    await same(SEATTLE, a => a.patch('/api/deliveries/t2/receive').send({}));
    await same(SPOKANE, a => a.patch('/api/deliveries/t2/receive').send({}));
    await same(SPOKANE, a => a.patch('/api/deliveries/nope/receive').send({}));
  });

  it('Log arrival saves the sender’s transfer once, and logs it', async () => {
    const body = { id: 'arrival-0001', from: 'Kent', to: 'Seattle', arrivedOn: '2026-11-09', transferNumber: 'TN-77', numberOfSlabs: '6', truckId: 'drv_angel', notes: 'came in' };
    await same(SEATTLE, a => a.post('/api/deliveries/arrivals').send(body));
    await same(SEATTLE, a => a.post('/api/deliveries/arrivals').send(body));
    await same(SEATTLE, a => a.post('/api/deliveries/arrivals').send({ ...body, id: 'arrival-0002' }));
    await same(SEATTLE, a => a.post('/api/deliveries/arrivals').send({ ...body, id: 'arrival-0003', from: 'Seattle' }));
    expect(await ActivityLog.countDocuments({ entityType: 'Delivery' })).toBe(1);
    expect(await t.pg.db.select().from(activityLogs)).toHaveLength(1);
  });
});

describe('deleting and clearing', () => {
  it('clears an ePOD with a reason, and logs it', async () => {
    await same(SEATTLE, a => a.delete('/api/deliveries/signed/pod').send({ reason: 'x' }));
    await same(SEATTLE, a => a.delete('/api/deliveries/signed/pod').send({ reason: 'Wrong customer signed' }));
    expect(await ActivityLog.countDocuments({ entityType: 'Delivery', action: 'DELETE' })).toBe(1);
    expect((await t.pg.db.select().from(activityLogs)).filter(l => l.action === 'DELETE')).toHaveLength(1);
  });

  it('deletes one and closes the stops up; another branch’s is refused', async () => {
    await same(SEATTLE, a => a.delete('/api/deliveries/a'));
    await same(SEATTLE, a => a.delete('/api/deliveries/x'));
    await same(SEATTLE, a => a.delete('/api/deliveries/a'));
  });
});

describe('trucks', () => {
  it('lists and saves', async () => {
    const save = (a: ReturnType<typeof request>) => a.post('/api/trucks').send({ trucks: [{ id: 'truck1', color: '#222' }, { id: 'truck2', name: 'Truck 2', driver: 'Lee' }] });
    await same(SEATTLE, save);
    await same(SEATTLE, a => a.get('/api/trucks'));
    const rows = (await t.pg.db.select().from(trucksTable).orderBy(asc(trucksTable.truckKey))).map(r => [r.truckKey, r.name, r.driver, r.color, r.location]);
    expect(rows).toEqual([['truck1', 'Truck 1', 'Angel', '#222', 'Seattle'], ['truck2', 'Truck 2', 'Lee', '#D4AF37', '']]);
  });
});
