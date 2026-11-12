/** The small reads through the real copy, with HTTP authorization and saved-response checks. */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import { openWriteParity, type WriteParity } from './writes/writeParity.ts';
import * as data from './index.ts';
import { normalize } from './parity.ts';
import Customer from '../../models/Customer.ts';
import User from '../../models/User.ts';
import { users } from '../schema/reference.ts';
import { signStaffSession } from '../../services/staffSession.ts';
import { vcardPersonFor, buildVCard } from '../../utils/vcard.ts';
import createPublicProductsRouter from '../../routes/publicProducts.ts';
import createHoldsRouter from '../../holds/router.ts';
import createPermitsRouter from '../../permits/router.ts';
import { Permit } from '../../permits/models.ts';
import type { Loose } from '../../types/records.ts';

const oid = () => new mongoose.Types.ObjectId();
const me = oid(), basic = oid(), denied = oid(), cid = oid(), inactive = oid(), blank = oid(), contact = oid();
const clock = '2026-11-11T09:30:00.000', secret = 'isolated-customer-lookups';
const prior = { RUNTIME: process.env.RUNTIME, JWT_SECRET: process.env.JWT_SECRET };
let t: WriteParity, app: import('express').Express;

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertOne({ _id: oid(), name: 'Seattle' });
    await db.collection('roles').insertMany([
      { _id: oid(), name: 'lookup_full', permissions: ['view_customers', 'view_customer_profile', 'manage_customers', 'add_customers'] },
      { _id: oid(), name: 'lookup_basic', permissions: ['view_customers'] },
      { _id: oid(), name: 'lookup_denied', permissions: [] }
    ]);
    await db.collection('users').insertMany([
      { _id: me, username: 'owner', displayName: 'Owner', password: 'x', role: 'lookup_full', location: 'Seattle', assignedLocations: ['Seattle'], isActive: true },
      { _id: basic, username: 'basic', password: 'x', role: 'lookup_basic', isActive: true },
      { _id: denied, username: 'denied', password: 'x', role: 'lookup_denied', isActive: true }
    ]);
    await db.collection('resourcefamilies').insertMany(['tower', 'binder', 'other'].map(name => ({ _id: oid(), name })));
    await db.collection('resourcetypes').insertMany([
      { _id: oid(), name: 'Tower', family: 'tower' }, { _id: oid(), name: 'Binder', family: 'binder' }
    ]);
    await Customer.insertMany([
      { _id: cid, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.test', phone: '206-555-0100', location: 'Seattle',
        salesRep: me, salesRepName: 'Owner', priceLevel: 4, password: 'secret-hash',
        address: { street: '12 Main St', city: 'Kent', state: 'WA', zipCode: '98032' },
        contacts: [{ _id: contact, name: 'Zoe', email: 'zoe@acme.test', phone: '425-555-0199', role: 'Purchasing', createdAt: clock }],
        modaDisplay: 'Yes', modaBinder: '5', modaEarlier: { display: false, binders: 2 },
        resources: [
          { _id: oid(), title: 'Tower', resourceType: 'Tower', qty: 1, status: 'Active', date: '2026-11-09', customer: 'Acme Stone', uploadedBy: String(me), createdAt: clock },
          { _id: oid(), title: 'Binder', resourceType: 'Binder', qty: 3, status: 'Active', date: '2026-11-10', customer: 'Acme Stone', uploadedBy: String(me), createdAt: clock },
          { _id: oid(), title: 'Binder', resourceType: 'Binder', qty: 9, status: 'Inactive', date: '2026-11-10', customer: 'Acme Stone', uploadedBy: String(me), createdAt: clock }
        ] },
      { _id: inactive, contactName: 'Inactive', email: 'inactive@test.invalid', isActive: false, priceLevel: 2 },
      { _id: blank, contactName: 'Empty', email: 'empty@test.invalid' }
    ]);
    await Permit.collection.insertOne({ _id: oid(), source: 'whatcom', permitNumber: 'lookup', category: 'new_home', issuedOn: '2026-11-01',
      contacts: [{ name: 'Zoe', email: 'zoe@acme.test' }], address: '1 Example', city: 'Kent' });
  });
  process.env.RUNTIME = 'lambda'; process.env.JWT_SECRET = secret;
  ({ app } = await import('../../../server.ts'));
}, 180_000);

afterAll(async () => {
  await t?.close();
  for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}, 60_000);

async function both<T>(read: () => Promise<T>): Promise<T> {
  const mongo = await t.on('mongo', read), postgres = await t.on('postgres', read);
  expect(normalize(postgres)).toEqual(normalize(mongo));
  return postgres;
}
const get = (path: string, user = me) => request(app).get(path)
  .set('Cookie', `customerToken=${signStaffSession({ _id: user }, secret)}`);

it('matches vCard records, contact order, empty/missing customers and uppercase ids', async () => {
  for (const id of [String(cid), String(cid).toUpperCase(), String(blank), String(oid())]) {
    await both(() => data.customerVCard(id));
  }
  const card = await data.customerVCard(String(cid));
  expect(buildVCard(vcardPersonFor(card!, String(contact))!)).toContain('Zoe');
});

it('matches Moda active counts, earlier counts, archived items and equal-day order', async () => {
  const summary = await both(() => data.customerModa(String(cid)));
  expect(summary).toMatchObject({ display: true, binders: 5, earlier: { display: false, binders: 2 } });
  expect(summary!.items).toHaveLength(3);
  await both(() => data.customerModa(String(blank))); await both(() => data.customerModa(String(oid())));
});

it('matches Holds records, matching contacts and catalog tiers, including inactive/missing ids', async () => {
  for (const id of [String(cid), String(blank), String(cid).toUpperCase(), String(inactive), String(oid())]) {
    await both(() => data.customerById(id)); await both(() => data.customerPriceLevel(id));
  }
  const matching = await both(() => data.customerContactsForMatching());
  expect(matching.find(c => String(c._id) === String(cid))!.contacts[0].email).toBe('zoe@acme.test');
});

it('keeps a MongoDB caller\'s transaction on its Holds customer lookup', async () => {
  await t.on('mongo', async () => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await Customer.updateOne({ _id: cid }, { $set: { company: 'Uncommitted name' } }, { session });
      expect((await data.customerById(String(cid), session))!.company).toBe('Uncommitted name');
      expect((await Customer.findById(cid).lean())!.company).toBe('Acme Stone');
    } finally { await session.abortTransaction(); await session.endSession(); }
  });
});

it('uses PostgreSQL uploader names and the actual saved record without a MongoDB lookup', async () => {
  const record = (await Customer.findById(cid))!.toObject() as Loose;
  record.quickNote = 'Newer than the copied profile';
  await t.pg.db.update(users).set({ displayName: 'Postgres Owner' }).where(eq(users.id, String(me)));
  const find = vi.spyOn(User, 'find').mockImplementation(() => { throw new Error('MongoDB was reached'); });
  try {
    const response = await t.on('postgres', () => data.customerRecordResponse(record, { mayProfile: true, people: new Set([String(me)]) }));
    expect(response.resources.every((r: Loose) => r.uploadedByName === 'Postgres Owner')).toBe(true);
    expect(response.quickNote).toBe(record.quickNote); expect(response.password).toBeUndefined();
    expect(find).not.toHaveBeenCalled();
  } finally { find.mockRestore(); await t.pg.db.update(users).set({ displayName: 'Owner' }).where(eq(users.id, String(me))); }
});

describe.each(['mongo', 'postgres'] as const)('%s lookup HTTP behavior', database => {
  it('returns the new create/edit values with history scope and no credentials', async () => {
    await t.on(database, async () => {
      const cookie = `customerToken=${signStaffSession({ _id: me }, secret)}`;
      await request(app).put(`/api/customers/${cid}`).send({ contactName: 'Updated contact' }).expect(401);
      await request(app).put(`/api/customers/${cid}`)
        .set('Cookie', `customerToken=${signStaffSession({ _id: denied }, secret)}`).send({ contactName: 'Denied' }).expect(403);
      const edited = await request(app).put(`/api/customers/${cid}`).set('Cookie', cookie)
        .send({ contactName: 'Updated contact' }).expect(200);
      expect(edited.body.contactName).toBe('Updated contact'); expect(edited.body.password).toBeUndefined();
      expect(edited.body.resources.every((r: Loose) => r.uploadedByName === 'Owner')).toBe(true);
      const created = await request(app).post('/api/customers').set('Cookie', cookie).send({
        company: `New ${database}`, email: `new-${database}@example.test`, coordinates: { lat: 47.5, lng: -122.3 },
        location: 'Seattle', contactName: 'New contact', salesRep: String(me)
      }).expect(201);
      expect(created.body).toMatchObject({ company: `New ${database}`, contactName: 'New contact', salesRepName: 'Owner' });
      expect(created.body.password).toBeUndefined(); expect(created.body.resources).toEqual([]);
    });
  });

  it('gates vCards by full-profile permission and preserves bytes and download headers', async () => {
    await t.on(database, async () => {
      const path = `/api/customers/${cid}/vcard`;
      await request(app).get(path).expect(401); await get(path, denied).expect(403); await get(path, basic).expect(403);
      const expected = buildVCard(vcardPersonFor((await data.customerVCard(String(cid)))!, String(contact))!);
      const res = await get(`${path}?contact=${contact}`).expect(200);
      expect(res.text).toBe(expected); expect(res.headers['content-type']).toContain('text/vcard');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect((await get(path).set('User-Agent', 'iPhone').expect(200)).headers['content-disposition']).toContain('inline');
      await get(`${path}?contact=missing`).expect(404); await get(`/api/customers/${oid()}/vcard`).expect(404);
    });
  });

  it('keeps Moda permission checks and invalid/missing responses', async () => {
    await t.on(database, async () => {
      const path = `/api/customers/${cid}/moda`;
      await request(app).get(path).expect(401); await get(path, denied).expect(403); await get(path, basic).expect(403);
      expect((await get(path).expect(200)).body).toMatchObject({ binders: 5, display: true });
      await get('/api/customers/malformed/moda').expect(404); await get(`/api/customers/${oid()}/moda`).expect(404);
    });
  });

  it('serves only the active customer\'s stored catalog tier', async () => {
    const catalog = express(); catalog.use(cookieParser());
    catalog.use('/products', createPublicProductsRouter({ jwtSecret: secret, getProducts: async () => [
      { id: 1, name: 'Stone', priceLevels: { level1: 99, level4: 0 }, landingCost: 12 }
    ] }));
    await t.on(database, async () => {
      for (const id of [cid, inactive, oid()]) {
        const token = jwt.sign({ id: String(id), type: 'customer', priceLevel: 1 }, secret);
        const res = await request(catalog).get('/products').set('Authorization', `Bearer ${token}`).expect(200);
        expect(res.body[0].price).toBe(id === cid ? '$0.00/sqft' : undefined);
        expect(res.body[0].priceLevels).toBeUndefined(); expect(res.body[0].landingCost).toBeUndefined();
      }
      expect((await request(catalog).get('/products').expect(200)).body[0].price).toBeUndefined();
    });
  });

  it('keeps Holds customer snapshots and Permits contact matches behind their permissions', async () => {
    const local = express(); local.use(express.json());
    const authenticate: import('express').RequestHandler = (req, res, next) => {
      if (!req.headers['x-permissions']) return res.status(401).json({ message: 'Sign in' });
      req.user = { id: String(me), displayName: 'Owner', permissions: JSON.parse(String(req.headers['x-permissions'])), assignedLocations: ['Seattle'] };
      next();
    };
    local.use('/holds', createHoldsRouter({ authenticate }));
    local.use('/permits', createPermitsRouter({ authenticate, customerIndexMs: 0 }));
    await t.on(database, async () => {
      await request(local).patch('/holds/cart/customer').send({ customerId: cid }).expect(401);
      await request(local).patch('/holds/cart/customer').set('x-permissions', '[]').send({ customerId: cid }).expect(403);
      const hold = await request(local).patch('/holds/cart/customer').set('x-permissions', '["use_cart"]').send({ customerId: cid }).expect(200);
      expect(hold.body.cart?.customer ?? hold.body.customer).toEqual({ id: String(cid), name: 'Acme Stone' });
      await request(local).get('/permits').expect(401);
      await request(local).get('/permits').set('x-permissions', '[]').expect(403);
      const permits = await request(local).get('/permits').set('x-permissions', '["view_permits"]').expect(200);
      expect(permits.body.items[0].contacts[0].customer).toEqual({ id: String(cid), name: 'Acme Stone' });
    });
  });
});
