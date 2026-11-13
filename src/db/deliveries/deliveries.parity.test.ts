/**
 * The Delivery Schedule's reads, through the real router: the same requests answered
 * from MongoDB and from the Postgres copy must send the same JSON (after the evening-out
 * in ../customers/parity.ts). Board weeks, Pending, Cancelled, a branch's own view of a
 * transfer, order search, and one ticket by id — as an admin, a branch login and a
 * login that may only read its own branch.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import Delivery from '../../models/Delivery.ts';
import createDeliveriesRouter from '../../routes/deliveries.ts';
import type { Loose } from '../../types/records.ts';

const oid = () => new mongoose.Types.ObjectId();
const has = (req: Loose, p: string) => (req.user.permissions || []).includes(p);
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const VIEW = ['view_delivery_schedule'];
const ADMIN = { username: 'admin1', role: 'admin', permissions: VIEW, assignedLocations: ['*'] };
const SEATTLE = { username: 'dee', role: 'manager', permissions: VIEW, assignedLocations: ['Seattle'] };
const SPOKANE = { username: 'sam', role: 'manager', permissions: VIEW, assignedLocations: ['Spokane'] };
const TWO = { username: 'pat', role: 'manager', permissions: VIEW, assignedLocations: ['Seattle', 'Kent'] };
const NOBODY = { username: 'nobody', role: 'manager', permissions: VIEW, assignedLocations: [] };

let t: WriteParity;
let app: express.Express;

const ticket = (id: string, over: Loose = {}) => ({
  _id: oid(), id, truckId: 'drv_angel', routeNumber: 1, date: '2026-11-10', time: '09:00 AM', location: 'Seattle',
  deliveryType: 'jobsite', status: 'scheduled', customerName: `Customer ${id}`, address: '1 Main St', numberOfSlabs: 2,
  soNumber: `SO-${id}`, invoiceNumber: '', createdAt: new Date(`2026-11-0${1 + (id.length % 8)}T10:00:00Z`), updatedAt: new Date('2026-11-09T10:00:00Z'), ...over
});

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Spokane', 'Kent'].map(name => ({ _id: oid(), name })));
    // Through the model, so each ticket has the defaults every real save gives it.
    await Delivery.insertMany([
      ticket('a', { createdAt: new Date('2026-11-01T10:00:00Z') }),
      ticket('b', { routeNumber: 2, createdAt: new Date('2026-11-02T10:00:00Z'), time: '11:30 AM', salesRepName: 'Dee', notes: 'Gate code 1234',
        pod: { signeeName: 'Pat', customerSignature: 'data:image/png;base64,AAA', driverSignature: 'data:image/png;base64,BBB',
          photos: ['https://x.test/1.jpg'], verified: true, signedAt: new Date('2026-11-10T20:00:00Z'), notes: 'left at gate' } }),
      ticket('pending', { truckId: '', date: '', status: 'pending', createdAt: new Date('2026-11-03T10:00:00Z') }),
      ticket('pending-return', { truckId: '', date: '2026-11-11', deliveryType: 'return', customerDropOff: false, status: 'pending', createdAt: new Date('2026-11-04T10:00:00Z') }),
      ticket('dropoff', { truckId: '', date: '2026-11-11', deliveryType: 'return', customerDropOff: true, createdAt: new Date('2026-11-05T10:00:00Z') }),
      ticket('willcall', { truckId: '', deliveryType: 'will_call', date: '2026-11-12', createdAt: new Date('2026-11-06T10:00:00Z') }),
      ticket('cancelled', { status: 'cancelled', createdAt: new Date('2026-11-07T10:00:00Z') }),
      ticket('spokane', { location: 'Spokane', truckId: 'drv_x', customerName: 'Spokane Granite', createdAt: new Date('2026-11-08T10:00:00Z') }),
      ticket('kent', { location: 'Kent', truckId: 'drv_k', customerName: 'Kent Stone & Tile', soNumber: 'K-100%', createdAt: new Date('2026-11-09T10:00:00Z') }),
      ticket('nobranch', { location: '', truckId: 'drv_y', createdAt: new Date('2026-11-10T10:00:00Z') }),
      ticket('transfer', { deliveryType: 'transfer', location: 'Seattle', transferDestination: 'Spokane', date: '2026-11-09', expectedArrivalDate: '2026-11-11',
        numberOfSlabs: 8, truckId: 'drv_angel', createdAt: new Date('2026-11-10T11:00:00Z') }),
      ticket('transfer-late', { deliveryType: 'transfer', location: 'Kent', transferDestination: 'Seattle', date: '2026-11-02', expectedArrivalDate: '2026-11-12',
        truckId: 'drv_k', createdAt: new Date('2026-11-10T12:00:00Z'),
        arrivalLogged: { byName: 'Dee', byLocation: 'Seattle', at: new Date('2026-11-12T08:00:00Z') }, receivedAt: new Date('2026-11-12T09:00:00Z'), receivedBy: 'Dee' }),
      ticket('old', { date: '2026-09-01', createdAt: new Date('2026-09-01T10:00:00Z') })
    ]);
  }, 'DB_DELIVERIES');

  app = express();
  app.use(express.json());
  app.set('io', { emit: () => {}, to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: { keys: () => [][Symbol.iterator]() } } } });
  app.use('/api', createDeliveriesRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (...ps: string[]) => (req: Loose, res: Loose, next: () => void) => (ps.every(p => has(req, p)) ? next() : res.status(403).json({})),
    requireAnyPermission: (...ps: string[]) => (req: Loose, res: Loose, next: () => void) => (ps.some(p => has(req, p)) ? next() : res.status(403).json({})),
    getPerformerInfo: async () => ({}),
    processBase64Images: async (x: unknown[]) => x,
    getNowLocalISO: () => new Date().toISOString()
  }));
}, 240000);

afterAll(async () => { await t?.close(); });

/** The same GET on each database; the answers must match. */
async function same(user: Loose, url: string) {
  const ask = async () => { const r = await request(app).get(url).set(as(user)); return { status: r.status, body: r.body }; };
  const mongo = await t.on('mongo', ask);
  const postgres = await t.on('postgres', ask);
  expect(postgres.status).toBe(mongo.status);
  expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  return mongo;
}

const ids = (body: Loose) => (Array.isArray(body) ? body : body.results).map((d: Loose) => d.id).sort();

describe('GET /api/deliveries — the board', () => {
  const week = '/api/deliveries?startDate=2026-11-09&endDate=2026-11-15';

  it('an admin sees every branch, and a transfer by either of its days', async () => {
    const r = await same(ADMIN, week);
    expect(ids(r.body)).toEqual(expect.arrayContaining(['a', 'b', 'transfer', 'transfer-late', 'dropoff', 'willcall', 'spokane', 'kent']));
    expect(ids(r.body)).not.toContain('old');
    expect(ids(r.body)).not.toContain('pending');
    expect(ids(r.body)).not.toContain('cancelled');
  });

  it("a branch sees its own, the unowned, and transfers coming to it", async () => {
    const seattle = await same(SEATTLE, week);
    expect(ids(seattle.body)).toContain('nobranch');
    expect(ids(seattle.body)).toContain('transfer-late');
    expect(ids(seattle.body)).not.toContain('spokane');
    const spokane = await same(SPOKANE, week);
    expect(ids(spokane.body)).toContain('transfer');
    expect(ids(spokane.body)).not.toContain('a');
  });

  it('several branches, a narrowed one, one that is refused, and no branch at all', async () => {
    await same(TWO, week);
    await same(ADMIN, `${week}&location=Kent`);
    await same(TWO, `${week}&location=Kent`);
    expect((await same(SPOKANE, `${week}&location=Seattle`)).status).toBe(403);
    await same(NOBODY, week);
  });

  it('the board list leaves signatures and photos out, the single ticket keeps them', async () => {
    const list = await same(ADMIN, week);
    const b = list.body.find((d: Loose) => d.id === 'b');
    expect(b.pod.customerSignature).toBeUndefined();
    expect(b.pod.photos).toBeUndefined();
    expect(b.pod.verified).toBe(true);
    const one = await same(ADMIN, '/api/deliveries/b');
    expect(one.body.pod.customerSignature).toContain('AAA');
    expect(one.body.pod.photos).toEqual(['https://x.test/1.jpg']);
  });

  it('Pending, Cancelled, and every other filter', async () => {
    const pending = await same(SEATTLE, '/api/deliveries?pending=true');
    expect(ids(pending.body)).toEqual(['pending', 'pending-return']);
    await same(ADMIN, '/api/deliveries?pending=true');
    const cancelled = await same(SEATTLE, '/api/deliveries?cancelled=true');
    expect(ids(cancelled.body)).toEqual(['cancelled']);
    await same(ADMIN, '/api/deliveries');
  });
});

describe('GET /api/deliveries/search and /:id', () => {
  it('finds by company, order number and invoice, only in the login’s branches', async () => {
    await same(ADMIN, '/api/deliveries/search?q=granite');
    await same(SEATTLE, '/api/deliveries/search?q=customer');
    await same(SPOKANE, '/api/deliveries/search?q=SO-transfer');
    await same(TWO, '/api/deliveries/search?q=kent');
    await same(NOBODY, '/api/deliveries/search?q=customer');
  });

  it('treats the characters of a search as text, not as a pattern', async () => {
    const r = await same(ADMIN, '/api/deliveries/search?q=' + encodeURIComponent('100%'));
    expect(ids(r.body)).toEqual(['kent']);
    await same(ADMIN, '/api/deliveries/search?q=' + encodeURIComponent('(a|b'));
  });

  it('one ticket, a missing one, and one in another branch', async () => {
    expect((await same(SEATTLE, '/api/deliveries/a')).status).toBe(200);
    expect((await same(SEATTLE, '/api/deliveries/nope')).status).toBe(404);
    expect((await same(SEATTLE, '/api/deliveries/spokane')).status).toBe(404);
    expect((await same(SPOKANE, '/api/deliveries/transfer')).status).toBe(200);
    expect((await same(ADMIN, '/api/deliveries/transfer-late')).body.arrivalLogged.byName).toBe('Dee');
  });
});

it('the seed is what the copy made of it', async () => {
  expect(await Delivery.countDocuments()).toBe(13);
  expect(await t.differences()).toEqual([]);
});
