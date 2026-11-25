/** Removing one person's statement uploads, on an in-memory Postgres. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { cardStatementLines as lines, cardStatementImports as imports } from '../schema/cardStatements.ts';
import { cardExpenses, cardExpenseHistory, cardExpenseDeletions } from '../schema/cardsSuppliers.ts';
import { planPurge, applyPurge, planOrphanMissingRows, applyOrphanMissingRows, planPrune, applyPrune, isKeptName } from './purge.ts';

const hex = (n: number) => n.toString(16).padStart(24, '0');
let client: PGlite, db: Db;

const upload = (id: string, byName: string, issuer = 'amex') => ({ id, issuer, fileName: `${id}.xlsx`, lines: 1, added: 1, byId: hex(900), byName });
const line = (reference: string, first: string, last: string, expenseId: string | null = null) => ({
  reference, issuer: 'amex', day: '2026-11-05', digits: '92069', cents: 1000, kind: 'charge', firstImportId: first, lastImportId: last, expenseId
});
const expense = (id: string, over: Record<string, unknown> = {}) => ({ id, cardLabel: 'MARU92069', day: '2026-11-05', month: '2026-11', merchant: 'X', cents: 1000, status: 'missing', ...over });

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  await db.insert(imports).values([upload('imp-k1', 'Krish'), upload('imp-k2', 'Krish', 'encore'), upload('imp-o', 'Ann Count')]);
  await db.insert(cardExpenses).values([
    expense(hex(1)), expense(hex(2), { status: 'approved' }), expense(hex(3), { status: 'waiting', receiptUrl: 'https://files.test/a.webp' }), expense(hex(4))
  ]);
  await db.insert(cardExpenseHistory).values([{ expenseId: hex(1), position: 0, at: new Date(), by: 'Krish', action: 'added', changes: 'Missing receipt' }]);
  await db.insert(lines).values([
    line('mine-missing', 'imp-k1', 'imp-k1', hex(1)),
    line('mine-approved', 'imp-k1', 'imp-k2', hex(2)),
    line('mine-receipt', 'imp-k2', 'imp-k2', hex(3)),
    line('shared', 'imp-k1', 'imp-o'),
    line('theirs-refreshed', 'imp-o', 'imp-k1'),
    line('theirs', 'imp-o', 'imp-o', hex(4))
  ]);
});
afterEach(async () => { await client.close(); });

describe('removing one person’s statement uploads', () => {
  it('a dry run says what would go and changes nothing', async () => {
    const plan = await planPurge(db, 'krish');
    expect(plan.imports.map(i => i.id).sort()).toEqual(['imp-k1', 'imp-k2']);
    expect(plan.removeLines.sort()).toEqual(['mine-approved', 'mine-missing', 'mine-receipt']);
    expect(plan.keptLines.sort()).toEqual(['shared', 'theirs-refreshed']);
    expect(plan.answeredByReceipts).toBe(2);
    expect(plan.missingRows).toEqual({ removable: [hex(1)], keptApproved: 1, keptOther: 1 });
    expect(await db.select().from(lines)).toHaveLength(6);
    expect(await db.select().from(imports)).toHaveLength(3);
  });

  it('removes their uploads and the lines only they brought, keeps everyone else’s, and never deletes receipts', async () => {
    await applyPurge(db, 'Krish');
    expect((await db.select().from(imports)).map(i => i.id)).toEqual(['imp-o']);
    expect((await db.select().from(lines)).map(l => l.reference).sort()).toEqual(['shared', 'theirs', 'theirs-refreshed']);
    const kept = Object.fromEntries((await db.select().from(lines)).map(l => [l.reference, l]));
    expect(kept['shared']).toMatchObject({ firstImportId: 'imp-o', lastImportId: 'imp-o' });
    expect(kept['theirs-refreshed']).toMatchObject({ firstImportId: 'imp-o', lastImportId: 'imp-o' });
    expect(await db.select().from(cardExpenses)).toHaveLength(4);
  });

  it('with --missing-rows also deletes the untouched Missing row and its history, and only that', async () => {
    await applyPurge(db, 'krish', { missingRows: true });
    expect((await db.select().from(cardExpenses)).map(e => e.id).sort()).toEqual([hex(2), hex(3), hex(4)]);
    expect(await db.select().from(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, hex(1)))).toHaveLength(0);
  });

  it('does nothing for a name with no uploads', async () => {
    expect((await applyPurge(db, 'nobody')).imports).toEqual([]);
    expect(await db.select().from(lines)).toHaveLength(6);
  });
});

describe('Missing rows left behind by a removed upload', () => {
  it('finds only untouched Missing rows no line points at, and deletes just those', async () => {
    await db.insert(cardExpenses).values([expense(hex(10)), expense(hex(11)), expense(hex(12), { status: 'draft' })]);
    await db.insert(cardExpenseHistory).values([
      { expenseId: hex(10), position: 0, at: new Date(), by: 'Krish', action: 'added', changes: 'Missing receipt: Amex charge ref-gone' },
      { expenseId: hex(11), position: 0, at: new Date(), by: 'Krish', action: 'added', changes: 'Missing receipt: Amex charge ref-gone-2' },
      { expenseId: hex(11), position: 1, at: new Date(), by: 'Srini', action: 'edited', changes: 'merchant' },
      { expenseId: hex(12), position: 0, at: new Date(), by: 'Krish', action: 'added', changes: 'Missing receipt: Amex charge ref-gone-3' }
    ]);
    // hex(1) is still pointed at by a line, hex(10) by none, hex(11) was edited, hex(12) is a draft.
    expect((await planOrphanMissingRows(db)).map(r => r.id)).toEqual([hex(10)]);
    expect(await db.select().from(cardExpenses)).toHaveLength(7);
    await applyOrphanMissingRows(db);
    expect((await db.select().from(cardExpenses)).map(e => e.id)).not.toContain(hex(10));
    expect(await db.select().from(cardExpenses)).toHaveLength(6);
    expect(await planOrphanMissingRows(db)).toEqual([]);
  });
});

describe('receipts by anyone but the people to keep', () => {
  const made = (n: number, createdBy: string, status = 'waiting') => expense(hex(n), { createdBy, holderName: createdBy, status });
  beforeEach(async () => {
    await db.delete(lines);
    await db.delete(cardExpenses);
    await db.insert(cardExpenses).values([
      made(20, 'Krish'), made(21, 'Karunakar Reddy', 'missing'), made(22, 'Ann Count'), made(23, 'Ann Count', 'approved'),
      made(24, 'Krishna Rao', 'draft'), made(25, ''), made(26, 'Ben Hall', 'missing')
    ]);
    await db.insert(cardExpenseHistory).values([{ expenseId: hex(22), position: 0, at: new Date(), by: 'Ann Count', action: 'added', changes: '' }]);
    await db.insert(lines).values([line('on-22', 'imp-o', 'imp-o', hex(22)), line('on-20', 'imp-o', 'imp-o', hex(20))]);
  });

  it('matches a whole word of the name', () => {
    expect(isKeptName('Krish', ['krish'])).toBe(true);
    expect(isKeptName('Krishna Rao', ['krish'])).toBe(false);
    expect(isKeptName('Karunakar Reddy', ['krish', 'karunakar'])).toBe(true);
  });

  it('a dry run lists the others’ unapproved receipts and changes nothing', async () => {
    const plan = await planPrune(db, ['krish', 'karunakar']);
    expect(plan.remove.map(r => r.id).sort()).toEqual([hex(22), hex(24), hex(26)]);
    expect(plan).toMatchObject({ keptByName: 2, keptApproved: 1, noCreator: 1 });
    expect(plan.remove.find(r => r.id === hex(22))?.onStatement).toBe(true);
    expect(await db.select().from(cardExpenses)).toHaveLength(7);
  });

  it('saves each to card_expense_deletions, deletes it with its history, unlinks its line, and never touches approved', async () => {
    await applyPrune(db, ['krish', 'karunakar'], 'cleanup');
    expect((await db.select().from(cardExpenses)).map(e => e.id).sort()).toEqual([hex(20), hex(21), hex(23), hex(25)]);
    const saved = await db.select().from(cardExpenseDeletions);
    expect(saved.map(s => s.expenseId).sort()).toEqual([hex(22), hex(24), hex(26)]);
    expect(saved[0].reason).toBe('cleanup');
    expect(await db.select().from(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, hex(22)))).toHaveLength(0);
    const l = Object.fromEntries((await db.select().from(lines)).map(x => [x.reference, x.expenseId]));
    expect(l).toEqual({ 'on-22': null, 'on-20': hex(20) });
  });

  it('in delete mode removes only what those people made, approved excepted', async () => {
    await db.update(cardExpenses).set({ status: 'approved' }).where(eq(cardExpenses.id, hex(20)));
    const plan = await planPrune(db, ['krish', 'karunakar'], 'delete');
    expect(plan.remove.map(r => r.id).sort()).toEqual([hex(21)]);
    await applyPrune(db, ['krish', 'karunakar'], 'cleanup', 'script', 'delete');
    expect((await db.select().from(cardExpenses)).map(e => e.id).sort()).toEqual([hex(20), hex(22), hex(23), hex(24), hex(25), hex(26)]);
    expect((await db.select().from(cardExpenseDeletions)).map(d => d.expenseId)).toEqual([hex(21)]);
  });
});
