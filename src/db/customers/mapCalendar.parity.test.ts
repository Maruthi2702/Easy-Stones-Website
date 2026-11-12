/** Maps, duplicate candidates and calendar reads through the real copy and HTTP gates. */
import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import express, { type Express } from 'express';
import createCustomerMapRouter from '../../routes/customerMap.ts';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import { copyFromMongo } from '../copy/plan.ts';
import { readMongo } from '../copy/readMongo.ts';
import { useAppDbForTests } from '../appDb.ts';
import * as data from './index.ts';
import { normalize } from './parity.ts';
import Customer from '../../models/Customer.ts';
import Schedule from '../../models/Schedule.ts';
import { signStaffSession } from '../../services/staffSession.ts';
import { calendarFeedToken } from '../../services/calendarFeed.ts';
import { buildSignalIndex, matchAgainst, STRONG } from '../../utils/customerMatch.ts';
import type { Loose } from '../../types/records.ts';

const oid = () => new mongoose.Types.ObjectId();
const owner = oid(), teammate = oid(), outside = oid(), denied = oid();
const acme = oid(), duplicate = oid(), open = oid(), hidden = oid(), noPoint = oid(), missing = oid();
const entries = Array.from({ length: 5 }, oid);
const secret = 'map-calendar-read-parity-secret', feedKey = 'private-feed-key';
const old = { DB_CUSTOMERS: process.env.DB_CUSTOMERS, RUNTIME: process.env.RUNTIME, JWT_SECRET: process.env.JWT_SECRET };
let mongo: MongoMemoryReplSet, pg: OpenDb, app: Express;
const range = 'start=2026-11-12T00:00:00.000&end=2026-11-12T23:59:59.999';
const localClock = '2026-11-11T09:00:00.000';

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  const db = mongoose.connection.db!;
  await db.collection('locations').insertMany(['Seattle', 'Dallas'].map(name => ({ _id: oid(), name })));
  await db.collection('roles').insertMany([
    { _id: oid(), name: 'sales_rep', permissions: ['view_customers', 'view_route_planner', 'view_team_calendar'] },
    { _id: oid(), name: 'map_denied', permissions: [] }
  ]);
  await db.collection('users').insertMany([
    { _id: owner, username: 'owner', displayName: 'Owner', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'], isActive: true, password: 'x', calendarFeedKey: feedKey },
    { _id: teammate, username: 'teammate', displayName: 'Teammate', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'], isActive: false, password: 'x' },
    { _id: outside, username: 'outside', displayName: 'Outside', role: 'sales_rep', location: 'Dallas', assignedLocations: ['Dallas'], isActive: true, password: 'x' },
    { _id: denied, username: 'denied', role: 'map_denied', location: 'Seattle', assignedLocations: ['Seattle'], isActive: true, password: 'x' }
  ]);
  await Customer.insertMany([
    { _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.example', phone: '206-555-0123', location: 'Seattle',
      salesRep: owner, salesRepName: 'Owner', address: { street: '1 Main', city: 'Kent', state: 'WA', zipCode: '98032' },
      coordinates: { lat: 47.38, lng: -122.23 }, geocode: { precision: 'rooftop' }, modaDisplay: 'Yes', modaBinder: '2',
      notDuplicateOf: [duplicate], quickNote: 'Gate 12',
      visits: [{ _id: oid(), date: '2026-11-09', createdAt: localClock }, { _id: oid(), date: '2026-11-11', createdAt: localClock }] },
    { _id: duplicate, company: 'Acme Stone Inc', contactName: 'Ben', email: 'ben@acme.example', phone: '206-555-0123', location: 'Seattle',
      salesRep: teammate, salesRepName: 'Teammate', coordinates: { lat: 47.4, lng: -122.2 }, notDuplicateOf: [acme] },
    { _id: open, company: 'Open Seattle', contactName: 'Cam', email: 'cam@open.example', location: 'Seattle', coordinates: { lat: 47.3, lng: -122.1 } },
    { _id: hidden, company: 'Other Branch', contactName: 'Dee', email: 'dee@hidden.example', location: 'Dallas', salesRep: outside,
      salesRepName: 'Outside', coordinates: { lat: 32.7, lng: -96.8 } },
    { _id: noPoint, company: 'No Point', contactName: 'Eli', email: 'eli@no-point.example', location: 'Seattle' }
  ]);
  await Schedule.insertMany([
    { _id: entries[0], userId: owner, customerId: acme, startTime: '2026-11-12T09:00:00.000', endTime: '2026-11-12T09:30:00.000', notes: 'Private notes' },
    { _id: entries[1], userId: teammate, customerId: open, startTime: '2026-11-12T10:00:00.000', source: 'route_planner' },
    { _id: entries[2], userId: outside, customerId: hidden, startTime: '2026-11-12T11:00:00.000' },
    { _id: entries[3], userId: owner, customerId: missing, startTime: '2026-11-12T12:00:00.000', notes: 'Deleted customer' },
    { _id: entries[4], userId: owner, customerId: acme, startTime: '2026-11-13T09:00:00.000', status: 'Cancelled' }
  ]);
  pg = await openDb('pglite:memory'); await migrateDb(pg.db, 'pglite:memory');
  await copyFromMongo(pg.db, await readMongo(mongo.getUri(), 'map-calendar-parity'), { write: true });
  useAppDbForTests(pg.db);
  process.env.RUNTIME = 'lambda'; process.env.JWT_SECRET = secret;
  ({ app } = await import('../../../server.ts'));
}, 120_000);

afterEach(() => { delete process.env.DB_CUSTOMERS; });
afterAll(async () => {
  useAppDbForTests(null); await pg?.close(); await mongoose.disconnect(); await mongo?.stop();
  for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
async function both<T>(read: () => Promise<T>, prepare: (value: T) => unknown = value => value): Promise<T> {
  process.env.DB_CUSTOMERS = 'mongo'; const m = await read();
  process.env.DB_CUSTOMERS = 'postgres'; const p = await read();
  expect(normalize(prepare(p))).toEqual(normalize(prepare(m)));
  return p;
}
const byId = (values: Loose[]) => [...values].sort((a, b) => String(a._id).localeCompare(String(b._id)));
const get = (path: string, user = owner) => request(app).get(path).set('Cookie', `customerToken=${signStaffSession({ _id: user }, secret)}`);

it('matches slim pins, newest visit and counts, omitting customers without coordinates', async () => {
  const pins = await both(data.mapCustomerPins);
  expect(pins.map(p => p.company)).toEqual(['Acme Stone', 'Acme Stone Inc', 'Open Seattle', 'Other Branch']);
  expect(pins[0]).toMatchObject({ lastVisitAt: '2026-11-11', visitCount: 2 });
  expect(pins[0]).not.toHaveProperty('email');
});
it('matches map details, case-insensitive ids and missing customers', async () => {
  for (const id of [String(acme), String(acme).toUpperCase(), String(missing)]) await both(() => data.mapCustomerRecord(id));
});
it('matches duplicate signal membership, separation links, matcher scores and selected customer fields', async () => {
  const rows = await both(data.duplicateSignals, byId);
  const hits = matchAgainst(buildSignalIndex(rows), { company: 'Acme Stone', phone: '206-555-0123', email: '' }).filter(h => h.score >= STRONG);
  expect(hits.map(h => h.id)).toContain(String(duplicate));
  await both(() => data.duplicateCustomers(hits.map(h => h.id)), byId);
  expect(await both(() => data.duplicateCustomers([]))).toEqual([]);
});
it('matches own, team, all and empty calendar scopes, inclusive bounds and deleted customers', async () => {
  for (const people of [new Set([String(owner)]), new Set([String(owner), String(teammate)]), '*', new Set<string>()] as const) {
    await both(() => data.calendarEntries({ people, start: '2026-11-12T00:00:00.000', end: '2026-11-12T23:59:59.999' }));
  }
  const own = await both(() => data.calendarEntries({ people: new Set([String(owner)]) }));
  expect(own.find(e => String(e._id) === String(entries[0]))!.customerId.coordinates).toEqual({ lat: 47.38, lng: -122.23 });
  expect(own.find(e => String(e._id) === String(entries[3]))!.customerId).toBeNull();
  expect((await both(() => data.calendarEntries({ people: '*', start: '2026-11-12T09:00:00.000', end: '2026-11-12T09:00:00.000' })))).toHaveLength(1);
  expect((await both(() => data.calendarEntries({ people: '*', start: 'not-a-time', end: 'zzz' })))).toEqual([]);
});
it('matches the feed projection, omitting cancelled entries and populated customer virtuals', async () => {
  const feed = await both(() => data.calendarEntries({ people: new Set([String(owner)]), feed: true }), byId);
  expect(feed).toHaveLength(2); expect(feed[0].customerId).not.toHaveProperty('id');
  expect(feed[0].customerId).not.toHaveProperty('coordinates');
});
it('keeps HTTP map permissions and branch scope, rep filtering and details boundaries on both databases', async () => {
  for (const database of ['mongo', 'postgres']) {
    process.env.DB_CUSTOMERS = database;
    let cached: Loose[] | null = null;
    const mapApp = express();
    mapApp.use('/api/customers', createCustomerMapRouter({
      authenticate: (req, res, next) => {
        if (!req.headers['x-test-user']) return res.sendStatus(401);
        req.user = JSON.parse(String(req.headers['x-test-user'])); next();
      },
      requirePermission: key => (req, res, next) => req.user.permissions.includes(key) ? next() : res.sendStatus(403),
      cache: { get: () => cached, put: (value: Loose[]) => { cached = value; return value; } }
    }));
    const mapGet = (path: string, allowed = true) => request(mapApp).get(`/api/customers${path}`).set('x-test-user', JSON.stringify({
      id: String(owner), role: 'sales_rep', assignedLocations: ['Seattle'], location: 'Seattle', permissions: allowed ? ['view_route_planner'] : []
    }));
    expect((await mapGet('/map', false)).status).toBe(403);
    const pins = await mapGet(`/map?reps=${owner},unassigned`).expect(200);
    expect(pins.body.map((p: Loose) => p.company)).toEqual(['Acme Stone', 'Open Seattle']);
    const counts = await mapGet('/map/rep-counts').expect(200);
    expect(counts.body).toEqual({ [String(owner)]: 1, [String(teammate)]: 1, unassigned: 1 });
    await mapGet(`/map/${acme}`).expect(200);
    await mapGet(`/map/${hidden}`).expect(404);
    await mapGet('/map/no-id').expect(400);
    expect(cached).toHaveLength(4);
  }
});
it('keeps HTTP calendar own/team scope and authentication on both databases', async () => {
  for (const database of ['mongo', 'postgres']) {
    process.env.DB_CUSTOMERS = database;
    await request(app).get('/api/schedule').expect(401);
    const own = await get(`/api/schedule?${range}`).expect(200);
    expect(own.body.map((e: Loose) => e.userId)).toEqual([String(owner), String(owner)]);
    const team = await get(`/api/schedule?scope=team&${range}`).expect(200);
    expect(team.body.map((e: Loose) => e.ownerName)).toEqual(['Owner', 'Teammate', 'Owner']);
    const narrowed = await get(`/api/schedule?scope=team&reps=${outside}&${range}`).expect(200);
    expect(narrowed.body).toEqual([]);
    const limited = await get(`/api/schedule?scope=team&${range}`, denied).expect(200);
    expect(limited.body).toEqual([]);
  }
});
it('keeps the ICS credential gate and exact calendar contents on both databases', async () => {
  const token = calendarFeedToken(String(owner), feedKey, secret);
  const path = `/api/calendar/feed/${owner}.ics?token=${token}`;
  await both(async () => {
    const res = await request(app).get(path).expect(200);
    expect(res.text).toContain('Unknown Customer'); expect(res.text).toContain('Private notes');
    expect(res.text).not.toContain('20261113');
    return res.text;
  });
  for (const database of ['mongo', 'postgres']) {
    process.env.DB_CUSTOMERS = database;
    await request(app).get(`/api/calendar/feed/${owner}.ics?token=invalid`).expect(404);
  }
});
it('keeps duplicate HTTP permissions and exclusion of records marked separate', async () => {
  for (const database of ['mongo', 'postgres']) {
    process.env.DB_CUSTOMERS = database;
    const post = (user: mongoose.Types.ObjectId) => request(app).post('/api/customers/possible-duplicates')
      .set('Cookie', `customerToken=${signStaffSession({ _id: user }, secret)}`)
      .send({ company: 'Acme Stone', phone: '206-555-0123', excludeId: String(acme) });
    expect((await post(denied)).status).toBe(403);
    expect((await post(owner)).body).toEqual({ matches: [] });
  }
});
