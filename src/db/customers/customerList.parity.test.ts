/** Exercise the Customers page contract against real MongoDB queries and PostgreSQL SQL. */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import { readMongo } from '../copy/readMongo.ts';
import { copyFromMongo } from '../copy/plan.ts';
import { useAppDbForTests } from '../appDb.ts';
import Customer from '../../models/Customer.ts';
import * as data from './index.ts';
import { normalize, differences } from './parity.ts';
import type { CustomerListQuery, CustomerList } from './types.ts';
import { BASIC_CUSTOMER_FIELDS } from '../../utils/customerAccess.ts';
import request from 'supertest';
import { signStaffSession } from '../../services/staffSession.ts';

const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), dallas = oid(), role = oid(), rep = oid(), rep2 = oid(), exporter = oid();
const ids = Array.from({ length: 9 }, oid);
let mongo: MongoMemoryReplSet;
let pg: OpenDb;
let app: import('express').Express;
const secretBefore = process.env.JWT_SECRET;
const runtimeBefore = process.env.RUNTIME;
const secret = 'local-customer-list-http-test-session-secret';
const base: CustomerListQuery = {
  page: 1, limit: -1, search: '', mayProfile: true, userId: String(rep), today: '2026-11-09', sortBy: 'company', sortOrder: 1
};

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  const db = mongoose.connection.db!;
  await db.collection('locations').insertMany([{ _id: seattle, name: 'Seattle' }, { _id: dallas, name: 'Dallas' }]);
  await db.collection('roles').insertMany([
    { _id: role, name: 'sales_rep', permissions: ['view_customers'] },
    { _id: oid(), name: 'list_full', permissions: ['view_customers', 'view_customer_profile', 'export_customers'] },
    { _id: oid(), name: 'list_export', permissions: ['view_customers', 'export_customers'] }
  ]);
  await db.collection('users').insertMany([
    { _id: rep, username: 'jo', displayName: 'Jo Rep', password: 'x', role: 'sales_rep', location: 'Seattle' },
    { _id: rep2, username: 'sam_smith', displayName: '', password: 'x', role: 'list_full', location: 'Dallas' },
    { _id: exporter, username: 'exporter', password: 'x', role: 'list_export', location: 'Seattle' }
  ]);
  const extra = [
    { company: 'Acme Stone', level: 'Level - 1', salesRep: rep, salesRepName: 'Jo Rep', modaDisplay: 'Yes', modaBinder: '6',
      contacts: [{ name: 'Ann' }, { name: 'Bo' }], visits: [{ date: '2026-11-01', followUpDate: '2026-11-16' }] },
    { company: 'A bottom', status: 'Not Interested', salesRep: rep2, salesRepName: 'Sam Smith', customerType: 'Builder', location: 'Dallas' },
    { company: 'Bolt Granite', status: 'Trying to Onboard', level: 'Level - 2', customerType: 'Dealer', location: 'Dallas',
      visits: [{ date: '2026-11-01', followUpDate: '2026-11-17' }] },
    { company: '  cedar', status: 'New Lead', salesRep: rep2, salesRepName: 'Sam Smith',
      visits: [{ date: '2026-11-01', followUpDate: '2026-11-09', followUpDoneOn: '2026-11-09' }] },
    { company: '50%_off \\ Stone', phone: 'No number', address: { city: 'kent', street: '' } },
    { contactName: 'Pat Plain', phone: '', email: 'pat@easystones.com' },
    { company: 'Élan', level: 'Level - 4', email: 'test@example.com', customerType: 'Designer' },
    { company: 'Echo', email: 'person@easystones.com; real@echo.example' },
    { company: 'Foxtrot', status: 'Different Sales Person', geocode: { status: 'failed' }, location: 'Dallas' }
  ];
  await Customer.insertMany(extra.map((fields, i) => ({
    _id: ids[i], contactName: `Contact ${i}`, email: `contact${i}@real.example`, phone: '2065550123',
    company: '', location: 'Seattle', address: { street: '1 Main Street', city: i % 2 ? 'Dallas' : 'Kent' },
    createdAt: new Date(`2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`), updatedAt: new Date('2026-11-01T00:00:00Z'),
    password: 'secret', ...fields
  })), { timestamps: false } as never);
  // The list intentionally treats all these historical type variants as Fabricator.
  await Customer.collection.updateOne({ _id: ids[3] }, { $set: { customerType: null } });
  await Customer.collection.updateOne({ _id: ids[4] }, { $set: { customerType: '' } });
  await Customer.collection.updateOne({ _id: ids[5] }, { $unset: { customerType: '' } });
  await Customer.collection.updateOne({ _id: ids[7] }, { $unset: { salesRepName: '' } });
  pg = await openDb('pglite:memory');
  await migrateDb(pg.db, 'pglite:memory');
  await copyFromMongo(pg.db, await readMongo(mongo.getUri(), 'list-parity'), { write: true });
  useAppDbForTests(pg.db);
  // Exercise the real route and authentication too. Lambda mode imports the
  // Express app without listening, seeding, or starting any background jobs.
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
  if (secretBefore === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secretBefore;
  if (runtimeBefore === undefined) delete process.env.RUNTIME; else process.env.RUNTIME = runtimeBefore;
});

describe('the real Customers list HTTP route', () => {
  const get = (url: string, user = rep) => request(app).get(url)
    .set('Cookie', `customerToken=${signStaffSession({ _id: user }, secret)}`);

  it('keeps authentication, scalar-query validation and export authorization', async () => {
    for (const database of ['mongo', 'postgres']) {
      process.env.DB_CUSTOMERS = database;
      await request(app).get('/api/customers/list').expect(401);
      await get('/api/customers/list?city=Kent&city=Dallas').expect(400);
      await get('/api/customers/list?limit=-1').expect(403);
    }
  });

  it('ignores profile-only filters for a basic viewer and clamps a zero limit to one', async () => {
    for (const database of ['mongo', 'postgres']) {
      process.env.DB_CUSTOMERS = database;
      const r = await get('/api/customers/list?view=mine&level=Level%20-%201&moda=display&limit=0').expect(200);
      expect(r.body).toMatchObject({ totalCount: 9, totalPages: 9, currentPage: 1 });
      expect(r.body.partners).toHaveLength(1);
      expect(Object.keys(r.body.partners[0]).every(k => (BASIC_CUSTOMER_FIELDS as readonly string[]).includes(k))).toBe(true);
    }
  });

  it('answers the same on the canonical and legacy routes for full-profile reads and exports', async () => {
    for (const path of ['/api/customers/list', '/api/partners']) {
      for (const query of ['?limit=-1&sortBy=company', '?limit=3&page=2&sortBy=level', '?type=fabricator&city=Kent&moda=noDisplay']) {
        process.env.DB_CUSTOMERS = 'mongo';
        const m = await get(path + query, rep2).expect(200);
        process.env.DB_CUSTOMERS = 'postgres';
        const p = await get(path + query, rep2).expect(200);
        expect(differences(normalize(m.body), normalize(p.body))).toEqual([]);
      }
    }
  });

  it('permits export without Full profile, still returning only basic fields', async () => {
    for (const database of ['mongo', 'postgres']) {
      process.env.DB_CUSTOMERS = database;
      const r = await get('/api/customers/list?limit=-1&view=mine', exporter).expect(200);
      expect(r.body.partners).toHaveLength(9);
      for (const row of r.body.partners) expect(Object.keys(row).every(k => (BASIC_CUSTOMER_FIELDS as readonly string[]).includes(k))).toBe(true);
    }
  });
});

/**
 * Ask both databases; every row and the exact order must match (the id is the last sort
 * key on both). `setAside`: customers a documented difference places elsewhere.
 */
async function both(over: Partial<CustomerListQuery> = {}, setAside: mongoose.Types.ObjectId[] = []): Promise<CustomerList> {
  const q = { ...base, ...over };
  process.env.DB_CUSTOMERS = 'mongo';
  const m = await data.customerList(q);
  process.env.DB_CUSTOMERS = 'postgres';
  const p = await data.customerList(q);
  const aside = new Set(setAside.map(String));
  const prepare = (r: CustomerList) => ({ ...r, partners: r.partners.filter(c => !aside.has(String(c._id))) });
  expect(differences(normalize(prepare(m)), normalize(prepare(p)))).toEqual([]);
  return p;
}

describe('GET /api/customers/list parity', () => {
  it('returns the same envelope, sort metadata and contact counts, excluding heavy/private fields', async () => {
    const r = await both();
    expect(r).toMatchObject({ totalCount: 9, totalPages: 1, currentPage: 1 });
    const acme = r.partners.find(c => c._id === String(ids[0]))!;
    expect(acme).toMatchObject({ contactsCount: 2, normalizedCompany: 'Acme Stone', sortPriority: 0 });
    for (const row of r.partners) for (const field of ['password', 'contacts', 'visits', 'resources']) expect(row).not.toHaveProperty(field);
    expect(r.partners.slice(-2).map(c => c.status)).toEqual(['Not Interested', 'Different Sales Person']);
  });

  it.each(['company', 'level', 'city', 'salesRep', 'location', 'createdAt'])('sorts by %s in both directions with low-priority statuses last', async sortBy => {
    // ids[7] was saved with no rep name at all: see the next test.
    for (const sortOrder of [1, -1] as const) await both({ sortBy, sortOrder }, sortBy === 'salesRep' ? [ids[7]] : []);
  });

  it('sorts a customer saved with no rep name among the unassigned on Postgres (README Known differences)', async () => {
    // MongoDB sorts a missing name before '' (it comes first); Postgres has no stored
    // name to be missing, so it sits with the other unassigned customers.
    process.env.DB_CUSTOMERS = 'mongo';
    expect(String((await data.customerList({ ...base, sortBy: 'salesRep' })).partners[0]._id)).toBe(String(ids[7]));
    process.env.DB_CUSTOMERS = 'postgres';
    const p = await data.customerList({ ...base, sortBy: 'salesRep' });
    const unassigned = p.partners.filter(c => c.sortPriority === 0 && !c.salesRepName).map(c => c._id);
    expect(unassigned).toContain(String(ids[7]));
    expect(p.partners[0]._id).not.toBe(String(ids[7]));
    await both({ sortBy: 'unknown-sort' });
  });

  it('pages never repeat or skip a customer, even where many share the sort value', async () => {
    for (const database of ['mongo', 'postgres']) {
      process.env.DB_CUSTOMERS = database;
      for (const sortBy of ['city', 'location', 'level']) {
        const all = (await data.customerList({ ...base, sortBy })).partners.map(c => c._id);
        const paged: unknown[] = [];
        for (let page = 1; page <= 5; page++) paged.push(...(await data.customerList({ ...base, sortBy, page, limit: 2 })).partners.map(c => c._id));
        expect(paged).toEqual(all);
      }
    }
  });

  it('pages, exports, and returns empty results with the same counts', async () => {
    for (const page of [1, 2, 4, 20]) await both({ page, limit: 3 });
    expect(await both({ search: 'no match' })).toMatchObject({ partners: [], totalCount: 0, totalPages: 0 });
    expect(await both({ search: 'no match', limit: 50 })).toMatchObject({ partners: [], totalCount: 0, totalPages: 0 });
  });

  it.each(['ACME', 'contact 2', '206', 'Main', 'Kent', 'Trying', '@echo', '%', '_', '\\', "' OR true --"])(
    'searches every supported field literally: %s', async search => { await both({ search }); });

  it.each(['mine', 'followups', 'onboarding', 'noModa', 'unassigned', 'incomplete'])(
    'applies the %s saved view', async view => { await both({ view }); });

  it('uses the inclusive seven-day follow-up window, including done visits as before', async () => {
    const r = await both({ view: 'followups' });
    expect(new Set(r.partners.map(c => c._id))).toEqual(new Set([String(ids[0]), String(ids[3])]));
    expect((await both({ view: 'mine', userId: 'invalid' })).totalCount).toBe(0);
  });

  it.each(['A', 'b', '#', 'E', '  C ', '?', 'AB'])('preserves the A–Z jump: %s', async letter => { await both({ letter }); });

  it.each(['display', 'noDisplay', 'binders', 'noBinders', 'display,noBinders', 'unknown'])(
    'preserves Moda OR filters: %s', async moda => { await both({ moda }); });

  it('preserves multi-select filters, legacy Fabricators and the existing exclusion precedence', async () => {
    for (const q of [
      { status: 'New Lead, Trying to Onboard' }, { level: 'Level - 1,Level - 4' },
      { type: 'Fabricator' }, { type: 'Builder,Dealer' }, { type: 'fabricator,Designer' },
      { typeExclude: 'Fabricator,Builder' }, { typeExclude: 'Builder,Designer' },
      { city: '^kent$' }, { city: 'Kent,Dallas' }, { location: 'Dallas,Seattle' }, { location: 'seattle' }, { location: 'dallas,Seattle' },
      { salesRep: `${rep},unassigned` }, { salesRep: String(rep2) }, { salesRep: 'invalid' },
      { type: 'fabricator', city: 'Kent', moda: 'noDisplay', salesRep: 'unassigned', level: 'Level - 3' }
    ]) await both(q);
  });

  it('basic rows expose only the existing basic-card projection, including on export', async () => {
    for (const limit of [-1, 3]) {
      const r = await both({ mayProfile: false, limit });
      for (const row of r.partners) expect(Object.keys(row).every(k => (BASIC_CUSTOMER_FIELDS as readonly string[]).includes(k))).toBe(true);
    }
  });
});
