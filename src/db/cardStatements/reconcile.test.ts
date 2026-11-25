/** Reconciling the statement lines with their expenses, on an in-memory Postgres. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { cardStatementLines as lines } from '../schema/cardStatements.ts';
import { cardExpenses, companyCards } from '../schema/cardsSuppliers.ts';
import { reconcile } from './reconcile.ts';

const hex = (n: number) => n.toString(16).padStart(24, '0');
const A = hex(10), B = hex(11);
let client: PGlite, db: Db;

const expense = (n: number, day: string, cents: number, over: Record<string, unknown> = {}) => ({
  id: hex(n), cardId: A, cardLabel: 'MARU92069', holderName: 'Krish', day, month: day.slice(0, 7), merchant: 'X', cents, status: 'waiting', ...over
});
const line = (reference: string, day: string, cents: number, expenseId: string | null, over: Record<string, unknown> = {}) => ({
  reference, issuer: 'amex', day, digits: '92069', cents, kind: 'charge', firstImportId: 'imp', lastImportId: 'imp', expenseId, cardId: A, ...over
});

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  await db.insert(companyCards).values([
    { id: A, label: 'MARU92069', issuer: 'amex', lastDigits: '92069' }, { id: B, label: 'VISH92465', issuer: 'amex', lastDigits: '92465' }
  ]);
});
afterEach(async () => { await client.close(); });

describe('reconcile', () => {
  it('totals charges per day and per card, and finds no bad link when every match fits', async () => {
    await db.insert(cardExpenses).values([expense(1, '2026-11-05', 1000), expense(2, '2026-11-06', 2000)]);
    await db.insert(lines).values([
      line('a', '2026-11-05', 1000, hex(1)), line('b', '2026-11-07', 2000, hex(2)),  // 1 day apart: fine
      line('c', '2026-11-05', 500, null), line('d', '2026-11-05', -300, null, { kind: 'credit' })
    ]);
    const r = await reconcile(db);
    expect(r.totals).toEqual({ lines: 4, charges: 3, chargeCents: 3500, credits: 1 });
    expect(r.byDay).toEqual([{ day: '2026-11-05', charges: 2, cents: 1500 }, { day: '2026-11-07', charges: 1, cents: 2000 }]);
    expect(r.byCard).toEqual([{ digits: '92069', charges: 3, cents: 3500 }]);
    expect(r.noExpense).toBe(1);
    expect(r.badLinks).toEqual([]);
  });

  it('lists a line whose expense has another amount, is too far away, is voided or is another person\'s card', async () => {
    await db.insert(cardExpenses).values([
      expense(1, '2026-11-05', 999), expense(2, '2026-11-20', 2000), expense(3, '2026-11-05', 3000, { voidedAt: new Date() }),
      expense(4, '2026-11-05', 4000, { cardId: B, cardLabel: 'VISH92465' })
    ]);
    await db.insert(lines).values([
      line('amount', '2026-11-05', 1000, hex(1)), line('far', '2026-11-05', 2000, hex(2)), line('void', '2026-11-05', 3000, hex(3)), line('card', '2026-11-05', 4000, hex(4))
    ]);
    const r = await reconcile(db);
    expect(Object.fromEntries(r.badLinks.map(b => [b.reference, b.why]))).toEqual({
      amount: 'amount differs', far: 'days apart > 2', void: 'expense is voided', card: 'different card and holder'
    });
  });

  it('does not mix in the other bank', async () => {
    await db.insert(lines).values([line('x', '2026-11-05', 1000, null, { issuer: 'encore' })]);
    expect((await reconcile(db)).totals.lines).toBe(0);
    expect((await reconcile(db, { issuer: 'encore' })).totals.lines).toBe(1);
  });
});
