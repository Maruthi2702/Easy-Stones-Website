/** Finding possible duplicate card expenses, on an in-memory Postgres. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { cardStatementLines as lines, cardStatementImports as imports } from '../schema/cardStatements.ts';
import { cardExpenses, companyCards } from '../schema/cardsSuppliers.ts';
import { findDuplicates, groupDuplicates, merchantKey, type DupExpense } from './duplicates.ts';

const hex = (n: number) => n.toString(16).padStart(24, '0');
const CARD = hex(10);
let client: PGlite, db: Db;

const expense = (n: number, day: string, cents: number, merchant: string, over: Record<string, unknown> = {}) => ({
  id: hex(n), cardId: CARD, cardLabel: 'MARU92069', holderName: 'Krish', day, month: day.slice(0, 7), merchant, cents, status: 'waiting', ...over
});
const line = (reference: string, expenseId: string | null) => ({
  reference, issuer: 'amex', day: '2026-11-05', digits: '92069', cents: 1000, kind: 'charge', firstImportId: 'imp', lastImportId: 'imp', expenseId
});

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  await db.insert(companyCards).values({ id: CARD, label: 'MARU92069', issuer: 'amex', lastDigits: '92069' });
  await db.insert(imports).values({ id: 'imp', issuer: 'amex', fileName: 'a.xlsx', lines: 4, added: 4, byId: hex(900), byName: 'Ann' });
  await db.insert(cardExpenses).values([
    expense(1, '2026-11-05', 1000, 'CAFE ONE'), expense(2, '2026-11-05', 1000, 'AplPay CAFE ONE'),             // likely: same merchant
    expense(3, '2026-11-06', 2000, 'HARDWARE'), expense(4, '2026-11-06', 2000, 'LUNCH SPOT'),                   // maybe: different merchants
    expense(5, '2026-11-07', 3000, 'FRONTIER AI A'), expense(6, '2026-11-07', 3000, 'FRONTIER AI A'),           // separate: each has its own line
    expense(7, '2026-11-08', 4000, 'FUEL', { receiptHash: 'abc123abc123abc123' }), expense(8, '2026-11-09', 4100, 'FUEL', { receiptHash: 'abc123abc123abc123' }), // same photo
    expense(9, '2026-11-05', 1000, 'CAFE ONE', { voidedAt: new Date() })                                          // voided: ignored
  ]);
  await db.insert(lines).values([line('L5', hex(5)), line('L6', hex(6))]);
});
afterEach(async () => { await client.close(); });

describe('finding possible duplicate card expenses', () => {
  it('lists likely, maybe and separate groups and the same photo, and ignores voided ones', async () => {
    const groups = await findDuplicates(db);
    const view = groups.map(g => `${g.kind}:${g.confidence}:${g.expenses.map(e => Number(BigInt('0x' + e.id))).sort().join(',')}`);
    expect(view).toEqual(['charge:likely:1,2', 'photo:likely:7,8', 'charge:maybe:3,4', 'charge:separate:5,6']);
  });

  it('a voided expense is never in a group', async () => {
    const ids = (await findDuplicates(db)).flatMap(g => g.expenses.map(e => e.id));
    expect(ids).not.toContain(hex(9));
  });

  it('is read-only', async () => {
    await findDuplicates(db);
    expect(await db.select().from(cardExpenses)).toHaveLength(9);
  });
});

describe('merchantKey and groupDuplicates', () => {
  it('reads a wallet prefix, case and spacing as the same merchant', () => {
    expect(merchantKey('AplPay  CHEVRON 0205')).toBe(merchantKey('chevron 0205'));
    expect(merchantKey('CAFE ONE')).not.toBe(merchantKey('CAFE TWO'));
  });
  it('needs two or more to make a group', () => {
    const one: DupExpense = { id: 'a', holderName: '', cardLabel: 'C', day: '2026-11-01', cents: 1, merchant: 'X', status: 'waiting', hasReceipt: false, lineRef: '' };
    expect(groupDuplicates([one], new Map())).toEqual([]);
  });
});
