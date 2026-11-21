import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { receiptCategories, cardExpenses, cardExpenseHistory } from '../schema/cardsSuppliers.ts';
import { convertToSubcategories } from './subcategoryConvert.ts';

const hex = (n: number) => n.toString(16).padStart(24, '0');
let client: PGlite, db: Db;

const expense = (n: number, category: string | null, status: string, cents = 1000) => ({
  id: hex(100 + n), cardLabel: 'MARU92069', day: '2026-10-05', month: '2026-10', merchant: `Shop ${n}`, cents, status, category
});

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  await db.insert(receiptCategories).values([
    { id: hex(1), name: 'travel_lunch', label: 'Travel Lunch', order: 0 },
    { id: hex(2), name: 'customer_lunch', label: 'Customer Lunch', order: 1, needsCustomer: true, needsAttendees: true },
    { id: hex(3), name: 'fuel', label: 'Fuel', order: 2 },
    { id: hex(4), name: 'parking', label: 'Parking', order: 3 }
  ]);
  await db.insert(cardExpenses).values([
    expense(1, 'fuel', 'approved', 5000), expense(2, 'fuel', 'draft', 4000), expense(3, 'travel_lunch', 'waiting'),
    expense(4, 'customer_lunch', 'approved', 8000), expense(5, 'parking', 'approved'), expense(6, null, 'missing')
  ]);
  await db.insert(cardExpenseHistory).values({ expenseId: hex(101), position: 0, at: new Date(), by: 'Maruthi', action: 'added', changes: '' });
}, 60_000);
afterAll(async () => { await client?.close(); });

const catsByName = async () => Object.fromEntries((await db.select().from(receiptCategories)).map(c => [c.name, c]));
const expenseOf = async (n: number) => (await db.select().from(cardExpenses).where(eq(cardExpenses.id, hex(100 + n))))[0]!;

describe('moving the old categories onto Gas and Food', () => {
  it('a dry run counts what would move and writes nothing', async () => {
    const r = await convertToSubcategories(db, 'test', { preview: true });
    expect(r.created).toEqual(['Gas', 'Food']);
    expect(r.moves.map(m => [m.from, m.to, m.expenses, m.cents])).toEqual([
      ['Fuel', 'Gas · Car', 2, 9000], ['Travel Lunch', 'Food · Travel Lunch', 1, 1000], ['Customer Lunch', 'Food · Customer Lunch', 1, 8000]
    ]);
    expect(r.moves[0]!.byStatus).toEqual({ approved: 1, draft: 1 });
    expect(r.hidden).toEqual(['Fuel', 'Travel Lunch', 'Customer Lunch']);
    expect(Object.keys(await catsByName())).not.toContain('gas');
    expect((await expenseOf(1)).category).toBe('fuel');
  });

  it('creates Gas and Food, moves each expense with a history line, keeps its status, and hides the old ones', async () => {
    const r = await convertToSubcategories(db, 'Sub-categories setup', { preview: false });
    expect(r.moves.map(m => m.expenses)).toEqual([2, 1, 1]);
    const cats = await catsByName();
    expect((cats.gas!.subcategories as { name: string; isDefault: boolean }[]).map(s => [s.name, s.isDefault])).toEqual([['car', true], ['truck', false], ['van', false], ['forklift', false]]);
    expect((cats.food!.subcategories as { name: string; fields: { customer: boolean; attendees: boolean } }[]).map(s => [s.name, s.fields.customer, s.fields.attendees]))
      .toEqual([['travel_lunch', false, false], ['customer_lunch', true, false], ['office_team_lunch', false, false]]);
    expect([cats.fuel!.active, cats.travel_lunch!.active, cats.customer_lunch!.active, cats.parking!.active]).toEqual([false, false, false, true]);
    expect(await expenseOf(1)).toMatchObject({ category: 'gas', subcategory: 'car', status: 'approved' });
    expect(await expenseOf(2)).toMatchObject({ category: 'gas', subcategory: 'car', status: 'draft' });
    expect(await expenseOf(3)).toMatchObject({ category: 'food', subcategory: 'travel_lunch', status: 'waiting' });
    expect(await expenseOf(4)).toMatchObject({ category: 'food', subcategory: 'customer_lunch', status: 'approved' });
    // Untouched: another category, and one with no category yet.
    expect(await expenseOf(5)).toMatchObject({ category: 'parking', subcategory: '' });
    expect(await expenseOf(6)).toMatchObject({ category: null, subcategory: '' });
    const history = await db.select().from(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, hex(101)));
    expect(history.map(h => [h.position, h.action])).toEqual([[0, 'added'], [1, 'edited']]);
    expect(history.find(h => h.position === 1)!.changes).toMatch(/Fuel → Gas · Car/);
  });

  it('run again, it finds nothing left to do', async () => {
    const r = await convertToSubcategories(db, 'test', { preview: false });
    expect(r.created).toEqual([]);
    expect(r.addedTypes).toEqual([]);
    expect(r.moves.map(m => m.expenses)).toEqual([0, 0, 0]);
    expect(r.hidden).toEqual([]);
  });

  it('reuses a Gas the Admin screen already made, adding only the types it lacks', async () => {
    await db.update(receiptCategories).set({ subcategories: [{ name: 'car', label: 'Car', active: true, isDefault: true, fields: { customer: false, attendees: false, purpose: false, recurring: false } }] }).where(eq(receiptCategories.name, 'gas'));
    const r = await convertToSubcategories(db, 'test', { preview: false });
    expect(r.created).toEqual([]);
    expect(r.addedTypes).toEqual(['Gas · Truck', 'Gas · Van', 'Gas · Forklift']);
    const [gas] = await db.select().from(receiptCategories).where(eq(receiptCategories.name, 'gas'));
    expect((gas!.subcategories as { name: string }[]).map(s => s.name)).toEqual(['car', 'truck', 'van', 'forklift']);
  });
});

describe('when Fuel was already renamed Gas in Admin', () => {
  let c2: PGlite, d2: Db;
  beforeAll(async () => {
    c2 = new PGlite();
    d2 = drizzle(c2, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(d2, 'pglite:memory');
    await d2.insert(receiptCategories).values([
      { id: hex(1), name: 'travel_lunch', label: 'Travel Lunch', order: 0 },
      { id: hex(2), name: 'customer_lunch', label: 'Customer Lunch', order: 1, needsCustomer: true },
      { id: hex(3), name: 'fuel', label: 'Gas', order: 2 }
    ]);
    await d2.insert(cardExpenses).values([expense(1, 'fuel', 'approved', 5000), expense(2, 'travel_lunch', 'waiting', 1992)]);
  }, 60_000);
  afterAll(async () => { await c2?.close(); });

  it('uses that category instead of making a second Gas, and only sets the type on what is in it', async () => {
    const dry = await convertToSubcategories(d2, 'test', { preview: true });
    expect(dry.created).toEqual(['Food']);
    expect(dry.moves.map(m => [m.from, m.to, m.expenses])).toEqual([['Gas', 'Gas · Car (type only)', 1], ['Travel Lunch', 'Food · Travel Lunch', 1], ['Customer Lunch', 'Food · Customer Lunch', 0]]);
    expect(dry.hidden).toEqual(['Travel Lunch', 'Customer Lunch']);

    await convertToSubcategories(d2, 'test', { preview: false });
    const cats = await d2.select().from(receiptCategories);
    expect(cats.map(c => c.name).sort()).toEqual(['customer_lunch', 'food', 'fuel', 'travel_lunch']);
    const gas = cats.find(c => c.name === 'fuel')!;
    expect([gas.label, gas.active, (gas.subcategories as { name: string }[]).map(s => s.name)]).toEqual(['Gas', true, ['car', 'truck', 'van', 'forklift']]);
    const [one] = await d2.select().from(cardExpenses).where(eq(cardExpenses.id, hex(101)));
    expect(one).toMatchObject({ category: 'fuel', subcategory: 'car', status: 'approved' });
    const [two] = await d2.select().from(cardExpenses).where(eq(cardExpenses.id, hex(102)));
    expect(two).toMatchObject({ category: 'food', subcategory: 'travel_lunch', status: 'waiting' });
    const history = await d2.select().from(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, hex(101)));
    expect(history.map(h => h.changes)).toEqual(['type set to Car (sub-categories set up)']);
    // Run again: nothing left.
    const again = await convertToSubcategories(d2, 'test', { preview: false });
    expect(again.created).toEqual([]);
    expect(again.moves.map(m => m.expenses)).toEqual([0, 0, 0]);
  });
});
