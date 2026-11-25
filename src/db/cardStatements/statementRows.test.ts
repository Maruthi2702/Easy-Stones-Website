/** Refund, fee and refunded-charge rows made by the check (2026-11-25), on an in-memory Postgres. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { cardStatementLines as lines, cardStatementImports as imports } from '../schema/cardStatements.ts';
import { cardExpenses, cardExpenseHistory, companyCards } from '../schema/cardsSuppliers.ts';
import { roles, users, locations } from '../schema/reference.ts';
import { recheck } from './index.ts';

const hex = (n: number) => n.toString(16).padStart(24, '0');
const SEATTLE = hex(1), MARU = hex(2), CARD = hex(3), NOHOLDER = hex(4);
const BY = { id: hex(900), name: 'Ann Count' };
let client: PGlite, db: Db;

const line = (reference: string, day: string, cents: number, kind: 'charge' | 'credit' | 'fee', description: string, over: Record<string, unknown> = {}) => ({
  reference, issuer: 'amex', day, digits: '92069', cents, kind, description, cardMember: 'MARUTHI PONUGUPATI', firstImportId: 'imp', lastImportId: 'imp', expenseId: null, ...over
});
const all = () => db.select().from(cardExpenses);
const byLine = async (reference: string) => {
  const [l] = await db.select().from(lines).where(eq(lines.reference, reference));
  if (!l?.expenseId) return null;
  const [e] = await db.select().from(cardExpenses).where(eq(cardExpenses.id, l.expenseId));
  return e ?? null;
};

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  await db.insert(roles).values({ id: hex(50), name: 'sales_rep', displayName: 'Sales rep' });
  await db.insert(locations).values({ id: SEATTLE, name: 'Seattle' });
  await db.insert(users).values({ id: MARU, username: 'maru', displayName: 'Maruthi', passwordHash: 'x', role: 'sales_rep', homeLocationId: SEATTLE });
  await db.insert(companyCards).values([
    { id: CARD, userId: MARU, label: 'MARU92069', issuer: 'amex', lastDigits: '92069' },
    { id: NOHOLDER, userId: null, label: 'NOBO91608', issuer: 'amex', lastDigits: '91608' }
  ]);
  await db.insert(imports).values({ id: 'imp', issuer: 'amex', fileName: 'a.xlsx', lines: 1, added: 1, byId: BY.id, byName: BY.name });
});
afterEach(async () => { await client.close(); });

describe('rows made from the statement itself', () => {
  it('a refund becomes a negative Waiting-for-Accounting row, a fee a positive one, a card payment nothing', async () => {
    await db.insert(lines).values([
      line('refund', '2026-11-10', -5400, 'credit', 'EXPEDIATSPUS BELLEVUE WA'),
      line('fee', '2026-11-11', 2500, 'fee', '*EXPEDITED CARD DELIVERY FEE'),
      line('payment', '2026-11-12', -8005018, 'credit', 'AUTO PAYMENT DEDUCTION', { digits: '' })
    ]);
    const r = await recheck(BY, { issuer: 'amex' }, db);
    expect(r.statementRows).toBe(2);
    expect(await byLine('refund')).toMatchObject({ status: 'waiting', statementKind: 'refund', cents: -5400, userId: MARU, cardId: CARD, receiptUrl: '' });
    expect(await byLine('fee')).toMatchObject({ status: 'waiting', statementKind: 'fee', cents: 2500, merchant: '*EXPEDITED CARD DELIVERY FEE' });
    expect(await byLine('payment')).toBeNull();
    const [h] = await db.select().from(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, (await byLine('refund'))!.id));
    expect(h).toMatchObject({ action: 'added' });
    expect(h!.changes).toMatch(/refund/i);
  });

  it('is safe to run twice', async () => {
    await db.insert(lines).values([line('refund', '2026-11-10', -5400, 'credit', 'EXPEDIA'), line('fee', '2026-11-11', 2500, 'fee', 'ANNUAL FEE')]);
    await recheck(BY, { issuer: 'amex' }, db);
    const again = await recheck(BY, { issuer: 'amex' }, db);
    expect(again.statementRows).toBe(0);
    expect(await all()).toHaveLength(2);
  });

  it('a card with no holder gets no row yet, and a day before the bank’s start gets none', async () => {
    await db.insert(lines).values([
      line('nobody', '2026-11-10', -500, 'credit', 'REFUND', { digits: '91608' }),
      line('early', '2026-10-20', -500, 'credit', 'REFUND')
    ]);
    const r = await recheck(BY, { issuer: 'amex' }, db);
    expect(r.statementRows).toBe(0);
    expect(await all()).toHaveLength(0);
  });

  it('a charge a refund returned keeps a row: its Missing row becomes a refunded-charge row (not voided), and one with no row gets one', async () => {
    await db.insert(lines).values([
      line('c1', '2026-11-03', 3498, 'charge', 'GRAINGER'), line('r1', '2026-11-06', -3498, 'credit', 'GRAINGER'),
      line('c2', '2026-11-04', 1331, 'charge', 'AMAZON'), line('r2', '2026-11-05', -1331, 'credit', 'AMAZON'),
      line('c3', '2026-11-07', 999, 'charge', 'PLAIN')
    ]);
    // c1 already has a Missing receipt row (made before the refund arrived).
    await db.insert(cardExpenses).values({ id: hex(10), userId: MARU, holderName: 'Maruthi', cardId: CARD, cardLabel: 'MARU92069', locationId: SEATTLE,
      day: '2026-11-03', month: '2026-11', merchant: 'GRAINGER', cents: 3498, status: 'missing' });
    await db.update(lines).set({ expenseId: hex(10) }).where(eq(lines.reference, 'c1'));
    await recheck(BY, { issuer: 'amex' }, db);
    const c1 = await byLine('c1'), c2 = await byLine('c2'), c3 = await byLine('c3');
    expect(c1).toMatchObject({ id: hex(10), status: 'waiting', statementKind: 'refunded_charge', voidedAt: null, cents: 3498 });
    expect(c2).toMatchObject({ status: 'waiting', statementKind: 'refunded_charge', cents: 1331 });
    expect(c3).toMatchObject({ status: 'missing', statementKind: '' });
    // The refunds are rows too: charge + refund net to zero.
    expect((await byLine('r1'))!.cents + c1!.cents).toBe(0);
    expect((await byLine('r2'))!.cents + c2!.cents).toBe(0);
    const total = (await all()).filter(e => !e.voidedAt && e.status !== 'missing').reduce((t, e) => t + Number(e.cents), 0);
    expect(total).toBe(0);
  });

  it('a row a person voided is not made again, and an approved statement row never answers a new charge', async () => {
    await db.insert(lines).values([
      line('refund', '2026-11-10', -5400, 'credit', 'EXPEDIA'),
      line('fee', '2026-11-11', 2500, 'fee', 'ANNUAL FEE'),
      line('newcharge', '2026-11-12', 2500, 'charge', 'A NEW LUNCH')
    ]);
    await recheck(BY, { issuer: 'amex' }, db);
    const refund = (await byLine('refund'))!, fee = (await byLine('fee'))!;
    // A person voids the refund row; Accounting approves the fee row.
    await db.update(cardExpenses).set({ voidedAt: new Date(), voidedBy: 'Ann', voidReason: 'Duplicate' }).where(eq(cardExpenses.id, refund.id));
    await db.update(cardExpenses).set({ status: 'approved', approvedById: BY.id, approvedByName: BY.name, approvedAt: new Date() }).where(eq(cardExpenses.id, fee.id));
    const r = await recheck(BY, { issuer: 'amex' }, db);
    expect(r.statementRows).toBe(0);
    expect((await all()).filter(e => e.statementKind === 'refund' && !e.voidedAt)).toHaveLength(0);
    // The new $25.00 charge is not answered by the approved $25.00 fee row (same card, amount and nearby day).
    expect(await byLine('newcharge')).toMatchObject({ status: 'missing', statementKind: '' });
  });

  it('a second approval is never asked for a statement row, however big', async () => {
    const { secondNeeded } = await import('../../utils/receiptApproval.ts');
    expect(secondNeeded({ cents: 34984, holderRole: 'sales_rep' })).toBe(true);
    expect(secondNeeded({ cents: 34984, holderRole: 'sales_rep', statementKind: 'refunded_charge' })).toBe(false);
  });
});
