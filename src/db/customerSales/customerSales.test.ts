import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { createCustomer } from '../customers/writes/core.postgres.ts';
import { readSalesSheet, salesSummary } from '../../utils/customerSales.ts';
import { salesForCustomer, replaceYear } from './index.ts';

const HEAD = ['Customer', 'Code', 'Customer Route', 'Primary Sales Person', 'Secondary Sales Person',
  'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26', 'Total', '12 Months Avg.'];
const row = (name: string, m: Record<number, number>, rep = 'Krish') =>
  [name, null, null, rep, null, ...Array.from({ length: 12 }, (_, i) => m[i] ?? null), 0, 0];
const SHEET = [HEAD, row('360 COUNTERS LLC', { 0: 3001.32, 2: 3301.15 }), row('Nobody Stone', { 9: 100 }),
  [null, null, null, null, null, 3001.32, ...Array(11).fill(0), 0, 0]];

describe('readSalesSheet', () => {
  it('reads customers in cents, skips the totals row, finds the year', () => {
    const s = readSalesSheet(SHEET);
    expect(s.problems).toEqual([]);
    expect(s.year).toBe(2026);
    expect(s.entries).toHaveLength(2);
    expect(s.entries[0].cents.slice(0, 4)).toEqual([300132, null, 330115, null]);
    expect(s.totalCents).toBe(300132 + 330115 + 10000);
  });
  it('refuses a file that is not the report, a missing month, a repeated name and a non-number', () => {
    expect(readSalesSheet([['Name'], ['x']]).problems[0]).toMatch(/Customer/);
    expect(readSalesSheet([HEAD.filter(h => h !== 'Mar 26'), ['A']]).problems[0]).toMatch(/Mar/);
    expect(readSalesSheet([...SHEET, row('360 counters llc', {})]).problems[0]).toMatch(/appears on rows/);
    expect(readSalesSheet([HEAD, row('A', { 0: 'abc' as unknown as number })]).problems[0]).toMatch(/isn't a number/);
  });
  it('summarises a year', () => {
    expect(salesSummary([100, null, 300, ...Array(9).fill(null)])).toEqual({ total: 400, monthsWithSales: 2, bestMonth: 2, average: 200 });
  });
});

describe('the data layer', () => {
  let client: PGlite, db: Db;
  const cust = '0000000000000000000000c1', other = '0000000000000000000000c2';
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
    await db.insert(schema.locations).values({ id: '000000000000000000000001', name: 'Seattle' });
    const make = (id: string, company: string) => createCustomer(db, { id, fields: { company, contactName: 'T', email: `${id}@x.test`, location: 'Seattle' },
      rep: { salesRep: null, salesRepName: '' }, geo: {}, createdBy: null } as never);
    await make(cust, '360 Counters LLC');
    await make(other, 'Other Co');
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('imports a year, matches by name, lists the unmatched, and replaces on a re-import', async () => {
    const s = readSalesSheet(SHEET);
    const done = await replaceYear({ year: 2026, entries: s.entries, totalCents: s.totalCents, fileName: 'f.xlsx', exportedOn: 'x', by: 'krish' }, db);
    expect(done).toMatchObject({ customers: 2, rows: 3, matched: 1, unmatched: ['Nobody Stone'] });
    const mine = await salesForCustomer(cust, 2026, db);
    expect(mine?.matched).toBe(true);
    expect(mine?.cents.slice(0, 3)).toEqual([300132, null, 330115]);
    expect(mine?.primaryRep).toBe('Krish');
    expect((await salesForCustomer(other, 2026, db))?.matched).toBe(false);
    expect(await salesForCustomer('0000000000000000000000ff', 2026, db)).toBeUndefined();

    await replaceYear({ year: 2026, entries: readSalesSheet([HEAD, row('360 counters llc', { 5: 50 })]).entries, totalCents: 5000, fileName: '', exportedOn: '', by: '' }, db);
    const again = await salesForCustomer(cust, 2026, db);
    expect(again?.cents.filter(c => c != null)).toEqual([5000]);
    expect(again?.years).toEqual([2026]);
  });
});
