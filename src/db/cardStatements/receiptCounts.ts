/**
 * How many receipts an Amex report has, and how many Amex expenses there are (owner's ask, 2026-11-25). Read-only.
 *
 * For the lines the day's uploads carry (the lines they first brought or last refreshed): each charge is counted once as
 *  - **receipt**: its expense has a receipt file or a lost-receipt reason, and isn't a Missing row;
 *  - **no file**: its expense has neither (an Approved "without a receipt" backfill row, or a waiting one with no file);
 *  - **missing**: its expense is a Missing receipt row;
 *  - **none**: no expense at all (before the check started, a card with no holder, a refunded charge…).
 * And for the Amex expenses themselves (voided left out): the same split by status.
 * `noExpense` lists the charges with no expense (with the likely reason) and `unlinked` the live expenses no statement line
 * points at, so the two sides can be compared one by one.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { cardStatementLines as lines, cardStatementImports as imports } from '../schema/cardStatements.ts';
import { cardExpenses, companyCards } from '../schema/cardsSuppliers.ts';
import { pacificDay } from '../../utils/statementStage.ts';
import { missingFromFor } from '../../utils/amexStatement.ts';
import type { Db } from '../copy/plan.ts';

export interface ReceiptCounts {
  day: string;
  uploads: { fileName: string; at: Date; lines: number; added: number; byName: string }[];
  lines: { total: number; charges: number; credits: number };
  charges: { receipt: number; noFile: number; missing: number; none: number };
  expenses: { total: number; withReceipt: number; noFile: number; byStatus: Record<string, number> };
  /** Charges with no expense, with why (the card isn't set up, has no holder, is before the start day, or none of those). */
  noExpense: { reference: string; day: string; cents: number; description: string; cardMember: string; digits: string; why: string }[];
  /** Live expenses no statement line points at. */
  unlinked: { id: string; holderName: string; cardLabel: string; day: string; cents: number; merchant: string; status: string; hasReceipt: boolean }[];
}

export async function receiptCounts(db: Db, { day, issuer = 'amex' }: { day?: string; issuer?: string } = {}): Promise<ReceiptCounts> {
  const today = day ?? pacificDay(new Date());
  const mine = (await db.select().from(imports).where(eq(imports.issuer, issuer))).filter(i => pacificDay(i.at) === today);
  const ids = mine.map(i => i.id);
  const out: ReceiptCounts = {
    day: today,
    uploads: mine.map(i => ({ fileName: i.fileName, at: i.at, lines: i.lines, added: i.added, byName: i.byName })),
    lines: { total: 0, charges: 0, credits: 0 }, charges: { receipt: 0, noFile: 0, missing: 0, none: 0 },
    expenses: { total: 0, withReceipt: 0, noFile: 0, byStatus: {} }, noExpense: [], unlinked: []
  };
  if (ids.length) {
    const rows = await db.select({
      kind: lines.kind, expenseId: lines.expenseId, status: cardExpenses.status, voidedAt: cardExpenses.voidedAt,
      receiptUrl: cardExpenses.receiptUrl, lostReason: cardExpenses.lostReason,
      reference: lines.reference, day: lines.day, cents: lines.cents, description: lines.description, cardMember: lines.cardMember,
      digits: lines.digits, cardId: lines.cardId, holderId: companyCards.userId
    }).from(lines).leftJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId)).leftJoin(companyCards, eq(companyCards.id, lines.cardId))
      .where(and(eq(lines.issuer, issuer), or(inArray(lines.firstImportId, ids), inArray(lines.lastImportId, ids))));
    for (const r of rows) {
      out.lines.total += 1;
      if (r.kind !== 'charge') { out.lines.credits += 1; continue; }
      out.lines.charges += 1;
      const live = r.expenseId && r.status && !r.voidedAt;
      if (!live) {
        out.charges.none += 1;
        const why = !r.cardId ? 'its card is not set up' : !r.holderId ? 'its card has no holder yet' : String(r.day) < missingFromFor(issuer) ? `before the start day (${missingFromFor(issuer)})` : 'no reason found (a refunded charge, or the check has not run on it)';
        out.noExpense.push({ reference: r.reference, day: String(r.day), cents: Number(r.cents), description: r.description, cardMember: r.cardMember, digits: r.digits, why });
      }
      else if (r.status === 'missing') out.charges.missing += 1;
      else if (r.receiptUrl || r.lostReason) out.charges.receipt += 1;
      else out.charges.noFile += 1;
    }
  }
  const ex = await db.select({
    status: cardExpenses.status, n: sql<number>`count(*)::int`,
    withReceipt: sql<number>`count(*) filter (where ${cardExpenses.receiptUrl} <> '' or ${cardExpenses.lostReason} <> '')::int`
  }).from(cardExpenses).innerJoin(companyCards, eq(companyCards.id, cardExpenses.cardId))
    .where(and(eq(companyCards.issuer, issuer), isNull(cardExpenses.voidedAt))).groupBy(cardExpenses.status);
  const loose = await db.select({
    id: cardExpenses.id, holderName: cardExpenses.holderName, cardLabel: cardExpenses.cardLabel, day: cardExpenses.day, cents: cardExpenses.cents,
    merchant: cardExpenses.merchant, status: cardExpenses.status, receiptUrl: cardExpenses.receiptUrl, lostReason: cardExpenses.lostReason
  }).from(cardExpenses).innerJoin(companyCards, eq(companyCards.id, cardExpenses.cardId))
    .where(and(eq(companyCards.issuer, issuer), isNull(cardExpenses.voidedAt), sql`not exists (select 1 from ${lines} l where l.expense_id = ${cardExpenses.id})`));
  out.unlinked = loose.map(e => ({ id: e.id, holderName: e.holderName, cardLabel: e.cardLabel, day: String(e.day), cents: Number(e.cents), merchant: e.merchant, status: e.status, hasReceipt: Boolean(e.receiptUrl || e.lostReason) }));
  for (const e of ex) {
    out.expenses.total += e.n;
    out.expenses.withReceipt += e.withReceipt;
    out.expenses.noFile += e.n - e.withReceipt;
    out.expenses.byStatus[e.status] = e.n;
  }
  return out;
}
