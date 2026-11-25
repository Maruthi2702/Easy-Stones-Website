import type { Loose } from '../types/records.ts';
// Sales goals API on an in-memory Postgres: a rep gets only their own row, a team-goals switch sees
// the team, only Set goals writes (and only for the team), and what is saved comes back.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const world = vi.hoisted(() => ({ team: new Set<string>(), staff: [] as Loose[] }));
vi.mock('../services/teamDirectory.ts', () => ({ teamOfRequest: async () => world.team }));
vi.mock('../db/staff/index.ts', () => ({ findUsers: async () => world.staff }));
import express from 'express';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema/index.ts';
import { migrateDb } from '../db/client.ts';
import { useAppDbForTests } from '../db/appDb.ts';
import type { Db } from '../db/copy/plan.ts';
import { createCustomer } from '../db/customers/writes/core.postgres.ts';
import { readSalesSheet } from '../utils/customerSales.ts';
import { replaceYear } from '../db/customerSales/index.ts';
import createSalesGoalsRouter from './salesGoals.ts';

const MARIA = '0000000000000000000000a1', DANIEL = '0000000000000000000000a2', OUTSIDER = '0000000000000000000000a3', DRIVER = '0000000000000000000000a4', DIRECTOR = '0000000000000000000000d1';
const as = (id: string, permissions: string[]) => ({ 'x-test-user': JSON.stringify({ id, username: `u${id.slice(-2)}`, permissions }) });
const twelve = (v: unknown) => Array(12).fill(v);

const HEAD = ['Customer', 'Code', 'Customer Route', 'Primary Sales Person', 'Secondary Sales Person',
  'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26', 'Total', '12 Months Avg.'];
const line = (name: string, m: Record<number, number>, rep = 'x') => [name, null, null, rep, null, ...Array.from({ length: 12 }, (_, i) => m[i] ?? null), 0, 0];

let client: PGlite;
let app: express.Express;

beforeAll(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  useAppDbForTests(db);
  await db.insert(schema.locations).values({ id: '000000000000000000000001', name: 'Seattle' });
  await db.insert(schema.roles).values({ id: 'ab'.repeat(12), name: 'sales_rep', displayName: 'Sales Representative' } as never);
  await db.insert(schema.users).values([
    { id: MARIA, username: 'maria', passwordHash: 'x', role: 'sales_rep' }, { id: DANIEL, username: 'daniel', passwordHash: 'x', role: 'sales_rep' }
  ] as never);
  const make = (id: string, company: string, rep: string) => createCustomer(db, {
    id, fields: { company, contactName: 'T', email: `${id}@x.test`, location: 'Seattle' }, rep: { salesRep: rep, salesRepName: '' }, geo: {}, createdBy: null
  } as never);
  await make('0000000000000000000000c1', 'Maria Stone', MARIA);
  await make('0000000000000000000000c2', 'Daniel Stone', DANIEL);
  // The report credits Maria for 8,420 — one of it on a customer Daniel owns in the app today — and Daniel for 4,000;
  // "Pat Nobody" matches no staff member.
  const sheet = readSalesSheet([HEAD, line('Maria Stone', { 10: 7420 }, 'Maria R'), line('Daniel Stone', { 10: 1000 }, 'maria r'), line('Dan Co', { 10: 4000 }, 'Daniel K'), line('Lost Co', { 10: 300 }, 'Pat Nobody')]);
  await replaceYear({ year: 2026, entries: sheet.entries, totalCents: sheet.totalCents, fileName: '', exportedOn: '', by: 'k', links: {} }, db);

  world.team = new Set([MARIA, DANIEL, DIRECTOR]);
  world.staff = [
    { _id: MARIA, username: 'maria', displayName: 'Maria R', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'], isActive: true },
    { _id: DANIEL, username: 'daniel', displayName: 'Daniel K', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'], isActive: true },
    { _id: OUTSIDER, username: 'out', displayName: 'Out Sider', role: 'sales_rep', location: 'Spokane', assignedLocations: ['Spokane'], isActive: true },
    { _id: DRIVER, username: 'drv', displayName: 'Dee Driver', role: 'driver', location: 'Seattle', assignedLocations: ['Seattle'], isActive: true },
    { _id: DIRECTOR, username: 'dir', displayName: 'Dir Ector', role: 'director', location: 'Seattle', assignedLocations: ['Seattle'], isActive: true }
  ];
  app = express();
  app.use(express.json());
  app.use('/api/sales-goals', createSalesGoalsRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); req.userId = req.user.id; next(); },
    requireSalesPage: (_req: Loose, _res: Loose, next: () => void) => next()
  }));
}, 120_000);
afterAll(async () => { useAppDbForTests(null); await client?.close(); });

const get = (headers: Record<string, string>, year = 2026) => request(app).get(`/api/sales-goals?year=${year}`).set(headers);
const put = (headers: Record<string, string>, id: string, months: unknown, year = 2026) => request(app).put(`/api/sales-goals/${id}?year=${year}`).set(headers).send({ months });

describe('GET /api/sales-goals', () => {
  it('gives a rep only their own row, with their sales — never a teammate', async () => {
    const res = await get(as(MARIA, ['view_dashboard'])).expect(200);
    expect(res.body.people.map((p: Loose) => p.id)).toEqual([MARIA]);
    expect(res.body.people[0]).toMatchObject({ you: true, name: 'Maria R', branch: 'Seattle' });
    expect(res.body.people[0].salesCents[10]).toBe(842_000);
    expect(res.body).toMatchObject({ year: 2026, canSet: false, canViewTeam: false });
    expect(JSON.stringify(res.body)).not.toContain(DANIEL);
  });
  it('a team-goals switch sees the team (reps only, nobody outside it)', async () => {
    const res = await get(as(DIRECTOR, ['view_team_goals'])).expect(200);
    expect(res.body.people.map((p: Loose) => p.id).sort()).toEqual([DANIEL, DIRECTOR, MARIA].sort());
    expect(res.body.canViewTeam).toBe(true);
    expect(res.body.canSet).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(OUTSIDER);
    expect(JSON.stringify(res.body)).not.toContain(DRIVER);
  });
  it('counts sales by the report\'s sales person, and lists the names that match no staff — only to someone who sets goals', async () => {
    const mine = await get(as(MARIA, ['view_dashboard'])).expect(200);
    expect(mine.body.people[0].salesCents[10]).toBe(842_000);        // 7,420 + 1,000 on a customer Daniel owns today
    expect(mine.body.unmatchedReps).toEqual([]);
    expect((await get(as(DIRECTOR, ['view_team_goals']))).body.unmatchedReps).toEqual([]);
    const dir = await get(as(DIRECTOR, ['set_sales_goals'])).expect(200);
    expect(dir.body.people.find((p: Loose) => p.id === DANIEL).salesCents[10]).toBe(400_000);
    expect(dir.body.unmatchedReps).toEqual([{ name: 'Pat Nobody', salesCents: 30_000 }]);
  });
  it('refuses a silly year', async () => {
    await get(as(MARIA, []), 1999).expect(400);
    await request(app).get('/api/sales-goals?year=abc').set(as(MARIA, [])).expect(400);
  });
});

describe('PUT /api/sales-goals/:userId', () => {
  it('only Set goals writes', async () => {
    await put(as(MARIA, ['view_dashboard']), MARIA, twelve(100)).expect(403);
    await put(as(DIRECTOR, ['view_team_goals']), MARIA, twelve(100)).expect(403);
  });
  it('sets a team member\'s year, which then shows for them and for the director', async () => {
    const res = await put(as(DIRECTOR, ['set_sales_goals']), MARIA, [70000, 70000, 80000, 85000, 90000, 90000, 80000, 85000, 95000, 95000, 90000, 70000]).expect(200);
    expect(res.body.person).toMatchObject({ id: MARIA, you: false });
    expect(res.body.person.goalCents.slice(0, 3)).toEqual([7_000_000, 7_000_000, 8_000_000]);
    const mine = await get(as(MARIA, ['view_dashboard'])).expect(200);
    expect(mine.body.people[0].goalCents[10]).toBe(9_000_000);
    const theirs = await get(as(DIRECTOR, ['set_sales_goals'])).expect(200);
    expect(theirs.body.people.find((p: Loose) => p.id === MARIA).goalCents[11]).toBe(7_000_000);
    // a blank month is no goal
    await put(as(DIRECTOR, ['set_sales_goals']), MARIA, [1000, ...twelve(null).slice(1)]).expect(200);
    expect((await get(as(MARIA, [])).expect(200)).body.people[0].goalCents).toEqual([100_000, ...twelve(null).slice(1)]);
  });
  it('refuses someone outside the team, a non-rep, a bad id and bad months', async () => {
    const dir = as(DIRECTOR, ['set_sales_goals']);
    await put(dir, OUTSIDER, twelve(100)).expect(403);
    await put(dir, DRIVER, twelve(100)).expect(403);
    await put(dir, 'nope', twelve(100)).expect(404);
    await put(dir, MARIA, [1, 2]).expect(400);
    await put(dir, MARIA, twelve(-5)).expect(400);
    await put(dir, MARIA, twelve('abc')).expect(400);
  });
});

describe('the rep file: "Sales by Primary Sales Rep - Monthly"', () => {
  const REP_HEAD = ['Sales Person', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26', 'Total'];
  const rep = (name: string, nov: number) => [name, ...Array(10).fill(''), nov, '', nov];
  const rows = [REP_HEAD, ['', ...Array(10).fill(''), 5, '', 5], rep('Maria R', 500.5), rep('daniel k', 100), rep('Pat Nobody', 7), rep('Ex Employee', -20)];
  const post = (headers: Record<string, string>, path: string, body: unknown) => request(app).post(`/api/sales-goals/sales/${path}`).set(headers).send(body as object);
  const dir = as(DIRECTOR, ['set_sales_goals']);

  it('needs Set goals, and refuses what it can\'t trust', async () => {
    await post(as(MARIA, ['view_dashboard']), 'preview', { rows }).expect(403);
    await post(as(DIRECTOR, ['view_team_goals']), 'import', { rows }).expect(403);
    await post(dir, 'preview', { rows: [['Customer'], ['x']] }).expect(400);
    await post(dir, 'preview', {}).expect(400);
  });

  it('previews without writing: who matches staff by name, who matches nobody, and what the nameless row held', async () => {
    const res = await post(dir, 'preview', { rows }).expect(200);
    expect(res.body).toMatchObject({ year: 2026, reps: 4, totalCents: 59_250, noRepCents: 500, earlier: null });
    expect(res.body.matched.map((m: Loose) => [m.name, m.userName])).toEqual([['Maria R', 'Maria R'], ['daniel k', 'Daniel K']]);
    expect(res.body.unmatched.map((u: Loose) => u.name)).toEqual(['Ex Employee', 'Pat Nobody']);   // biggest first, by size either way
    // nothing was written: the GET still uses the per-customer report
    expect((await get(as(MARIA, [])).expect(200)).body.people[0].salesCents[10]).toBe(842_000);
  });

  it('imports the year: the figures replace the per-customer report\'s, a name a person linked counts for that person, the rest is listed', async () => {
    const res = await post(dir, 'import', { rows, fileName: 'rep.xlsx', exportedOn: '2026-11-25', links: { 'pat nobody': MARIA, 'ex employee': 'not-an-id', 'ghost': MARIA } }).expect(200);
    expect(res.body).toMatchObject({ year: 2026, reps: 4, linked: 1, matched: 3 });
    expect(res.body.unmatched).toEqual([{ name: 'Ex Employee', cents: -2000 }]);
    // Maria: her own line (500.50) plus Pat Nobody's (7), linked to her
    const mine = await get(as(MARIA, [])).expect(200);
    expect(mine.body.people[0].salesCents[10]).toBe(50_050 + 700);
    expect(mine.body.unmatchedReps).toEqual([]);
    const all = await get(dir).expect(200);
    expect(all.body.people.find((p: Loose) => p.id === DANIEL).salesCents[10]).toBe(10_000);
    expect(all.body.unmatchedReps).toEqual([{ name: 'Ex Employee', salesCents: -2000 }]);
    // the link is remembered: a preview of the same file now has Pat Nobody matched
    const again = await post(dir, 'preview', { rows }).expect(200);
    expect(again.body.matched.map((m: Loose) => m.name)).toContain('Pat Nobody');
    expect(again.body.earlier).toMatchObject({ reps: 4 });
  });

  it('importing again replaces the year', async () => {
    await post(dir, 'import', { rows: [REP_HEAD, rep('Maria R', 1)], fileName: 'again.xlsx', links: {} }).expect(200);
    const mine = await get(as(MARIA, [])).expect(200);
    expect(mine.body.people[0].salesCents[10]).toBe(100);
    expect((await get(dir).expect(200)).body.people.find((p: Loose) => p.id === DANIEL).salesCents[10]).toBeNull();
  });
});
