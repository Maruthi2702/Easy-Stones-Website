import type { Loose } from '../types/records.ts';
// Connect existing customers to SPS, against a throwaway in-memory MongoDB:
// the preview writes nothing, apply connects what's approved and only that,
// needs Import + Edit (and View), never overwrites a key, and a name taken in
// the meantime is reported rather than fatal. The sheet reader is a fake: the
// workbook parse has its own tests.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createCustomerSpsConnectRouter } = await import('./customerSpsConnect.ts');
const { default: Customer } = await import('../models/Customer.ts');

let mongo;
let app;
let sheet;

const BOTH = { username: 'krish', permissions: ['view_customers', 'import_customers', 'manage_customers'] };
const IMPORT_ONLY = { username: 'imp', permissions: ['view_customers', 'import_customers'] };
const NO_VIEW = { username: 'nv', permissions: ['import_customers', 'manage_customers'] };
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const FILE = Buffer.from('x');
const preview = (user = BOTH) => request(app).post('/api/customers/sps-connect/preview').set(as(user)).attach('file', FILE, 'a.xls');
const apply = (fields: Loose = {}, user = BOTH) => {
  let r = request(app).post('/api/customers/sps-connect/apply').set(as(user)).attach('file', FILE, 'a.xls');
  for (const [k, v] of Object.entries(fields)) r = r.field(k, typeof v === 'string' ? v : JSON.stringify(v));
  return r;
};

const [A, B, C] = [1, 2, 3].map(() => new mongoose.Types.ObjectId());
const row = (Name: Loose, Email = '', Phone1 = '') => ({ Name, Email, Phone1 });
const keyOf = async (id: string) => (await Customer.collection.findOne({ _id: id }))?.sps;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Customer.syncIndexes();
  app = express();
  app.use(express.json());
  app.use('/api/customers', createCustomerSpsConnectRouter({
    authenticate: (req: Loose, res: Loose, next: Loose) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    uploadMemory: multer({ storage: multer.memoryStorage() }),
    readSheet: async () => sheet,
    resolveMapping: () => ({ company: 'Name', email: 'Email', phone: 'Phone1' })
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Customer.collection.deleteMany({});
  await Customer.collection.insertMany([
    { _id: A, company: 'Acme Stone', email: 'a@acme.com' },
    { _id: B, company: 'Bay Granite', email: 'b@bay.com', phone: '(206) 555-0182' },
    { _id: C, company: 'Cobalt Counters', email: 'c@cobalt.com' }
  ]);
  sheet = { headers: ['Name', 'Email', 'Phone1'], rows: [row('ACME STONE'), row('Bay Granite Works Inc', '', '206-555-0182'), row('Delta')], parse: {} };
});

describe('sps-connect', () => {
  it('previews without writing anything', async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, autoCount: 1, spsRows: 3 });
    expect(res.body.toCheck.map((t: Loose) => t.customerId).sort()).toEqual([String(B), String(C)].sort());
    expect(await keyOf(A)).toBeUndefined();
  });

  it('refuses without Import and Edit together, and without View', async () => {
    expect((await preview(IMPORT_ONLY)).status).toBe(403);
    expect((await apply({}, NO_VIEW)).status).toBe(403);
    expect(await keyOf(A)).toBeUndefined();
  });

  it('stops on an unreadable file and writes nothing', async () => {
    sheet.parse = { malformed: [{ position: 7 }] };
    const res = await apply({ connectAuto: 'true' });
    expect(res.status).toBe(422);
    expect(await keyOf(A)).toBeUndefined();
  });

  it('connects the exact matches only when asked, and the approved answers', async () => {
    await apply({});
    expect(await keyOf(A)).toBeUndefined();

    const res = await apply({ connectAuto: 'true', answers: { [B]: 'bay granite works inc', [C]: 'none' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: 2, notInSps: 1, failed: [] });
    expect(await keyOf(A)).toMatchObject({ key: 'acme stone', connectedBy: 'krish' });
    expect(await keyOf(B)).toMatchObject({ key: 'bay granite works inc', name: 'Bay Granite Works Inc' });
    expect(await keyOf(C)).toMatchObject({ reviewedAs: 'none' });
    expect((await preview()).body).toMatchObject({ connected: 2, notInSps: 1, toCheck: [] });
  });

  it('is safe to run twice and never overwrites a key', async () => {
    await apply({ connectAuto: 'true' });
    const again = await apply({ connectAuto: 'true', answers: { [A]: 'delta' } });
    expect(again.body.rejected).toHaveLength(1);
    expect(await keyOf(A)).toMatchObject({ key: 'acme stone' });
  });

  it('reports a name another customer took in the meantime, and still saves the rest', async () => {
    await Customer.collection.updateOne({ _id: C }, { $set: { 'sps.key': 'delta' } }); // taken after the plan would offer it
    const res = await apply({ connectAuto: 'true', answers: { [B]: 'delta' } });
    expect(res.status).toBe(200);
    expect(res.body.rejected.map((r: Loose) => r.customerId)).toEqual([String(B)]);
    expect(await keyOf(A)).toMatchObject({ key: 'acme stone' });
    expect(await keyOf(B)).toBeUndefined();
  });
});
