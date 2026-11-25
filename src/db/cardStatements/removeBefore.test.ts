/** Removing the Amex report before a day, and one old report file whole, on an in-memory Postgres. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { cardStatementLines as lines, cardStatementImports as imports } from '../schema/cardStatements.ts';
import { cardExpenses, cardExpenseHistory, cardExpenseDeletions, companyCards } from '../schema/cardsSuppliers.ts';
import { planRemoveBefore, applyRemoveBefore, BACKFILL_NOTE } from './removeBefore.ts';

const hex = (n: number) => n.toString(16).padStart(24, '0');
const AMEX = hex(10), ENCORE = hex(11);
let client: PGlite, db: Db;

const upload = (id: string, fileName: string, issuer = 'amex') => ({ id, issuer, fileName, lines: 1, added: 1, byId: hex(900), byName: 'Ann' });
const line = (reference: string, day: string, first: string, last: string, expenseId: string | null = null, issuer = 'amex') => ({
  reference, issuer, day, digits: '92069', cents: 1000, kind: 'charge', firstImportId: first, lastImportId: last, expenseId
});
const expense = (id: string, day: string, over: Record<string, unknown> = {}) => ({
  id, cardId: AMEX, cardLabel: 'MARU92069', holderName: 'Krish', day, month: day.slice(0, 7), merchant: `M-${id.slice(-2)}`, cents: 1000, status: 'approved', ...over
});
const backfill = (n: number, day: string, over: Record<string, unknown> = {}) => expense(hex(n), day, over);
const note = (id: string, changes: string) => ({ expenseId: id, position: 0, at: new Date(), by: 'Amex backfill', action: 'added', changes });

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  await db.insert(companyCards).values([
    { id: AMEX, label: 'MARU92069', issuer: 'amex', lastDigits: '92069' },
    { id: ENCORE, label: 'MARU3992', issuer: 'encore', lastDigits: '3992' }
  ]);
  await db.insert(imports).values([upload('imp-oct', "Amex activity Oct'26.xlsx"), upload('imp-new', 'activity.xlsx'), upload('imp-enc', 'encore.xlsx', 'encore')]);
  await db.insert(cardExpenses).values([
    backfill(1, '2026-10-10'),                                   // before the day, a backfill row → goes
    backfill(2, '2026-10-28'),                                   // only the removed file's line answers it → goes
    backfill(3, '2026-10-28'),                                   // a remaining (shared) line answers it → stays
    expense(hex(4), '2026-10-30', { status: 'missing' }),        // a Missing row on a remaining line → stays
    backfill(5, '2026-10-12'),                                   // before the day, no line → goes
    expense(hex(6), '2026-10-12', { status: 'waiting', receiptUrl: 'https://files.test/a.webp' }), // a real receipt → kept, listed
    expense(hex(7), '2026-10-12', { status: 'draft' }),          // a person's draft → kept, listed
    backfill(8, '2026-10-10', { cardId: ENCORE, cardLabel: 'MARU3992' }), // Encore → never touched
    backfill(9, '2026-10-29'),                                   // a backfill row nothing points at → goes
    expense(hex(10), '2026-10-12', { status: 'missing' })        // an untouched Missing row before the day → goes
  ]);
  await db.insert(cardExpenseHistory).values([
    ...[1, 2, 3, 5, 8, 9].map(n => note(hex(n), `${BACKFILL_NOTE} (Amex charge R${n})`)),
    note(hex(4), 'Missing receipt: Amex charge R4'), note(hex(10), 'Missing receipt: Amex charge R10')
  ]);
  await db.insert(lines).values([
    line('r1', '2026-10-10', 'imp-oct', 'imp-oct', hex(1)),
    line('r2', '2026-10-28', 'imp-oct', 'imp-oct', hex(2)),
    line('r3', '2026-10-28', 'imp-oct', 'imp-new', hex(3)),
    line('r4', '2026-10-30', 'imp-new', 'imp-new', hex(4)),
    line('r-enc', '2026-10-10', 'imp-enc', 'imp-enc', hex(8), 'encore'),
    line('r-loose', '2026-10-15', 'imp-new', 'imp-new')
  ]);
});
afterEach(async () => { await client.close(); });

const OPTS = { before: '2026-10-26', file: "Oct'26" };

describe('removing the Amex report before a day and one file whole', () => {
  it('a dry run lists what would go and what stays, and changes nothing', async () => {
    const plan = await planRemoveBefore(db, OPTS);
    expect(plan.removeLines.sort()).toEqual(['r1', 'r2', 'r-loose'].sort());
    expect(plan.sharedLines).toEqual(['r3']);
    expect(plan.imports.map(i => i.id)).toEqual(['imp-oct']);
    expect(plan.expenses.map(e => e.id).sort()).toEqual([hex(1), hex(10), hex(2), hex(5), hex(9)].sort());
    expect(plan.keptReal.map(e => e.id)).toEqual([hex(6)]);
    expect(plan.keptOther.map(e => e.id)).toEqual([hex(7)]);
    expect(await db.select().from(cardExpenses)).toHaveLength(10);
    expect(await db.select().from(lines)).toHaveLength(6);
  });

  it('without a file it only removes what is dated before the day', async () => {
    const plan = await planRemoveBefore(db, { before: '2026-10-26' });
    expect(plan.imports).toEqual([]);
    expect(plan.removeLines.sort()).toEqual(['r-loose', 'r1']);
    // r2 stays when no file is named, so the 10-28 backfill row it points at (hex 2) stays; hex 9 has no line and goes.
    expect(plan.expenses.map(e => e.id).sort()).toEqual([hex(1), hex(10), hex(5), hex(9)].sort());
  });

  it('applies: saves each expense whole, unlinks, deletes, and never touches Encore, real receipts or drafts', async () => {
    await applyRemoveBefore(db, OPTS, 'Cleanup test');
    expect((await db.select().from(cardExpenses)).map(e => e.id).sort()).toEqual([hex(3), hex(4), hex(6), hex(7), hex(8)].sort());
    expect((await db.select().from(cardExpenseDeletions)).map(d => d.expenseId).sort()).toEqual([hex(1), hex(10), hex(2), hex(5), hex(9)].sort());
    const kept = Object.fromEntries((await db.select().from(lines)).map(l => [l.reference, l]));
    expect(Object.keys(kept).sort()).toEqual(['r-enc', 'r3', 'r4']);
    expect(kept['r3']).toMatchObject({ expenseId: hex(3), firstImportId: 'imp-new', lastImportId: 'imp-new' });
    expect(kept['r-enc']).toMatchObject({ issuer: 'encore', expenseId: hex(8) });
    expect((await db.select().from(imports)).map(i => i.id).sort()).toEqual(['imp-enc', 'imp-new']);
  });

  it('is safe to run twice', async () => {
    await applyRemoveBefore(db, OPTS, 'Cleanup test');
    const again = await applyRemoveBefore(db, OPTS, 'Cleanup test');
    expect(again.expenses).toEqual([]);
    expect(again.removeLines).toEqual([]);
  });

  it('refuses a day that is not YYYY-MM-DD', async () => {
    await expect(planRemoveBefore(db, { before: '10/26/2026' })).rejects.toThrow(/YYYY-MM-DD/);
  });
});
