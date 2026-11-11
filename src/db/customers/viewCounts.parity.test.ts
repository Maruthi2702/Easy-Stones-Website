/** Saved-view badges: original MongoDB queries, SQL counts and the actual HTTP permission boundary. */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import { copyFromMongo } from '../copy/plan.ts';
import { readMongo } from '../copy/readMongo.ts';
import { useAppDbForTests } from '../appDb.ts';
import * as data from './index.ts';
import type { CustomerViewCountsQuery } from './types.ts';
import Customer from '../../models/Customer.ts';
import { SAVED_VIEWS } from '../../utils/customerList.ts';
import { signStaffSession } from '../../services/staffSession.ts';

const oid = () => new mongoose.Types.ObjectId();
const rep = oid(), basic = oid(), exporter = oid(), denied = oid();
const ids = Array.from({ length: 8 }, oid);
const base: CustomerViewCountsQuery = { userId: String(rep), today: '2026-11-09' };
const expected = {
  fabricators: { mine: 1, followups: 2, onboarding: 0, noModa: 3, unassigned: 2, incomplete: 3 },
  partners: { mine: 1, followups: 0, onboarding: 2, noModa: 2, unassigned: 2, incomplete: 2 }
};
let mongo: MongoMemoryReplSet;
let pg: OpenDb;
let app: import('express').Express;
const prior = { RUNTIME: process.env.RUNTIME, JWT_SECRET: process.env.JWT_SECRET, DB_CUSTOMERS: process.env.DB_CUSTOMERS };
const secret = 'local-customer-view-counts-session-secret';

const refreshCopy = async () => copyFromMongo(pg.db, await readMongo(mongo.getUri(), 'view-counts-parity'), { write: true });

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  const db = mongoose.connection.db!;
  await db.collection('locations').insertMany([{ _id: oid(), name: 'Seattle' }, { _id: oid(), name: 'Dallas' }]);
  await db.collection('roles').insertMany([
    { _id: oid(), name: 'count_full', permissions: ['view_customers', 'view_customer_profile'] },
    { _id: oid(), name: 'count_basic', permissions: ['view_customers'] },
    { _id: oid(), name: 'count_export', permissions: ['view_customers', 'export_customers'] },
    { _id: oid(), name: 'count_denied', permissions: ['view_customer_profile'] }
  ]);
  await db.collection('users').insertMany([
    { _id: rep, username: 'owner', role: 'count_full', location: 'Seattle', password: 'x' },
    { _id: basic, username: 'basic', role: 'count_basic', location: 'Dallas', password: 'x' },
    { _id: exporter, username: 'exporter', role: 'count_export', location: 'Seattle', password: 'x' },
    { _id: denied, username: 'denied', role: 'count_denied', location: 'Seattle', password: 'x' }
  ]);
  const rows = [
    { salesRep: rep, modaDisplay: 'Yes', visits: [{ date: '2026-11-01', followUpDate: '2026-11-09' }, { date: '2026-11-01', followUpDate: '2026-11-16' }] },
    { customerType: 'Builder', salesRep: rep, status: 'Trying to Onboard', phone: 'call me', location: 'Dallas' },
    { customerType: null, email: 'noemail@invalid.test', isActive: false },
    { salesRep: basic, email: 'person@easystones.com', visits: [{ date: '2026-11-01', followUpDate: '2026-11-17' }] },
    { email: 'person@easystones.com; real@customer.example' },
    { salesRep: basic, modaDisplay: 'Yes', geocode: { status: 'failed' },
      visits: [{ date: '2026-11-01', followUpDate: '2026-11-16', followUpDoneOn: '2026-11-09' }] },
    { customerType: 'Designer', email: 'placeholder@invalid.test; real@designer.example' },
    { status: 'Trying to Onboard', modaDisplay: 'Yes', address: { street: ' ', city: 'Dallas' },
      visits: [{ date: '2026-11-01', followUpDate: '2026-11-08' }] }
  ];
  await Customer.insertMany(rows.map((row, i) => ({
    _id: ids[i], company: `Company ${i}`, contactName: `Contact ${i}`, email: `person${i}@customer.example`,
    phone: '2065550123', address: { street: '1 Main Street', city: 'Kent' }, location: 'Seattle', ...row
  })));
  await Customer.collection.updateOne({ _id: ids[3] }, { $set: { customerType: '' } });
  await Customer.collection.updateOne({ _id: ids[4] }, { $unset: { customerType: '', salesRep: '' }, $set: { modaDisplay: null } });
  await Customer.collection.updateOne({ _id: ids[5] }, { $set: { customerType: 'FABRICATOR' } });
  await Customer.collection.updateOne({ _id: ids[7] }, { $set: { customerType: ' Fabricator ' } });
  pg = await openDb('pglite:memory');
  await migrateDb(pg.db, 'pglite:memory');
  await refreshCopy();
  useAppDbForTests(pg.db);
  process.env.RUNTIME = 'lambda';
  process.env.JWT_SECRET = secret;
  ({ app } = await import('../../../server.ts'));
}, 120_000);

afterEach(() => { delete process.env.DB_CUSTOMERS; });
afterAll(async () => {
  useAppDbForTests(null);
  await pg?.close();
  await mongoose.disconnect();
  await mongo?.stop();
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

async function both(query: Partial<CustomerViewCountsQuery> = {}) {
  process.env.DB_CUSTOMERS = 'mongo';
  const m = await data.customerViewCounts({ ...base, ...query });
  process.env.DB_CUSTOMERS = 'postgres';
  const p = await data.customerViewCounts({ ...base, ...query });
  expect(p).toEqual(m);
  expect(Object.keys(p)).toEqual(SAVED_VIEWS.map(v => v.key));
  expect(Object.values(p).every(n => Number.isSafeInteger(n) && n >= 0)).toBe(true);
  return p;
}

describe('saved-view count parity', () => {
  it.each([undefined, '', 'fabricators', 'unknown', 'Partners', "partners' OR true --"])(
    'uses the Fabricators tab unless tab is exactly partners: %s', async tab => {
      expect(await both({ tab })).toEqual(expected.fabricators);
    });

  it('counts all six views on Partners, including other branches', async () => {
    expect(await both({ tab: 'partners' })).toEqual(expected.partners);
  });

  it('counts each matching customer once, uses inclusive day boundaries, and includes done follow-ups', async () => {
    expect((await both()).followups).toBe(2);
    expect((await both({ today: '2026-11-10' })).followups).toBe(3);
    expect((await both({ tab: 'partners', today: '2026-11-01' })).followups).toBe(1);
  });

  it.each([undefined, '', 'invalid', '000000000000000000000000'])('an absent/invalid/unknown owner counts no mine accounts: %s', async userId => {
    expect(await both({ userId })).toEqual({ ...expected.fabricators, mine: 0 });
  });

  it('accepts a valid owner id in uppercase and selects the actual owner', async () => {
    expect(await both({ userId: String(rep).toUpperCase() })).toEqual(expected.fabricators);
    expect((await both({ userId: String(basic) })).mine).toBe(2);
  });

  it('the badges equal each saved view list total for both tabs and both backends', async () => {
    for (const database of ['mongo', 'postgres']) {
      process.env.DB_CUSTOMERS = database;
      for (const tab of ['fabricators', 'partners']) {
        const counts = await data.customerViewCounts({ ...base, tab });
        for (const { key } of SAVED_VIEWS) {
          const list = await data.customerList({
            ...base, page: 1, limit: 1, search: '', mayProfile: true, sortBy: 'company', sortOrder: 1,
            view: key, ...(tab === 'partners' ? { typeExclude: 'Fabricator' } : { type: 'Fabricator' })
          });
          expect(counts[key]).toBe(list.totalCount);
        }
      }
    }
  });

  it('an empty customer collection returns all six numeric zeroes', async () => {
    const saved = await Customer.collection.find({}).toArray();
    try {
      await Customer.collection.deleteMany({});
      await refreshCopy();
      expect(await both()).toEqual(Object.fromEntries(SAVED_VIEWS.map(v => [v.key, 0])));
      expect(await both({ tab: 'partners' })).toEqual(Object.fromEntries(SAVED_VIEWS.map(v => [v.key, 0])));
    } finally {
      await Customer.collection.insertMany(saved);
      await refreshCopy();
    }
  });

  it('pins the documented deleted-rep difference without masking the other counts', async () => {
    const customer = await Customer.create({ contactName: 'Deleted rep customer', email: 'deleted-rep@customer.example',
      location: 'Seattle', salesRep: oid(), phone: '2065550123', address: { street: '2 Main' } });
    try {
      const report = await refreshCopy();
      expect(report.problems).toContainEqual(expect.objectContaining({ id: String(customer._id), field: 'sales_rep_id', outcome: 'blanked' }));
      process.env.DB_CUSTOMERS = 'mongo';
      const m = await data.customerViewCounts(base);
      process.env.DB_CUSTOMERS = 'postgres';
      const p = await data.customerViewCounts(base);
      expect(p).toEqual({ ...m, unassigned: m.unassigned + 1 });
    } finally {
      await Customer.deleteOne({ _id: customer._id });
      await refreshCopy();
    }
  });

  it.each([undefined, '', 'seattle'])('pins the reported copy exclusion for a legacy invalid/missing branch: %s', async location => {
    const doc = new Customer({ contactName: 'Legacy branch', email: 'legacy-branch@customer.example',
      phone: '2065550123', address: { street: '2 Main' }, location }).toObject();
    if (location === undefined) delete (doc as { location?: string }).location;
    await Customer.collection.insertOne(doc);
    try {
      const report = await refreshCopy();
      expect(report.problems).toContainEqual(expect.objectContaining({ id: String(doc._id), field: 'location_id', outcome: 'skipped' }));
      process.env.DB_CUSTOMERS = 'mongo';
      const m = await data.customerViewCounts(base);
      process.env.DB_CUSTOMERS = 'postgres';
      const p = await data.customerViewCounts(base);
      expect(m).toEqual({ ...p, noModa: p.noModa + 1, unassigned: p.unassigned + 1 });
    } finally {
      await Customer.collection.deleteOne({ _id: doc._id });
      await refreshCopy();
    }
  });
});

describe('real saved-view count HTTP routes', () => {
  const get = (path: string, user = rep) => request(app).get(path)
    .set('Cookie', `customerToken=${signStaffSession({ _id: user }, secret)}`);

  it('requires sign-in and View, and rejects non-scalar queries on both aliases', async () => {
    for (const database of ['mongo', 'postgres']) {
      process.env.DB_CUSTOMERS = database;
      for (const path of ['/api/customers/view-counts', '/api/partners/view-counts']) {
        await request(app).get(path).expect(401);
        await get(path, denied).expect(403);
        await get(`${path}?tab=partners&tab=fabricators`).expect(400);
      }
    }
  });

  it('keeps counts hidden without Full profile, even when Postgres is not configured', async () => {
    const oldUrl = process.env.DATABASE_URL;
    useAppDbForTests(null);
    delete process.env.DATABASE_URL;
    try {
      for (const database of ['mongo', 'postgres']) {
        process.env.DB_CUSTOMERS = database;
        for (const user of [basic, exporter]) expect((await get('/api/customers/view-counts', user).expect(200)).body).toEqual({});
      }
    } finally {
      if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
      useAppDbForTests(pg.db);
    }
  });

  it('preserves the alias and tab contract, ignoring unrelated list filters', async () => {
    for (const tab of ['', '?tab=partners', '?tab=Partners']) {
      process.env.DB_CUSTOMERS = 'mongo';
      const m = await get('/api/customers/view-counts' + tab).expect(200);
      for (const database of ['mongo', 'postgres']) {
        process.env.DB_CUSTOMERS = database;
        for (const path of ['/api/customers/view-counts', '/api/partners/view-counts']) {
          const query = tab + (tab ? '&' : '?') + 'location=seattle&city=missing&search=no-match&salesRep=unassigned&view=mine';
          expect((await get(path + query).expect(200)).body).toEqual(m.body);
        }
      }
    }
  });
});
