import type { Loose } from '../types/records.ts';
// Project leads API against an in-memory Postgres: every route checks its own switch, an uploaded
// ConstructConnect workbook becomes projects (read in a worker thread), a re-import keeps what staff
// added, and bad filters / files are refused with a message.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as XLSX from 'xlsx';
import * as schema from '../db/schema/index.ts';
import { migrateDb } from '../db/client.ts';
import { useAppDbForTests } from '../db/appDb.ts';
import type { Db } from '../db/copy/plan.ts';
import createProjectLeadsRouter, { filterOf } from './projectLeads.ts';

const ALL = ['view_project_leads', 'edit_project_leads', 'import_project_leads', 'export_project_leads'];
const as = (permissions: string[], name = 'Krish') => ({ 'x-test-user': JSON.stringify({ name, permissions }) });

const header = ['Project Id', 'Project Title', 'Project Value', 'Project Stage', 'Project Subcategory', 'Project Bid Date', 'Project List Date', 'Project Last Updated',
  'Project Street Address', 'Project City', 'Project County', 'Project State/Province', 'Project Postal Code', 'Company Id', 'Company Name', 'Company Classification/Role',
  'Company Contact First Name', 'Company Contact Last Name', 'Company Phone Number', 'Company Email'];
const line = (id: string, title: string, state: string, company: string, role: string, phone = '2065551234') => [
  id, title, 5000000, 'POST BID - Post Bid', 'Apartments', '', '1/2/2026 5:00:00 AM', '6/1/2026 5:00:00 AM', '1 Main St', 'Seattle', 'King', state, '98101',
  '77', company, role, 'Ann', 'Lee', phone, 'ann@acme.test'];
const workbook = (rows: unknown[][], sheet = 'Design Team') => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), sheet);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

let client: PGlite;
let app: express.Express;

beforeAll(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  useAppDbForTests(db);
  app = express();
  app.use(express.json());
  app.use('/api/project-leads', createProjectLeadsRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
  }));
}, 120_000);
afterAll(async () => { useAppDbForTests(null); await client?.close(); });

describe('filterOf', () => {
  it('reads the filters and refuses what it can’t', () => {
    expect(filterOf({ q: ' lofts ', states: 'Texas, Oregon', status: 'samples', minValue: '1000000', updatedFrom: '2026-01-01', reachable: '1', sort: 'value_desc' }))
      .toEqual({ q: 'lofts', states: ['Texas', 'Oregon'], status: 'samples', minValue: 1000000, updatedFrom: '2026-01-01', reachable: true, sort: 'value_desc' });
    expect(() => filterOf({ status: 'nope' })).toThrow(/status/);
    expect(() => filterOf({ updatedFrom: 'yesterday' })).toThrow(/YYYY-MM-DD/);
    expect(() => filterOf({ minValue: '-5' })).toThrow(/Minimum/);
    expect(() => filterOf({ sort: 'random' })).toThrow(/sort/);
  });
});

describe('project leads API', () => {
  it('refuses every route without its own switch', async () => {
    const view = as(['view_project_leads']);
    expect((await request(app).get('/api/project-leads/meta').set(as([]))).status).toBe(403);
    expect((await request(app).get('/api/project-leads').set(as(['edit_project_leads']))).status).toBe(403);   // edit alone isn't view
    expect((await request(app).get('/api/project-leads/export').set(view)).status).toBe(403);
    expect((await request(app).patch('/api/project-leads/1').set(view).send({ status: 'contacted' })).status).toBe(403);
    expect((await request(app).post('/api/project-leads/import').set(view)).status).toBe(403);
    const meta = await request(app).get('/api/project-leads/meta').set(view);
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({ canEdit: false, canImport: false, canExport: false, total: 0 });
  });

  it('imports an uploaded workbook, then lists, filters and shows a project', async () => {
    const file = workbook([
      line('1001', 'Seattle Lofts', 'Washington', 'Acme Owners', 'Owner'),
      line('1001', 'Seattle Lofts', 'Washington', 'Studio Arch', 'Architect', ''),
      line('1002', 'Portland Court', 'Oregon', 'Builder Bob', 'Awarded - General Contractor - Bidder')
    ]);
    const up = await request(app).post('/api/project-leads/import').set(as(ALL)).attach('file', file, 'cc.xlsx');
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ projects: 2, companies: 3, added: 2, updated: 0 });

    const list = await request(app).get('/api/project-leads').set(as(ALL)).query({ states: 'Oregon' });
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ id: '1002', title: 'Portland Court', status: 'new' });
    expect(list.body.items[0].companies[0]).toMatchObject({ name: 'Builder Bob', group: 'contractor', phone: '2065551234' });

    const one = await request(app).get('/api/project-leads/1001').set(as(ALL));
    expect(one.body.companies.map((c: Loose) => c.name)).toEqual(['Acme Owners', 'Studio Arch']);
    expect((await request(app).get('/api/project-leads/9999').set(as(ALL))).status).toBe(404);
    expect((await request(app).get('/api/project-leads').set(as(ALL)).query({ status: 'bogus' })).status).toBe(400);
    const meta = await request(app).get('/api/project-leads/meta').set(as(ALL));
    expect(meta.body).toMatchObject({ total: 2, canEdit: true, canImport: true, canExport: true });
    expect(meta.body.lastImport).toMatchObject({ fileName: 'cc.xlsx', added: 2 });
  });

  it('saves a status, note and assignee, and a re-import leaves them alone', async () => {
    const saved = await request(app).patch('/api/project-leads/1001').set(as(ALL, 'Sam')).send({ status: 'samples', note: ' Sent a binder ', assignedTo: 'Sam' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ status: 'samples', note: 'Sent a binder', assignedTo: 'Sam', statusBy: 'Sam' });
    expect(saved.body.history).toHaveLength(1);
    expect((await request(app).patch('/api/project-leads/1001').set(as(ALL)).send({ status: 'bogus' })).status).toBe(400);
    expect((await request(app).patch('/api/project-leads/1001').set(as(ALL)).send({ note: 5 })).status).toBe(400);
    expect((await request(app).patch('/api/project-leads/9999').set(as(ALL)).send({ status: 'new' })).status).toBe(404);

    const again = await request(app).post('/api/project-leads/import').set(as(ALL))
      .attach('file', workbook([line('1001', 'Seattle Lofts II', 'Washington', 'Acme Owners', 'Owner')]), 'cc2.xlsx');
    expect(again.body).toMatchObject({ projects: 1, added: 0, updated: 1 });
    const one = await request(app).get('/api/project-leads/1001').set(as(ALL));
    expect(one.body).toMatchObject({ title: 'Seattle Lofts II', status: 'samples', note: 'Sent a binder', assignedTo: 'Sam' });
    expect(one.body.companies).toHaveLength(1);

    const counts = await request(app).get('/api/project-leads').set(as(ALL)).query({ assignedTo: 'Sam' });
    expect(counts.body).toMatchObject({ total: 1, counts: { samples: 1 } });
  });

  it('refuses a missing file, a file that is not the export, and one that is not a workbook', async () => {
    expect((await request(app).post('/api/project-leads/import').set(as(ALL))).body.message).toMatch(/Choose the ConstructConnect/);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name'], ['x']]), 'Sheet1');
    const wrong = await request(app).post('/api/project-leads/import').set(as(ALL)).attach('file', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'x.xlsx');
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/isn't the ConstructConnect export/);
    const junk = await request(app).post('/api/project-leads/import').set(as(ALL)).attach('file', Buffer.from('not a workbook'), 'x.xlsx');
    expect(junk.status).toBe(400);
  });

  it('exports with the export switch', async () => {
    const out = await request(app).get('/api/project-leads/export').set(as(ALL));
    expect(out.status).toBe(200);
    expect(out.body.total).toBe(2);
  });
});
