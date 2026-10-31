import type { Loose } from '../types/records.ts';
// The new SPS import's routes, against a throwaway in-memory MongoDB with a fake
// sheet reader: a bad file creates nothing, the plan always adds up, Start is
// refused until every deleted customer is answered and while another import
// runs, the extra switches are enforced by what the plan really holds, a run
// finishes with its check green, and Undo needs Delete.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createRouter } = await import('./customerSpsImport.ts');
const { default: Customer } = await import('../models/Customer.ts');
const { default: CustomerDeleteBackup } = await import('../models/CustomerDeleteBackup.ts');
const { default: SpsImportRun } = await import('../models/SpsImportRun.ts');
const { default: SpsImportItem } = await import('../models/SpsImportItem.ts');

let mongo; let app; let sheet; let remembered;
const BASE = '/api/customers/sps-import/runs';
const IMPORTER = { username: 'imp', permissions: ['view_customers', 'import_customers'] };
const FULL = { username: 'krish', permissions: ['view_customers', 'import_customers', 'manage_customers', 'add_customers', 'delete_customers'] };
const NO_IMPORT = { username: 'x', permissions: ['view_customers'] };
const as = (u: Loose) => ({ 'x-test-user': JSON.stringify(u) });
const FILE = Buffer.from('x');
const upload = (u = IMPORTER) => request(app).post(BASE).set(as(u)).attach('file', FILE, 'sps.xls');
const plan = (id: string, body: Loose = {}, u = IMPORTER) => request(app).post(`${BASE}/${id}/plan`).set(as(u)).send(body);
const start = (id: string, u = IMPORTER) => request(app).post(`${BASE}/${id}/start`).set(as(u));
const row = (Name: Loose, extra: Loose = {}) => ({ Name, 'Sales Person1': '', Email: '', ...extra });
const wait = async (id: string) => { for (let i = 0; i < 100; i++) { const r = await SpsImportRun.findById(id).lean(); if (r.status !== 'running') return r; await new Promise((s) => setTimeout(s, 30)); } throw new Error('run never finished'); };
const D = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Customer.syncIndexes();
  app = express();
  app.use(express.json());
  app.use('/api/customers', createRouter({
    authenticate: (req: Loose, res: Loose, next: Loose) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    uploadMemory: multer({ storage: multer.memoryStorage() }),
    readSheet: async () => sheet,
    resolveMapping: () => ({ company: 'Name', salesRep: 'Sales Person1', email: 'Email' }),
    buildReference: async () => ({
      reference: { branchByKey: new Map(), repByKey: new Map([['stevewatson', { salesRep: 'u1', salesRepName: 'Steve Watson' }]]) },
      repById: new Map([['u1', { salesRep: 'u1', salesRepName: 'Steve Watson' }]]), branches: ['Seattle']
    }),
    rememberAliases: async (a: Loose) => { remembered = a; },
    fields: ['company']
  }));
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  remembered = null;
  await Promise.all([Customer, CustomerDeleteBackup, SpsImportRun, SpsImportItem].map((m) => m.collection.deleteMany({})));
  await Customer.collection.insertOne({ company: 'Acme Stone', email: 'a@acme.com', sps: { key: 'acme stone' } });
  sheet = { headers: ['Name', 'Sales Person1', 'Email'], rows: [row('Acme Stone'), row('Zed Tile', { Email: 'z@zed.com' })], parse: {} };
});

describe('sps-import', () => {
  it('needs the Import switch', async () => {
    expect((await upload(NO_IMPORT)).status).toBe(403);
  });

  it('stops on an unreadable file and creates nothing', async () => {
    sheet.parse = { malformed: [{ position: 9 }] };
    const res = await upload();
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/Nothing has been imported/);
    expect(await SpsImportRun.countDocuments({})).toBe(0);
  });

  it('plans with a tally that adds up and shows every row', async () => {
    const { body } = await upload();
    const p = (await plan(body.run.id)).body;
    expect(p).toMatchObject({ adds: true, distinct: 2, counts: { new: 1, unchanged: 1 }, blockers: [] });
    expect(p.rows.new[0]).toMatchObject({ name: 'Zed Tile' });
    expect(p.rows.unchanged[0]).toMatchObject({ name: 'Acme Stone' });
    expect((await upload()).status).toBe(200);
    const cur = (await request(app).get(`${BASE}/current`).set(as(IMPORTER))).body;
    expect(cur.draft).toBeTruthy();
  });

  it('won’t start while a deleted customer is unanswered, and takes the answer', async () => {
    const raw = { _id: D, company: 'Gone Co', email: 'g@g.com' };
    await CustomerDeleteBackup.create({ batchId: 'b', customerId: D, customer: raw, source: 'bulk', deletedBy: 'Maria' });
    sheet.rows.push(row('Gone Co'));
    const { body } = await upload();
    const p = (await plan(body.run.id)).body;
    expect(p.counts.deleted).toBe(1);
    expect(p.rows.deleted[0].deleted.deletedBy).toBe('Maria');
    const refused = await start(body.run.id);
    expect(refused.status).toBe(422);
    expect(refused.body.blockers[0]).toMatch(/deleted/);

    await plan(body.run.id, { answers: { 'gone co': 'keep' } });
    const ok = await start(body.run.id);
    expect(ok.status).toBe(200);
    const run = await wait(body.run.id);
    expect(run.verify.ok).toBe(true);
    expect(run.results).toMatchObject({ added: 1, keptDeleted: 1 });
  });

  it('enforces Add for bringing a customer back, from what the plan holds', async () => {
    await CustomerDeleteBackup.create({ batchId: 'b', customerId: D, customer: { _id: D, company: 'Gone Co', email: 'g@g.com' }, source: 'bulk' });
    sheet.rows = [row('Gone Co')];
    const { body } = await upload();
    await plan(body.run.id, { answers: { 'gone co': 'restore' } });
    expect((await start(body.run.id, IMPORTER)).status).toBe(403);
    expect((await start(body.run.id, FULL)).status).toBe(200);
    expect((await wait(body.run.id)).results.restored).toBe(1);
  });

  it('refuses a second Start while one is running, naming who', async () => {
    await SpsImportRun.create({ status: 'running', createdBy: 'Maria', total: 4476, done: 2310 });
    const { body } = await upload();
    const res = await start(body.run.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Maria is importing right now \(2310 of 4476\)/);
  });

  it('runs to green, remembers the aliases, gives a report, and Undo needs Delete', async () => {
    const { body } = await upload();
    await plan(body.run.id, { repAliases: { 'Stephen Watson': 'u1' } });
    expect((await start(body.run.id)).status).toBe(200);
    expect(remembered).toMatchObject({ repAliases: { 'Stephen Watson': 'u1' } });
    const run = await wait(body.run.id);
    expect(run.verify).toMatchObject({ ok: true, expected: 2, present: 2 });
    expect(await Customer.countDocuments({ 'sps.key': 'zed tile' })).toBe(1);
    expect((await plan(body.run.id)).status).toBe(404);   // started: no more planning

    const csv = await request(app).get(`${BASE}/${body.run.id}/report.csv`).set(as(IMPORTER));
    expect(csv.text).toContain('Zed Tile,Added');
    const ids = (await request(app).get(`${BASE}/${body.run.id}/customers?outcome=added`).set(as(IMPORTER))).body.ids;
    expect(ids).toHaveLength(1);

    const added = (await request(app).get(`${BASE}/${body.run.id}/items?result=added`).set(as(IMPORTER))).body;
    expect(added.total).toBe(1);
    expect(added.items[0]).toMatchObject({ name: 'Zed Tile', result: 'added', added: { city: '' } });
    const all = (await request(app).get(`${BASE}/${body.run.id}/items?limit=1&page=2`).set(as(IMPORTER))).body;
    expect(all.total).toBe(2);
    expect(all.items).toHaveLength(1);
    expect((await request(app).get(`${BASE}/${body.run.id}/items?result=bogus`).set(as(IMPORTER))).status).toBe(400);
    expect((await request(app).get(`${BASE}/${body.run.id}/items`).set(as(NO_IMPORT))).status).toBe(403);

    expect((await request(app).post(`${BASE}/${body.run.id}/undo`).set(as(IMPORTER))).status).toBe(403);
    const undo = await request(app).post(`${BASE}/${body.run.id}/undo`).set(as(FULL));
    expect(undo.body).toMatchObject({ removed: 1 });
    expect(await Customer.countDocuments({ 'sps.key': 'zed tile' })).toBe(0);
  });

  it('a draft can be thrown away', async () => {
    const { body } = await upload();
    expect((await request(app).delete(`${BASE}/${body.run.id}`).set(as(IMPORTER))).status).toBe(200);
    expect(await SpsImportRun.countDocuments({})).toBe(0);
  });
});
