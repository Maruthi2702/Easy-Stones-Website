/**
 * Lost Sales, through the real router: each request run on MongoDB, then on Postgres, must
 * answer the same and leave the same records behind (Postgres' rows are compared with what
 * the copy makes of MongoDB's — lostSaleRowOf is the spec).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { asc } from 'drizzle-orm';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import LostSale from '../../models/LostSale.ts';
import Customer from '../../models/Customer.ts';
import { lostSales } from '../schema/misc.ts';
import { lostSaleRowOf } from '../copy/miscRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import createLostSalesRouter from '../../routes/lostSales.ts';
import type { Loose } from '../../types/records.ts';

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
// A new record's id is made by the route: both runs of one request must get the same one.
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});

const oid = () => String(new mongoose.Types.ObjectId());
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const ALL = ['view_lost_sales', 'edit_lost_sales', 'delete_lost_sales'];
const SEATTLE = { id: oid(), username: 'dee', displayName: 'Dee', permissions: ALL, assignedLocations: ['Seattle'], role: 'sales_rep' };
const ADMIN = { id: oid(), username: 'root', displayName: 'Root', permissions: ALL, assignedLocations: ['*'], role: 'admin' };
const VIEWER = { id: oid(), username: 'vi', permissions: ['view_lost_sales'], assignedLocations: ['Seattle'], role: 'sales_rep' };
const SPOKANE = { id: oid(), username: 'ken', permissions: ALL, assignedLocations: ['Spokane'], role: 'sales_rep' };
const CUSTOMER_LOGIN = { id: oid(), type: 'customer', permissions: ALL, assignedLocations: ['Seattle'] };

let t: WriteParity;
let app: express.Express;
const acme = oid(), rep = oid();
const seeded = { sea: oid(), spo: oid(), none: oid() };

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Spokane'].map(name => ({ _id: new mongoose.Types.ObjectId(), name })));
    await db.collection('roles').insertOne({ _id: new mongoose.Types.ObjectId(), name: 'staff', displayName: 'Staff', permissions: [] });
    await db.collection('users').insertMany(([SEATTLE, ADMIN, SPOKANE, VIEWER, { id: rep, username: 'rep', displayName: 'Rep One' }] as Loose[]).map(u => ({
      _id: new mongoose.Types.ObjectId(u.id), username: u.username, password: 'x', role: 'staff', email: `${u.username}@x.com`, displayName: u.displayName ?? u.username, isActive: true
    })));
    await Customer.insertMany([{ _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.test' }]);
    await LostSale.insertMany([
      { _id: seeded.sea, customerName: 'Acme Stone', customerId: acme, productName: 'Calacatta', lengthInches: 126, widthInches: 63, sfPerSlab: 55, slabsCount: 2, totalSf: 110,
        pricePerSf: 12.5, totalLostValue: 1375, reason: 'Price Too High', location: 'Seattle', competitorName: 'Rival', notes: 'n', salesRepName: 'Rep One', salesRepId: rep,
        date: new Date('2026-11-05T17:00:00Z'), createdAt: new Date('2026-11-05T17:00:00Z') },
      { _id: seeded.spo, customerName: 'Zeta Tile', productName: 'Taj', location: 'Spokane', date: new Date('2026-11-06T17:00:00Z'), createdAt: new Date('2026-11-06T17:00:00Z') }
    ]);
    // A record with no location at all: shown to everyone.
    await LostSale.collection.insertOne({ _id: new mongoose.Types.ObjectId(seeded.none), customerName: 'Old Co', productName: 'Old', reason: 'Other',
      date: new Date('2026-10-01T17:00:00Z'), createdAt: new Date('2026-10-01T17:00:00Z'), updatedAt: new Date('2026-10-01T17:00:00Z') });
  }, 'DB_LOST_SALES');

  app = express();
  app.use(express.json());
  app.use('/api/lost-sales', createLostSalesRouter({
    verifyAnyAuth: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
  }));
}, 240000);

afterAll(async () => { await t?.close(); });

/** Ids a request makes for itself must match on both runs, so the same test sends its own. */
async function same(user: Loose, send: (a: ReturnType<typeof request>) => request.Test) {
  ids.made.length = 0;
  const ask = async () => { ids.used = 0; const r = await send(request(app)).set(as(user)); return { status: r.status, body: r.body }; };
  const { mongo, postgres } = await t.both(ask);
  expect(postgres.status).toBe(mongo.status);
  expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  await expectSameRows();
  return mongo;
}

/** Postgres' rows = what the copy makes of MongoDB's now. */
async function expectSameRows() {
  const ref = await referenceIndexOf(t.pg.db);
  const built = (await LostSale.find().lean()).map(d => lostSaleRowOf(d as Loose, ref, { customerIds: new Set([acme]) }, []))
    .filter(Boolean) as NonNullable<ReturnType<typeof lostSaleRowOf>>[];
  built.sort((a, b) => a.id.localeCompare(b.id));
  expect(await t.pg.db.select().from(lostSales).orderBy(asc(lostSales.id))).toEqual(built);
}

const body = (over: Loose = {}) => ({
  customerName: ' Acme Stone ', customerId: acme, productName: 'Taj Mahal', slabsCount: 3, sfPerSlab: 50, pricePerSf: 10,
  reason: 'Out of Stock', location: 'Seattle', competitorName: '', notes: 'asked twice', date: '2026-11-09T18:00:00.000Z', ...over
});

describe('reading', () => {
  it('each login sees its own branches plus records with no branch; an admin sees all, newest first', async () => {
    const sea = await same(SEATTLE, a => a.get('/api/lost-sales'));
    expect(sea.body.map((x: Loose) => x._id)).toEqual([seeded.sea, seeded.none]);
    const all = await same(ADMIN, a => a.get('/api/lost-sales'));
    expect(all.body).toHaveLength(3);
    expect(all.body[0]._id).toBe(seeded.spo);
    await same(SPOKANE, a => a.get('/api/lost-sales'));
  });

  it('refuses a login without View, and a customer login', async () => {
    expect((await same({ ...SEATTLE, permissions: [] }, a => a.get('/api/lost-sales'))).status).toBe(403);
    expect((await same(CUSTOMER_LOGIN, a => a.get('/api/lost-sales'))).status).toBe(403);
  });
});

describe('adding', () => {
  it('works out the totals, trims names and fills the defaults', async () => {
    const made = await same(SEATTLE, a => a.post('/api/lost-sales').send(body()));
    expect(made.status).toBe(201);
    expect(made.body.totalSf).toBe(150);
    expect(made.body.totalLostValue).toBe(1500);
    expect(made.body.customerName).toBe('Acme Stone');
    await same(SEATTLE, a => a.post('/api/lost-sales').send({ customerName: 'Walk-in', productName: 'Slab' }));
    await same(ADMIN, a => a.post('/api/lost-sales').send(body({ location: 'Spokane', salesRepId: rep, salesRepName: 'Rep One' })));
  });

  it('refuses a stranger’s branch, a login without Edit, a missing name and a reason off the list', async () => {
    expect((await same(SEATTLE, a => a.post('/api/lost-sales').send(body({ location: 'Spokane' })))).status).toBe(403);
    expect((await same(VIEWER, a => a.post('/api/lost-sales').send(body()))).status).toBe(403);
    expect((await same(SEATTLE, a => a.post('/api/lost-sales').send(body({ customerName: '' })))).status).toBe(500);
    expect((await same(SEATTLE, a => a.post('/api/lost-sales').send(body({ reason: 'Because' })))).status).toBe(500);
  });
});

describe('a company that is not a customer', () => {
  it('MongoDB keeps the typed id, Postgres has no link (the one intended difference, as on Payments)', async () => {
    ids.made.length = 0;
    const send = body({ customerId: 'walk-in', customerName: 'Walk-in' });
    const { mongo, postgres } = await t.both(async () => { ids.used = 0; const r = await request(app).post('/api/lost-sales').send(send).set(as(SEATTLE)); return { status: r.status, body: r.body }; });
    expect(postgres.status).toBe(201);
    expect(mongo.body.customerId).toBe('walk-in');
    expect(postgres.body.customerId ?? null).toBeNull();
    expect(normalize({ ...postgres.body, customerId: undefined })).toEqual(normalize({ ...mongo.body, customerId: undefined }));
  });
});

describe('editing and deleting', () => {
  it('edits a record, keeping what the form does not send', async () => {
    const edited = await same(SEATTLE, a => a.put(`/api/lost-sales/${seeded.sea}`).send(body({ productName: 'Calacatta Gold', slabsCount: 4, reason: 'Lead Time', notes: 'moved' })));
    expect(edited.status).toBe(200);
    expect(edited.body.salesRepName).toBe('Rep One');
    await same(SEATTLE, a => a.put(`/api/lost-sales/${seeded.sea}`).send(body({ salesRepName: 'Dee', date: '2026-11-01T12:00:00Z' })));
  });

  it('a record at another branch reads as missing; a bad id, a bad reason and no Edit are refused', async () => {
    expect((await same(SEATTLE, a => a.put(`/api/lost-sales/${seeded.spo}`).send(body()))).status).toBe(404);
    expect((await same(SEATTLE, a => a.put(`/api/lost-sales/${oid()}`).send(body()))).status).toBe(404);
    expect((await same(SEATTLE, a => a.put(`/api/lost-sales/${seeded.sea}`).send(body({ reason: 'Because' })))).status).toBe(500);
    expect((await same(VIEWER, a => a.put(`/api/lost-sales/${seeded.sea}`).send(body()))).status).toBe(403);
    expect((await same(SEATTLE, a => a.put(`/api/lost-sales/${seeded.sea}`).send(body({ location: 'Spokane' })))).status).toBe(403);
  });

  it('deletes once, only what the login can see and may delete', async () => {
    expect((await same(VIEWER, a => a.delete(`/api/lost-sales/${seeded.none}`))).status).toBe(403);
    expect((await same(SPOKANE, a => a.delete(`/api/lost-sales/${seeded.sea}`))).status).toBe(404);
    expect((await same(ADMIN, a => a.delete(`/api/lost-sales/${seeded.none}`))).status).toBe(200);
    expect((await same(ADMIN, a => a.delete(`/api/lost-sales/${seeded.none}`))).status).toBe(404);
  });
});
