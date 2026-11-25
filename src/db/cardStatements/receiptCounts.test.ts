/** The receipt counts for a day's Amex upload and for the Amex expenses, on an in-memory Postgres. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { cardStatementLines as lines, cardStatementImports as imports } from '../schema/cardStatements.ts';
import { cardExpenses, companyCards } from '../schema/cardsSuppliers.ts';
import { receiptCounts } from './receiptCounts.ts';

const hex = (n: number) => n.toString(16).padStart(24, '0');
const AMEX = hex(10), ENCORE = hex(11);
const AT = new Date('2026-11-25T18:00:00Z'); // 10:00 AM Pacific, Nov 25
let client: PGlite, db: Db;

const expense = (n: number, over: Record<string, unknown> = {}) => ({
  id: hex(n), cardId: AMEX, cardLabel: 'MARU92069', holderName: 'Krish', day: '2026-11-05', month: '2026-11', merchant: 'X', cents: 1000, status: 'waiting', ...over
});
const line = (reference: string, expenseId: string | null, over: Record<string, unknown> = {}) => ({
  reference, issuer: 'amex', day: '2026-11-05', digits: '92069', cents: 1000, kind: 'charge', firstImportId: 'today', lastImportId: 'today', expenseId, ...over
});

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  await db.insert(companyCards).values([
    { id: AMEX, label: 'MARU92069', issuer: 'amex', lastDigits: '92069' }, { id: ENCORE, label: 'MARU3992', issuer: 'encore', lastDigits: '3992' }
  ]);
  await db.insert(imports).values([
    { id: 'today', issuer: 'amex', fileName: 'activity.xlsx', lines: 7, added: 7, byId: hex(900), byName: 'Ann', at: AT },
    { id: 'old', issuer: 'amex', fileName: 'old.xlsx', lines: 1, added: 1, byId: hex(900), byName: 'Ann', at: new Date('2026-11-20T18:00:00Z') }
  ]);
  await db.insert(cardExpenses).values([
    expense(1, { receiptUrl: 'https://files.test/a.webp' }),            // a receipt file
    expense(2, { status: 'draft', lostReason: 'Lost it' }),             // a lost-receipt reason counts as a receipt
    expense(3, { status: 'approved' }),                                 // approved, no file
    expense(4, { status: 'missing' }),                                  // Missing row
    expense(5, { receiptUrl: 'https://files.test/b.webp', voidedAt: new Date() }), // voided: not live
    expense(6, { cardId: ENCORE, cardLabel: 'MARU3992', receiptUrl: 'https://files.test/c.webp' }), // Encore
    expense(7, { status: 'approved' })                                  // an Amex expense on an old line
  ]);
  await db.insert(lines).values([
    line('a', hex(1)), line('b', hex(2)), line('c', hex(3)), line('d', hex(4)), line('e', hex(5)),
    line('f', null), line('g', null, { kind: 'credit', cents: -500 }),
    line('older', hex(7), { firstImportId: 'old', lastImportId: 'old' })
  ]);
});
afterEach(async () => { await client.close(); });

describe('receipt counts', () => {
  it('splits the day\'s upload by what each charge has, and counts the Amex expenses', async () => {
    const r = await receiptCounts(db, { day: '2026-11-25' });
    expect(r.uploads.map(u => u.fileName)).toEqual(['activity.xlsx']);
    expect(r.lines).toEqual({ total: 7, charges: 6, credits: 1 });
    expect(r.charges).toEqual({ receipt: 2, noFile: 1, missing: 1, none: 2 }); // a, b | c | d | e (voided), f
    expect(r.expenses).toMatchObject({ total: 5, withReceipt: 2, noFile: 3 });
    expect(r.expenses.byStatus).toEqual({ waiting: 1, draft: 1, approved: 2, missing: 1 });
  });

  it('lists the charges with no expense (and why) and the expenses no line points at', async () => {
    await db.insert(cardExpenses).values(expense(8, { merchant: 'LOOSE ONE', status: 'draft', receiptUrl: 'https://files.test/z.webp' }));
    const r = await receiptCounts(db, { day: '2026-11-25' });
    expect(r.noExpense.map(c => c.reference).sort()).toEqual(['e', 'f']);
    expect(r.noExpense[0]).toMatchObject({ why: 'its card is not set up' });
    expect(r.unlinked).toEqual([expect.objectContaining({ id: hex(8), merchant: 'LOOSE ONE', hasReceipt: true })]);
  });

  it('a day with no upload still counts the expenses', async () => {
    const r = await receiptCounts(db, { day: '2026-11-22' });
    expect(r.uploads).toEqual([]);
    expect(r.lines.total).toBe(0);
    expect(r.expenses.total).toBe(5);
  });

  it('never mixes in the other bank', async () => {
    const r = await receiptCounts(db, { day: '2026-11-25', issuer: 'encore' });
    expect(r.uploads).toEqual([]);
    expect(r.expenses).toMatchObject({ total: 1, withReceipt: 1 });
  });
});
