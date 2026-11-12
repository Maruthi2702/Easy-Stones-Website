/** Dashboard routes on both databases, copied through the actual migration with scopes fixed at the HTTP boundary. */
import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import { copyFromMongo } from '../copy/plan.ts';
import { readMongo } from '../copy/readMongo.ts';
import { useAppDbForTests } from '../appDb.ts';
import * as data from './index.ts';
import { normalize } from './parity.ts';
import { dashboardCompareReads } from '../../../scripts/pg-compare-dashboard.ts';
import type { DashboardReadQuery } from './types.ts';
import type { Loose } from '../../types/records.ts';
import Customer from '../../models/Customer.ts';
import { signStaffSession } from '../../services/staffSession.ts';
import { followUpsInView, followUpCounts, withStatus } from '../../utils/followUpList.ts';

const oid = () => new mongoose.Types.ObjectId();
const own = oid(), teammate = oid(), outside = oid(), manager = oid(), all = oid(), denied = oid();
const cid = [oid(), oid(), oid(), oid()];
const entryIds = Array.from({ length: 9 }, oid);
const today = '2026-11-11';
const q: DashboardReadQuery = { people: '*', startDate: null, endDate: null };
const stamp = '2026-11-05T12:34:56.120';
const secret = 'dashboard-read-parity-secret';
const prior = { RUNTIME: process.env.RUNTIME, JWT_SECRET: process.env.JWT_SECRET, DB_CUSTOMERS: process.env.DB_CUSTOMERS };
let mongo: MongoMemoryReplSet, pg: OpenDb, app: import('express').Express;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  const db = mongoose.connection.db!;
  await db.collection('locations').insertMany(['Seattle', 'Dallas'].map(name => ({ _id: oid(), name })));
  await db.collection('roles').insertMany([
    { _id: oid(), name: 'dash_own', permissions: ['view_dashboard'] },
    { _id: oid(), name: 'dash_branch', permissions: ['view_dashboard', 'view_branch_visits'] },
    { _id: oid(), name: 'dash_all', permissions: ['view_dashboard', 'view_all_visits'] },
    { _id: oid(), name: 'dash_denied', permissions: [] }
  ]);
  await db.collection('users').insertMany([
    [own, 'Own', 'Seattle', 'dash_own', true], [teammate, 'Teammate', 'Seattle', 'dash_own', false],
    [outside, 'Outside', 'Dallas', 'dash_own', true], [manager, 'Manager', 'Seattle', 'dash_branch', true],
    [all, 'All', 'Seattle', 'dash_all', true], [denied, 'Denied', 'Seattle', 'dash_denied', true]
  ].map(([_id, username, location, role, isActive]) => ({ _id, username, location, role, isActive,
    assignedLocations: [location], password: 'x', sessionVersion: 0 })));
  await db.collection('resourcefamilies').insertOne({ _id: oid(), name: 'Samples' });
  await db.collection('resourcetypes').insertOne({ _id: oid(), name: 'Samples', family: 'Samples', active: true });
  const visit = (index: number, createdBy: unknown, date: string, fields: Loose = {}) => ({
    _id: entryIds[index], date, createdBy, createdByName: `Author ${index}`, purpose: 'Call', createdAt: stamp,
    notes: '', followUp: '', followUpDate: '', ...fields
  });
  const rows = [
    { location: 'Dallas', createdBy: own, visits: [
      visit(0, String(own), '2026-11-05', { outcome: 'Sale and quote', followUp: 'Call', followUpDate: today,
        followUpHistory: [{ action: 'snooze', at: stamp, on: '2026-11-05', by: String(own), byName: 'Own', from: '2026-11-05', to: today }] }),
      visit(1, own, '2026-11-06', { notes: 'Bidding follow-up', followUp: 'Done', followUpDate: '2026-11-10',
        followUpDoneAt: '2026-11-10T09:00:00.000', followUpDoneOn: '2026-11-10', followUpDoneByName: 'Own', followUpOutcome: 'Ordered' }),
      visit(2, String(own), '2026-10-01', { followUp: 'No due date' })
    ], resources: [{ _id: oid(), date: '2026-11-07', resourceType: 'Samples', title: 'Samples', uploadedBy: String(own),
      createdAt: stamp, qty: 3, notes: 'Three boxes', status: 'Active', description: 'Desk samples' }] },
    { location: 'Dallas', createdBy: manager, visits: [visit(3, String(teammate), '2026-11-08', { followUpDate: '2026-11-20', followUp: 'Next week' })],
      resources: [{ _id: oid(), date: '2026-11-08', resourceType: 'Samples', title: 'Samples', uploadedBy: String(teammate),
        createdAt: stamp, qty: 1, notes: 'Removed', status: 'Removed' }] },
    { location: 'Seattle', createdBy: outside, visits: [visit(4, String(outside), '2026-11-09', { notes: 'Deposit paid', followUpDate: today, followUp: 'Call' })],
      resources: [{ _id: oid(), date: '2026-11-09', resourceType: 'Samples', title: 'Samples', uploadedBy: String(outside), createdAt: stamp, status: 'Active' }] },
    { location: 'Seattle', visits: [visit(5, String(cid[0]), '2026-11-10'), visit(6, undefined, '2026-11-11')] }
  ];
  await Customer.collection.insertMany(rows.map((row, index) => new Customer({
    _id: cid[index], contactName: `Contact ${index}`, company: `Company ${index}`,
    email: `dash${index}@customer.example`, phone: '2065550100', address: { city: 'Kent', street: '1 Main' }, ...row
  }).toObject()));
  // MongoDB's resource owner fallback predates the model's uploadedBy field.
  const saved = await Customer.collection.findOne({ _id: cid[1] });
  const legacyResource = saved!.resources![0];
  delete legacyResource.uploadedBy;
  (legacyResource as Loose).createdBy = teammate;
  await Customer.collection.updateOne({ _id: cid[1] }, { $set: { resources: [legacyResource] } });
  pg = await openDb('pglite:memory');
  await migrateDb(pg.db, 'pglite:memory');
  await copyFromMongo(pg.db, await readMongo(mongo.getUri(), 'dashboard-parity'), { write: true });
  useAppDbForTests(pg.db);
  process.env.RUNTIME = 'lambda'; process.env.JWT_SECRET = secret;
  ({ app } = await import('../../../server.ts'));
}, 120_000);

afterEach(() => { delete process.env.DB_CUSTOMERS; });
afterAll(async () => {
  useAppDbForTests(null); await pg?.close(); await mongoose.disconnect(); await mongo?.stop();
  for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
async function both(name: 'dashboardVisits' | 'dashboardResources', changes: Partial<DashboardReadQuery> = {}) {
  process.env.DB_CUSTOMERS = 'mongo'; const m = normalize(await data[name]({ ...q, ...changes }));
  process.env.DB_CUSTOMERS = 'postgres'; const p = normalize(await data[name]({ ...q, ...changes }));
  expect(p).toEqual(m); return p as Loose[];
}

describe('dashboard read parity', () => {
  it.each(['dashboardVisits', 'dashboardResources'] as const)('%s returns every projected field and descending date order', async name => {
    const rows = await both(name); expect(rows.length).toBe(name === 'dashboardVisits' ? 7 : 3);
  });
  it.each(['dashboardVisits', 'dashboardResources'] as const)('%s accepts own, multi-author and empty scopes without widening', async name => {
    for (const people of [new Set([String(own)]), new Set([String(own), String(teammate)]), new Set<string>(), new Set(['missing'])]) await both(name, { people });
  });
  it.each(['dashboardVisits', 'dashboardResources'] as const)('%s uses inclusive, one-sided and empty date ranges', async name => {
    for (const [start, end] of [['2026-11-05', '2026-11-08'], ['2026-11-08', '2026-11-08'], ['2026-11-08', null], [null, '2026-11-07'], ['2030-01-01', '2030-01-02']]) {
      await both(name, { startDate: start ? new Date(`${start}T00:00:00Z`) : null, endDate: end ? new Date(`${end}T23:59:59Z`) : null });
    }
  });
  it('follow-up loading retains snooze/done history, phone and city and the original Today special case', async () => {
    for (const [start, end] of [[null, null], [today, today], ['2026-11-05', '2026-11-10'], [null, today]]) {
      const rows = await both('dashboardVisits', { filterType: 'followup', startDate: start ? new Date(`${start}T00:00:00Z`) : null, endDate: end ? new Date(`${end}T23:59:59Z`) : null });
      for (const row of rows) expect(row.city).toBe('Kent');
    }
  });
  it('rollups count visits, sale/quote keywords, resources and pending due today in the same scope', async () => {
    for (const people of ['*', new Set([String(own)]), new Set([String(teammate), String(own)]), new Set<string>()] as const) {
      for (const startDate of [null, new Date('2026-11-05T00:00:00Z')]) {
        const query = { ...q, people, startDate, endDate: new Date('2026-11-09T23:59:59Z'), today, userId: String(own) };
        process.env.DB_CUSTOMERS = 'mongo'; const m = await data.dashboardRollups(query);
        process.env.DB_CUSTOMERS = 'postgres'; const p = await data.dashboardRollups(query);
        expect(p).toEqual(m);
      }
    }
  });
  it('documents only the separator conversion when source company is explicitly empty', async () => {
    try {
      await Customer.collection.updateOne({ _id: cid[0] }, { $set: { company: '' } });
      await copyFromMongo(pg.db, await readMongo(mongo.getUri(), 'dashboard-empty-name'), { write: true });
      process.env.DB_CUSTOMERS = 'mongo'; const m = normalize(await data.dashboardVisits(q)) as Loose[];
      process.env.DB_CUSTOMERS = 'postgres'; const p = normalize(await data.dashboardVisits(q)) as Loose[];
      expect(m.filter(row => row.customerId === String(cid[0])).every(row => row.customerName === ' - Contact 0')).toBe(true);
      expect(p).toEqual(m.map(row => row.customerId === String(cid[0]) ? { ...row, customerName: 'Contact 0' } : row));
      // Missing company is distinct in MongoDB but intentionally collapses to the same SQL default.
      await Customer.collection.updateOne({ _id: cid[0] }, { $unset: { company: '' } });
      await copyFromMongo(pg.db, await readMongo(mongo.getUri(), 'dashboard-missing-name'), { write: true });
      const missing = await both('dashboardVisits');
      expect(missing.filter(row => row.customerId === String(cid[0])).every(row => row.customerName === 'Contact 0')).toBe(true);
    } finally {
      await Customer.collection.updateOne({ _id: cid[0] }, { $set: { company: 'Company 0' } });
      await copyFromMongo(pg.db, await readMongo(mongo.getUri(), 'dashboard-restore-name'), { write: true });
    }
  });
  it('a resource without a day falls back to its saved local createdAt day for range and response', async () => {
    try {
      await Customer.collection.updateOne({ _id: cid[0] }, { $set: { 'resources.0.date': null } });
      await copyFromMongo(pg.db, await readMongo(mongo.getUri(), 'dashboard-resource-day'), { write: true });
      const rows = await both('dashboardResources', { people: new Set([String(own)]),
        startDate: new Date('2026-11-05T00:00:00Z'), endDate: new Date('2026-11-05T23:59:59Z') });
      expect(rows).toHaveLength(1); expect(rows[0].date).toBe('2026-11-05');
    } finally {
      await Customer.collection.updateOne({ _id: cid[0] }, { $set: { 'resources.0.date': '2026-11-07' } });
      await copyFromMongo(pg.db, await readMongo(mongo.getUri(), 'dashboard-restore-resource-day'), { write: true });
    }
  });
  it('the live comparator canonicalizes only source-proven equal sort-key ties', () => {
    const canonical = dashboardCompareReads(String(own), today)[0].prepare!;
    const a = { _id: 'a', date: today, createdAt: stamp }, b = { _id: 'b', date: today, createdAt: stamp };
    const c = { _id: 'c', date: '2026-11-01', createdAt: stamp };
    const source = [a, b, c];
    expect(canonical([b, a, c], source)).toEqual(source);
    expect(canonical([c, b, a], source)).not.toEqual(source);
    expect(canonical([b, a], source)).not.toEqual(source);
  });
  it('retains legacy createdBy resource ownership through the actual copy', async () => {
    const rows = await both('dashboardResources', { people: new Set([String(teammate)]) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uploadedBy: String(teammate), uploadedByName: 'Teammate' });
  });
  it('retains the legacy all-visit follow-up load while shared rules decide which rows are follow-ups', async () => {
    const rows = await both('dashboardVisits', { filterType: 'followup' });
    expect(rows).toHaveLength(7);
    const view = followUpsInView(rows, { range: 'all' }, today);
    const counts = followUpCounts(view, today);
    expect(counts.pending).toBe(withStatus(view, 'pending').length);
  });
});

describe('actual authenticated dashboard routes', () => {
  const get = (path: string, user = own) => request(app).get(path).set('Cookie', `customerToken=${signStaffSession({ _id: user }, secret)}`);
  const paths = ['visits', 'resources', 'followups', 'followups/panel', 'stats'];
  const params = '?timeRange=custom&from=2026-11-01&to=2026-11-30&localDate=2026-11-11';
  it('requires sign-in and the dashboard permission before touching Postgres', async () => {
    for (const database of ['mongo', 'postgres']) {
      process.env.DB_CUSTOMERS = database;
      for (const path of paths) {
        await request(app).get(`/api/dashboard/${path}`).expect(401);
        await get(`/api/dashboard/${path}`, denied).expect(403);
        await get(`/api/dashboard/${path}?reps=a&reps=b`).expect(400);
      }
    }
  });
  it.each([own, manager, all])('preserves the HTTP answer for each own/branch/all permission: %s', async user => {
    for (const path of paths) {
      process.env.DB_CUSTOMERS = 'mongo'; const m = await get(`/api/dashboard/${path}${params}`, user).expect(200);
      process.env.DB_CUSTOMERS = 'postgres'; const p = await get(`/api/dashboard/${path}${params}`, user).expect(200);
      expect(normalize(p.body)).toEqual(normalize(m.body));
    }
  });
  it('forged reps/location never widen scope, and teammates follow rep rather than customer branch', async () => {
    for (const database of ['mongo', 'postgres']) {
      process.env.DB_CUSTOMERS = database;
      const branch = await get(`/api/dashboard/visits${params}`, manager).expect(200);
      expect(branch.body.map((v: Loose) => v.createdBy)).toEqual([String(teammate), String(own), String(own)]);
      for (const path of paths) {
        const reply = await get(`/api/dashboard/${path}${params}&reps=${outside}&location=Dallas`, manager).expect(200);
        if (path === 'stats') expect(reply.body).toMatchObject({ visits: 0, resources: 0, followUp: 0 });
        else if (path === 'followups') expect(reply.body.rows).toEqual([]);
        else expect(reply.body).toEqual([]);
      }
    }
  });
  it('keeps the legacy all-time response for a non-day localDate', async () => {
    process.env.DB_CUSTOMERS = 'mongo'; const m = await get('/api/dashboard/stats?timeRange=all&localDate=not-a-day', all).expect(200);
    process.env.DB_CUSTOMERS = 'postgres'; const p = await get('/api/dashboard/stats?timeRange=all&localDate=not-a-day', all).expect(200);
    expect(normalize(p.body)).toEqual(normalize(m.body));
  });
  it('the Follow-ups tab counts match the statistics tile for each backend', async () => {
    for (const database of ['mongo', 'postgres']) {
      process.env.DB_CUSTOMERS = database;
      const stats = await get(`/api/dashboard/stats${params}`, all).expect(200);
      const follow = await get(`/api/dashboard/followups${params}`, all).expect(200);
      expect(stats.body.followUpCounts).toEqual(follow.body.counts);
      expect(stats.body.followUp).toBe(follow.body.rows.filter((row: Loose) => !row.followUpDoneAt).length);
    }
  });
});
