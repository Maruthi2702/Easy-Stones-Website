/** Profiles and their drill-downs through the real copy and authenticated HTTP routes. */
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
import type { CustomerHistoryScope } from './types.ts';
import Customer from '../../models/Customer.ts';
import type { Loose } from '../../types/records.ts';
import { signStaffSession } from '../../services/staffSession.ts';
import { BASIC_CUSTOMER_FIELDS } from '../../utils/customerAccess.ts';

const oid = () => new mongoose.Types.ObjectId();
const me = oid(), inactive = oid(), outside = oid(), global = oid(), manager = oid(), all = oid(), basic = oid(), denied = oid();
const cid = oid(), partner = oid(), empty = oid(), deletedCustomer = oid();
const visitIds = Array.from({ length: 6 }, oid), resourceIds = Array.from({ length: 5 }, oid);
const clock = '2026-11-09T14:05:06.090';
const secret = 'local-profile-parity-secret';
const prior = { RUNTIME: process.env.RUNTIME, JWT_SECRET: process.env.JWT_SECRET, DB_CUSTOMERS: process.env.DB_CUSTOMERS };
let mongo: MongoMemoryReplSet, pg: OpenDb, app: import('express').Express;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  const db = mongoose.connection.db!;
  await db.collection('locations').insertMany(['Seattle', 'Dallas'].map(name => ({ _id: oid(), name })));
  const permissions = ['view_customers', 'view_customer_profile'];
  await db.collection('roles').insertMany([
    { _id: oid(), name: 'profile_own', permissions },
    { _id: oid(), name: 'profile_branch', permissions: [...permissions, 'view_branch_visits'] },
    { _id: oid(), name: 'profile_all', permissions: [...permissions, 'view_all_visits'] },
    { _id: oid(), name: 'profile_basic', permissions: ['view_customers'] },
    { _id: oid(), name: 'profile_denied', permissions: ['view_customer_profile'] }
  ]);
  await db.collection('users').insertMany(([
    [me, 'Owner', 'Seattle', 'profile_own', ['Seattle']],
    [inactive, 'Former colleague', 'Dallas', 'profile_own', ['Seattle']],
    [outside, 'Other branch', 'Dallas', 'profile_own', ['Dallas']],
    [global, 'Global admin', 'Seattle', 'profile_own', ['*']],
    [manager, 'Manager', 'Seattle', 'profile_branch', ['Seattle']],
    [all, 'All', 'Seattle', 'profile_all', ['Seattle']],
    [basic, 'Basic', 'Seattle', 'profile_basic', ['Seattle']],
    [denied, 'Denied', 'Seattle', 'profile_denied', ['Seattle']]
  ] as const).map(([_id, username, location, role, assignedLocations]) => ({ _id, username, displayName: username, location, role, assignedLocations,
    password: 'x', isActive: _id !== inactive })));
  const owners = [me, inactive, outside, global, undefined, cid];
  const visits = owners.map((owner, i) => ({
    _id: visitIds[i], date: `2026-11-${String(10 + i).padStart(2, '0')}`, purpose: 'Legacy Call', createdBy: owner ? String(owner) : undefined, createdByName: `Author ${i}`,
    createdAt: clock, notes: `Visit ${i}`, image: ['https://example.test/b.jpg', 'https://example.test/a.jpg'],
    followUp: 'Call back', followUpDate: '2026-11-20', followUpDoneAt: clock, followUpDoneOn: '2026-11-09',
    followUpDoneBy: String(me), followUpDoneByName: 'Owner', followUpOutcome: 'Reached',
    followUpHistory: [{ action: 'snooze', at: clock, by: String(me), byName: 'Owner', from: '2026-11-10', to: '2026-11-20', on: '2026-11-09' },
      { action: 'done', at: clock, by: String(me), on: '2026-11-09' }],
    managerComment: 'Manager note', headquartersComment: 'HQ note', customerContactName: 'Reception',
    reactions: [{ _id: oid(), type: 'like', userId: String(me), userName: 'Owner', createdAt: clock },
      { _id: oid(), type: 'love', userId: String(cid), userName: 'Customer', createdAt: clock }],
    updatedBy: String(cid), updatedByName: 'Customer', updatedAt: clock,
    ...(i < 5 ? { resourceId: resourceIds[i] } : {})
  }));
  await Customer.insertMany([
    { _id: cid, company: 'Profile customer', contactName: 'Reception', email: 'profile@example.test', location: 'Dallas',
      salesRep: me, salesRepName: 'Owner', password: 'private hash', loginAttempts: 2, lockUntil: new Date('2026-11-11T10:00:00Z'), loginIps: ['127.0.0.1'],
      visits, contacts: [{ _id: oid(), name: 'Zoe', role: 'Purchasing', notes: 'Desk', createdAt: clock }, { _id: oid(), name: 'Ann', email: 'ann@example.test' }],
      resources: owners.slice(0, 5).map((owner, i) => ({ _id: resourceIds[i], visitId: visitIds[i], title: 'Tied resource title',
        customer: 'Profile customer', date: '2026-11-09', uploadedBy: owner ? String(owner) : undefined, createdAt: clock,
        qty: i + 1, notes: `Resource ${i}`, status: i === 1 ? 'Inactive' : 'Active', image: ['https://example.test/2.jpg', 'https://example.test/1.jpg'] })),
      associatedCustomers: [partner, deletedCustomer, empty], notDuplicateOf: [empty], quickNote: 'Private', priceLevel: 3 },
    { _id: partner, contactName: 'Partner', company: 'Partner company', email: 'partner@example.test', location: 'Seattle',
      visits: owners.slice(0, 4).map((owner, i) => ({ _id: oid(), date: `2026-10-${21 + i}`, createdBy: String(owner), createdAt: clock })) },
    { _id: empty, contactName: 'Empty', email: 'empty@example.test', location: 'Seattle' }
  ]);
  pg = await openDb('pglite:memory');
  await migrateDb(pg.db, 'pglite:memory');
  await copyFromMongo(pg.db, await readMongo(mongo.getUri(), 'profile-parity'), { write: true });
  useAppDbForTests(pg.db);
  process.env.RUNTIME = 'lambda'; process.env.JWT_SECRET = secret;
  ({ app } = await import('../../../server.ts'));
}, 120_000);

afterEach(() => { delete process.env.DB_CUSTOMERS; });
afterAll(async () => {
  useAppDbForTests(null); await pg?.close(); await mongoose.disconnect(); await mongo?.stop();
  for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const get = (path: string, user = me) => request(app).get(path).set('Cookie', `customerToken=${signStaffSession({ _id: user }, secret)}`);
async function both(read: () => Promise<unknown>) {
  process.env.DB_CUSTOMERS = 'mongo'; const m = await read();
  process.env.DB_CUSTOMERS = 'postgres'; const p = await read();
  expect(normalize(p)).toEqual(normalize(m));
  return p as Loose;
}

it.each(['*', new Set([String(me)]), new Set([String(me), String(inactive)]), new Set<string>()] as CustomerHistoryScope['people'][])(
  'matches every nested field, saved array order and scoped partner last-visit: %s', async people => {
    const result = await both(() => data.customerProfile(String(cid), { mayProfile: true, people }));
    expect(result.password).toBeUndefined();
    expect(result.contacts.map((c: Loose) => c.name)).toEqual(['Zoe', 'Ann']);
    expect(result.associatedCustomers.map((c: Loose) => c._id)).toEqual([String(partner), String(empty)]);
    expect(result.associatedCustomers[0].visits).toBeUndefined();
    if (people instanceof Set && !people.size) {
      expect(result.visits).toEqual([]); expect(result.resources).toEqual([]); expect(result.lastVisitDate).toBeNull();
    }
  });

it('matches empty, missing and uppercase profiles and basic-field allowlists', async () => {
  for (const id of [String(empty), String(cid).toUpperCase(), String(oid())]) {
    await both(() => data.customerProfile(id, { mayProfile: true, people: '*' }));
  }
  const basic = await both(() => data.customerProfile(String(cid), { mayProfile: false, people: '*' }));
  expect(Object.keys(basic).every(k => (BASIC_CUSTOMER_FIELDS as readonly string[]).includes(k))).toBe(true);
});

it('matches both detail types, excludes the wrong parent and never widens an empty scope', async () => {
  for (const [kind, ids] of [['visits', visitIds], ['resources', resourceIds]] as const) {
    for (const entryId of ids) {
      await both(() => data.customerHistoryEntry(String(cid).toUpperCase(), kind, String(entryId).toUpperCase(), '*'));
      await both(() => data.customerHistoryEntry(String(cid), kind, String(entryId), new Set([String(me)])));
      expect(await both(() => data.customerHistoryEntry(String(cid), kind, String(entryId), new Set()))).toBeNull();
      expect(await both(() => data.customerHistoryEntry(String(partner), kind, String(entryId), '*'))).toBeNull();
    }
  }
});

it('shapes the current mutation record even with Postgres selected, leaving the document intact', async () => {
  const record = await Customer.findById(cid);
  record!.quickNote = 'Changed after the copy';
  record!.visits.push({ date: '2026-12-01', createdBy: String(me), createdAt: clock });
  process.env.DB_CUSTOMERS = 'postgres';
  const response = await data.customerRecordResponse(record!, { mayProfile: true, people: new Set([String(me)]) });
  expect(response.quickNote).toBe('Changed after the copy'); expect(response.lastVisitDate).toBe('2026-12-01');
  expect(response.visits).toHaveLength(2); expect(response.password).toBeUndefined();
  expect(record!.visits).toHaveLength(7); expect(record!.password).toBe('private hash');
});

describe.each(['mongo', 'postgres'])('%s profile HTTP permissions and scope', database => {
  it('requires sign-in and View, and keeps the basic card private', async () => {
    process.env.DB_CUSTOMERS = database;
    const path = `/api/customers/${cid}`;
    await request(app).get(path).expect(401); await get(path, denied).expect(403);
    const body = (await get(path, basic).expect(200)).body;
    expect(Object.keys(body).every(k => (BASIC_CUSTOMER_FIELDS as readonly string[]).includes(k))).toBe(true);
    for (const [kind, ids] of [['visits', visitIds], ['resources', resourceIds]] as const) {
      await request(app).get(`${path}/${kind}/${ids[0]}`).expect(401);
      await get(`${path}/${kind}/${ids[0]}`, basic).expect(403);
      await get(`${path}/${kind}/${ids[0]}`, denied).expect(403);
    }
  });

  it('scopes by the rep team across customer branches, includes inactive staff and excludes global admins', async () => {
    process.env.DB_CUSTOMERS = database;
    for (const [user, visible, lastDate] of [[me, [0], '2026-11-10'], [manager, [0, 1], '2026-11-11'], [all, [0, 1, 2, 3, 4, 5], '2026-11-15']] as const) {
      const path = `/api/customers/${cid}`;
      const { body } = await get(path, user).expect(200);
      expect(body.visits.map((v: Loose) => v._id)).toEqual(visible.map(i => String(visitIds[i])));
      expect(body.resources.map((r: Loose) => r._id)).toEqual(visible.filter(i => i < 5).map(i => String(resourceIds[i])));
      expect(body.lastVisitDate).toBe(lastDate);
      expect(body.password).toBeUndefined();
      for (const [kind, ids] of [['visits', visitIds], ['resources', resourceIds]] as const) {
        for (const [i, id] of ids.entries()) {
          const res = await get(`${path}/${kind}/${id}`, user).expect((visible as readonly number[]).includes(i) ? 200 : 404);
          if (res.status === 200) expect(res.body[kind === 'visits' ? 'visit' : 'resource']._id).toBe(String(id));
        }
        await get(`/api/customers/${empty}/${kind}/${ids[0]}`, user).expect(404);
        await get(`${path}/${kind}/${oid()}`, user).expect(404);
        await get(`${path}/${kind}/malformed`, user).expect(500);
      }
    }
    await get(`/api/customers/${oid()}`).expect(404);
  });
});
