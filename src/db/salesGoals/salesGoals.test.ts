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
import { goalsFor, saveGoals, salesByRep, goalYears } from './index.ts';

const HEAD = ['Customer', 'Code', 'Customer Route', 'Primary Sales Person', 'Secondary Sales Person',
  'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26', 'Total', '12 Months Avg.'];
const row = (name: string, m: Record<number, number>) =>
  [name, null, null, 'x', null, ...Array.from({ length: 12 }, (_, i) => m[i] ?? null), 0, 0];

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

  it('adds a rep\'s sales up over the customers they own, matched by name, and skips unowned ones', async () => {
    const sheet = readSalesSheet([HEAD, row('360 COUNTERS LLC', { 0: 1000, 1: 500 }), row('Granite Top, Inc.', { 0: 250 }), row('Daniel Stone', { 10: 4000 }), row('Nobody Owns Me', { 0: 9999 }), row('Nobody Knows', { 0: 7 })]);
    expect(sheet.problems).toEqual([]);
    await replaceYear({ year: 2026, entries: sheet.entries, totalCents: sheet.totalCents, fileName: '', exportedOn: '', by: 'k', links: {} }, db);
    const sales = await salesByRep(2026, db);
    // "Granite Top, Inc." is not "Granite Top Inc" to the matcher, so only 360 Counters is Maria's here.
    expect(sales.get(maria)?.slice(0, 3)).toEqual([1000 * 100, 500 * 100, null]);
    expect(sales.get(daniel)?.[10]).toBe(400_000);
    expect([...sales.keys()].sort()).toEqual([maria, daniel].sort());
  });

  it('a link a person made counts that name for the linked customer\'s rep', async () => {
    const s26 = readSalesSheet([HEAD, row('Granite Top, Inc.', { 0: 250 })]);
    await replaceYear({ year: 2026, entries: s26.entries, totalCents: s26.totalCents, fileName: '', exportedOn: '', by: 'k', links: { [s26.entries[0].key]: c2 } }, db);
    expect((await salesByRep(2026, db)).get(maria)?.[0]).toBe(25_000);
  });

  it('years worth showing: this year, any year with a goal or an import, newest first', async () => {
    expect(await goalYears(2026, db)).toEqual([2027, 2026]);
    expect(await goalYears(2028, db)).toEqual([2028, 2027, 2026]);
  });
});
