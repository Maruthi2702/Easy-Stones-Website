import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { asc } from 'drizzle-orm';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { receiptCategories } from '../schema/cardsSuppliers.ts';
import { addCategories, ACCOUNTING_CATEGORIES } from './addCategories.ts';

const hex = (n: number) => n.toString(16).padStart(24, '0');
let client: PGlite, db: Db;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  await db.insert(receiptCategories).values([
    { id: hex(1), name: 'gas', label: 'Gas', order: 0 },
    { id: hex(2), name: 'insurance', label: 'insurance', order: 1 }
  ]);
}, 60_000);
afterAll(async () => { await client?.close(); });

describe('accounting’s category list', () => {
  it('has 30 names with no repeats', () => {
    expect(ACCOUNTING_CATEGORIES).toHaveLength(30);
    expect(new Set(ACCOUNTING_CATEGORIES.map(l => l.toLowerCase())).size).toBe(30);
  });

  it('a dry run lists what it would add and writes nothing', async () => {
    const r = await addCategories(db, ACCOUNTING_CATEGORIES, 'test', { preview: true });
    expect(r.added).toHaveLength(29);
    expect(r.skipped).toEqual(['Insurance']);
    expect(await db.select().from(receiptCategories)).toHaveLength(2);
  });

  it('adds them exactly as written, after the ones already there, shown, asking for nothing extra', async () => {
    await addCategories(db, ACCOUNTING_CATEGORIES, 'Categories setup', { preview: false });
    const rows = await db.select().from(receiptCategories).orderBy(asc(receiptCategories.order));
    expect(rows).toHaveLength(31);
    expect(rows.slice(0, 2).map(r => r.label)).toEqual(['Gas', 'insurance']);
    expect(rows[2]).toMatchObject({ label: 'Automobile Insurance', name: 'automobile_insurance', order: 2, active: true, needsCustomer: false, subcategories: [] });
    expect(rows.map(r => r.label)).toContain('Computer And Network and Software Expenses');
    expect(rows.find(r => r.label === 'Rent-Others')!.name).toBe('rent_others');
    expect(new Set(rows.map(r => r.name)).size).toBe(31);
  });

  it('run again, it adds nothing', async () => {
    const r = await addCategories(db, ACCOUNTING_CATEGORIES, 'test', { preview: false });
    expect(r.added).toEqual([]);
    expect(r.skipped).toHaveLength(30);
  });
});
