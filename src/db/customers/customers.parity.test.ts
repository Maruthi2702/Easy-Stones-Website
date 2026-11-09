/**
 * The customer data layer answers the same from MongoDB and from Postgres: the same
 * records go into an in-memory MongoDB, are copied into PGlite exactly as the real copy
 * does (readMongo → copyFromMongo), and every read is asked of both.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import { copyFromMongo } from '../copy/plan.ts';
import { readMongo } from '../copy/readMongo.ts';
import { useAppDbForTests, areaOn } from '../appDb.ts';
import * as data from './index.ts';
import { normalize, differences } from './parity.ts';
import Customer from '../../models/Customer.ts';

const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), dallas = oid(), repRole = oid();
const rep = oid(), rep2 = oid();
const acme = oid(), bolt = oid(), plain = oid(), odd = oid();

let rs: MongoMemoryReplSet;
let pg: OpenDb;

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(rs.getUri());
  const db = mongoose.connection.db!;
  await db.collection('locations').insertMany([{ _id: seattle, name: 'Seattle' }, { _id: dallas, name: 'Dallas' }]);
  await db.collection('roles').insertOne({ _id: repRole, name: 'sales_rep', displayName: 'Sales Rep', permissions: [] });
  await db.collection('users').insertMany([
    { _id: rep, username: 'jo.rep', displayName: 'Jo Rep', password: 'x', role: 'sales_rep', location: 'Dallas' },
    { _id: rep2, username: 'sam_smith', displayName: '', password: 'x', role: 'sales_rep', location: 'Seattle' }
  ]);
  // Through the model, as the app saves them: Mongoose fills in its defaults.
  // (A link to a deleted customer is the one thing the copy leaves out on purpose.)
  await Customer.insertMany([
    {
      _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.example', location: 'Dallas',
      salesRep: rep, salesRepName: 'Jo Rep', customerType: 'Fabricator', status: 'Onboarded', level: 'Level - 1',
      modaDisplay: 'Yes', modaBinder: '6', modaEarlier: { display: true }, password: '$2a$10$z', loginIps: ['1.2.3.4'],
      loginAttempts: 1, address: { street: '1 Main', city: 'Dallas ', state: 'TX', zipCode: '75001' },
      coordinates: { lat: 32.7, lng: -96.8 }, geocode: { status: 'ok', precision: 'rooftop', formattedAddress: '1 Main, Dallas', addressKey: 'k', updatedAt: new Date('2026-10-01T00:00:00Z'), error: '' },
      sps: { key: 'acme stone', name: 'Acme Stone', firstImportedAt: new Date('2026-10-18T10:00:00Z') },
      associatedCustomers: [bolt], notDuplicateOf: [plain], isVerified: true, isActive: true, priceLevel: 2,
      quickNote: 'Gate code 12', contacts: [{ _id: oid(), name: 'Bo' }],
      visits: [{ _id: oid(), date: '2026-10-23', purpose: 'Sales Call', createdAt: '2026-10-23T14:05:00.000' },
        { _id: oid(), date: '2026-11-02', purpose: 'Sales Call', createdAt: '2026-11-02T09:00:00.000' }],
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-10-23T21:06:00Z'), __v: 3
    },
    {
      _id: bolt, company: 'Bolt Granite', contactName: 'Bea', email: 'bea@bolt.example', location: 'Seattle',
      salesRep: rep2, salesRepName: 'Sam Smith', modaDisplay: 'No', modaBinder: '0', address: { city: 'Kent' },
      createdAt: new Date('2026-03-01T00:00:00Z'), updatedAt: new Date('2026-03-01T00:00:00Z')
    },
    {
      _id: plain, contactName: 'Pat Plain', email: 'pat@plain.example', location: 'Seattle', salesRep: null,
      createdAt: new Date('2026-05-01T00:00:00Z'), updatedAt: new Date('2026-05-01T00:00:00Z')
    },
    {
      _id: odd, company: '50%_off \\ Stone', contactName: 'Oddie', email: 'odd@example.com', location: 'Dallas',
      address: { street: '', city: 'kent', state: '', zipCode: '' },
      createdAt: new Date('2026-07-01T00:00:00Z'), updatedAt: new Date('2026-07-01T00:00:00Z')
    }
  ], { timestamps: false } as never);

  pg = await openDb('pglite:memory');
  await migrateDb(pg.db, 'pglite:memory');
  await copyFromMongo(pg.db, await readMongo(rs.getUri(), 'parity-test'), { write: true });
  useAppDbForTests(pg.db);
}, 120_000);

afterEach(() => { delete process.env.DB_CUSTOMERS; });
afterAll(async () => {
  useAppDbForTests(null);
  await pg?.close();
  await mongoose.disconnect();
  await rs?.stop();
});

/** Ask the data layer once on each database. */
async function both<T>(read: () => Promise<T>): Promise<{ mongo: unknown; postgres: unknown }> {
  process.env.DB_CUSTOMERS = 'mongo';
  const m = normalize(await read());
  process.env.DB_CUSTOMERS = 'postgres';
  const p = normalize(await read());
  return { mongo: m, postgres: p };
}

function expectSame({ mongo, postgres }: { mongo: unknown; postgres: unknown }) {
  expect(differences(mongo, postgres)).toEqual([]);
}

describe('the switch', () => {
  it('is MongoDB unless DB_CUSTOMERS says postgres', () => {
    expect(areaOn('customers')).toBe('mongo');
    process.env.DB_CUSTOMERS = ' Postgres ';
    expect(areaOn('customers')).toBe('postgres');
    process.env.DB_CUSTOMERS = 'yes';
    expect(areaOn('customers')).toBe('mongo');
  });
});

describe('customer reads answer the same from both databases', () => {
  it('the dropdown: every customer, its address and rep name, in the same order', async () => {
    const r = await both(() => data.dropdownCustomers());
    expectSame(r);
    expect((r.postgres as { _id: string }[]).map(c => c._id)).toEqual([plain, odd, acme, bolt].map(String));
    expect(r.postgres).toContainEqual(expect.objectContaining({ _id: String(bolt), salesRepName: 'Sam Smith' }));
  });

  it('the cities list', async () => {
    const r = await both(() => data.customerCities());
    expectSame(r);
    expect(r.postgres).toEqual(['Dallas', 'Kent', 'kent']);
  });

  it('a page of customers, newest first, with the last visit day', async () => {
    const r = await both(() => data.customerPage({ page: 1, limit: 50, search: '' }));
    expectSame(r);
    const page = r.postgres as { total: number; customers: { _id: string; lastVisitDate?: string; associatedCustomers?: string[] }[] };
    expect(page.total).toBe(4);
    expect(page.customers.map(c => c._id)).toEqual([odd, plain, bolt, acme].map(String));
    const a = page.customers.find(c => c._id === String(acme))!;
    expect(a.lastVisitDate).toBe('2026-11-02');
    expect(a).not.toHaveProperty('password');
    expect(a).not.toHaveProperty('contacts');
  });

  it('pages and searches the same, % and _ taken literally', async () => {
    expectSame(await both(() => data.customerPage({ page: 2, limit: 3, search: '' })));
    for (const search of ['ANN', 'bolt.example', '50%_', '%', '_', 'nobody', 'stone']) {
      const r = await both(() => data.customerPage({ page: 1, limit: 50, search }));
      expectSame(r);
    }
    const literal = (await both(() => data.customerPage({ page: 1, limit: 50, search: '%' }))).postgres as { total: number };
    expect(literal.total).toBe(1);
  });
});
