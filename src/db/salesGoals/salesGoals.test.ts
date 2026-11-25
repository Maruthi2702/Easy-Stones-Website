// Sales goals' data layer on an in-memory Postgres: goals save and replace per person and year,
// and a rep's sales are the SPS report added up over the customers that rep owns.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { createCustomer } from '../customers/writes/core.postgres.ts';
import { readSalesSheet } from '../../utils/customerSales.ts';
import { replaceYear } from '../customerSales/index.ts';
import { goalsFor, saveGoals, salesByReportRep, goalYears, replaceRepYear, repLinks, lastRepImport } from './index.ts';

const HEAD = ['Customer', 'Code', 'Customer Route', 'Primary Sales Person', 'Secondary Sales Person',
  'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26', 'Total', '12 Months Avg.'];
const row = (name: string, m: Record<number, number>, rep = 'x') =>
  [name, null, null, rep, null, ...Array.from({ length: 12 }, (_, i) => m[i] ?? null), 0, 0];

describe('sales goals data layer', () => {
  let client: PGlite, db: Db;
  const maria = '0000000000000000000000a1', daniel = '0000000000000000000000a2';
  const c1 = '0000000000000000000000c1', c2 = '0000000000000000000000c2', c3 = '0000000000000000000000c3', c4 = '0000000000000000000000c4';
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
    await db.insert(schema.locations).values({ id: '000000000000000000000001', name: 'Seattle' });
    await db.insert(schema.roles).values({ id: 'ab'.repeat(12), name: 'sales_rep', displayName: 'Sales Representative' } as never);
    await db.insert(schema.users).values([
      { id: maria, username: 'maria', passwordHash: 'x', role: 'sales_rep' }, { id: daniel, username: 'daniel', passwordHash: 'x', role: 'sales_rep' }
    ] as never);
    const make = (id: string, company: string, rep: string | null) => createCustomer(db, {
      id, fields: { company, contactName: 'T', email: `${id}@x.test`, location: 'Seattle' },
      rep: { salesRep: rep, salesRepName: '' }, geo: {}, createdBy: null
    } as never);
    await make(c1, '360 Counters LLC', maria);
    await make(c2, 'Granite Top Inc', maria);
    await make(c3, 'Daniel Stone', daniel);
    await make(c4, 'Nobody Owns Me', null);
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('saves a year of goals, replaces it, and a blank month is no goal', async () => {
    await saveGoals({ userId: maria, year: 2026, cents: [7_000_000, null, 8_000_000, ...Array(9).fill(null)], by: 'dir' }, db);
    expect((await goalsFor(2026, [maria], db)).get(maria)).toEqual([7_000_000, null, 8_000_000, ...Array(9).fill(null)]);
    await saveGoals({ userId: maria, year: 2026, cents: [null, 5_000_000, ...Array(10).fill(null)], by: 'dir' }, db);
    expect((await goalsFor(2026, [maria], db)).get(maria)).toEqual([null, 5_000_000, ...Array(10).fill(null)]);
    // clearing every month leaves nothing, so the person drops out
    await saveGoals({ userId: maria, year: 2026, cents: Array(12).fill(null), by: 'dir' }, db);
    expect((await goalsFor(2026, [maria], db)).has(maria)).toBe(false);
  });

  it('keeps people and years apart, and asks only for who it is told to', async () => {
    await saveGoals({ userId: maria, year: 2026, cents: Array(12).fill(100), by: 'a' }, db);
    await saveGoals({ userId: daniel, year: 2026, cents: Array(12).fill(200), by: 'a' }, db);
    await saveGoals({ userId: maria, year: 2027, cents: Array(12).fill(300), by: 'a' }, db);
    expect([...(await goalsFor(2026, undefined, db)).keys()].sort()).toEqual([maria, daniel].sort());
    expect([...(await goalsFor(2026, [daniel], db)).keys()]).toEqual([daniel]);
    expect((await goalsFor(2026, [], db)).size).toBe(0);
    expect((await goalsFor(2027, [maria], db)).get(maria)?.[0]).toBe(300);
  });

  it('adds sales up by the report\'s Primary Sales Person on each row — not by who owns the customer today', async () => {
    const sheet = readSalesSheet([HEAD,
      row('360 COUNTERS LLC', { 0: 1000, 1: 500 }, 'Maria R'),      // Maria's customer in the app, Maria on the report
      row('Daniel Stone', { 10: 4000 }, 'Maria R'),                 // Daniel owns it in the app today, the report says Maria
      row('Granite Top, Inc.', { 0: 250 }, 'DANIEL K'),             // a name the app has never heard of still counts
      row('Nobody Owns Me', { 0: 9999 }, ''),                       // no sales person: counts for nobody
      row('Nobody Knows', { 0: 7 }, 'daniel k')]);                  // same person, other spelling: one bucket
    expect(sheet.problems).toEqual([]);
    await replaceYear({ year: 2026, entries: sheet.entries, totalCents: sheet.totalCents, fileName: '', exportedOn: '', by: 'k', links: {} }, db);
    const sales = await salesByReportRep(2026, db);
    expect([...sales.keys()].sort()).toEqual(['daniel k', 'maria r']);
    expect(sales.get('maria r')?.name).toBe('Maria R');
    expect(sales.get('maria r')?.months.slice(0, 3)).toEqual([100_000, 50_000, null]);
    expect(sales.get('maria r')?.months[10]).toBe(400_000);
    expect(sales.get('daniel k')?.months[0]).toBe(25_000 + 700);
  });

  it('the rep file becomes the source for its year, keeps links, and an import replaces the year', async () => {
    const entry = (name: string, key: string, nov: number | null) => ({ name, key, cents: [...Array(10).fill(null), nov, null] });
    const done = await replaceRepYear({
      year: 2026, entries: [entry('Maria R', 'maria r', 123_400), entry('Daniel K', 'daniel k', null)], totalCents: 123_400, noRepCents: 0,
      fileName: 'rep.xlsx', exportedOn: '2026-11-25', by: 'dir', links: { 'maria r': maria, 'nobody in the file': daniel }
    }, db);
    expect(done).toMatchObject({ reps: 2, rows: 1, linked: 1 });     // a link for a name not in the file is dropped
    const sales = await salesByReportRep(2026, db);
    expect([...sales.keys()]).toEqual(['maria r']);                  // only names with a figure; the customer report is no longer read
    expect(sales.get('maria r')?.months[10]).toBe(123_400);
    expect([...(await repLinks(db)).entries()]).toEqual([['maria r', maria]]);
    expect((await lastRepImport(2026, db))?.reps).toBe(2);
    await replaceRepYear({ year: 2026, entries: [entry('Daniel K', 'daniel k', 9)], totalCents: 9, noRepCents: 0, fileName: '', exportedOn: '', by: 'dir' }, db);
    expect([...(await salesByReportRep(2026, db)).keys()]).toEqual(['daniel k']);
    expect((await repLinks(db)).get('maria r')).toBe(maria);         // links outlive an import
    expect(await lastRepImport(2025, db)).toBeNull();
    expect(await salesByReportRep(2024, db)).toEqual(new Map());
  });

  it('years worth showing: this year, any year with a goal or an import, newest first', async () => {
    expect(await goalYears(2026, db)).toEqual([2027, 2026]);
    expect(await goalYears(2028, db)).toEqual([2028, 2027, 2026]);
  });
});
