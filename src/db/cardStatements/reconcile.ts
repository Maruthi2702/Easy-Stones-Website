/**
 * Reconciling a bank's statement lines in the app with the Excel file they came from (owner's ask, 2026-11-25). Read-only.
 *
 *  - `byDay` / `byCard`: the lines' charge counts and dollars per charge day and per card (last digits), so they can be set
 *    beside the same totals worked out from the Excel file.
 *  - `badLinks`: every line that points at an expense which doesn't fit it — a different amount, a day more than
 *    `MATCH_DAYS` apart, a voided expense, or a card that isn't the same card or the same holder. Each match the app makes
 *    needs the same card, the exact amount and at most 2 days, so this list should be empty.
 *  - `unlinkedCharges`: charges with no expense, as `receiptCounts` lists them.
 */
import { eq } from 'drizzle-orm';
import { cardStatementLines as lines } from '../schema/cardStatements.ts';
import { cardExpenses, companyCards } from '../schema/cardsSuppliers.ts';
import { MATCH_DAYS, daysApart } from '../../utils/amexStatement.ts';
import type { Db } from '../copy/plan.ts';

export interface Reconcile {
  totals: { lines: number; charges: number; chargeCents: number; credits: number };
  byDay: { day: string; charges: number; cents: number }[];
  byCard: { digits: string; charges: number; cents: number }[];
  badLinks: { reference: string; lineDay: string; lineCents: number; expenseDay: string; expenseCents: number; expenseId: string; why: string }[];
  noExpense: number;
}

export async function reconcile(db: Db, { issuer = 'amex' }: { issuer?: string } = {}): Promise<Reconcile> {
  const rows = await db.select({
    reference: lines.reference, kind: lines.kind, day: lines.day, cents: lines.cents, digits: lines.digits, cardId: lines.cardId, expenseId: lines.expenseId,
    expDay: cardExpenses.day, expCents: cardExpenses.cents, expCard: cardExpenses.cardId, voidedAt: cardExpenses.voidedAt
  }).from(lines).leftJoin(cardExpenses, eq(cardExpenses.id, lines.expenseId)).where(eq(lines.issuer, issuer));
  const holders = new Map<string, string | null>();
  for (const c of await db.select({ id: companyCards.id, userId: companyCards.userId }).from(companyCards)) holders.set(c.id, c.userId);

  const out: Reconcile = { totals: { lines: rows.length, charges: 0, chargeCents: 0, credits: 0 }, byDay: [], byCard: [], badLinks: [], noExpense: 0 };
  const days = new Map<string, { charges: number; cents: number }>(), cards = new Map<string, { charges: number; cents: number }>();
  const add = (m: typeof days, key: string, cents: number) => { const v = m.get(key) ?? { charges: 0, cents: 0 }; v.charges += 1; v.cents += cents; m.set(key, v); };
  for (const r of rows) {
    if (r.kind !== 'charge') { out.totals.credits += 1; continue; }
    const cents = Number(r.cents), day = String(r.day);
    out.totals.charges += 1; out.totals.chargeCents += cents;
    add(days, day, cents); add(cards, r.digits, cents);
    if (!r.expenseId || !r.expDay) { out.noExpense += 1; continue; }
    const why: string[] = [];
    if (Number(r.expCents) !== cents) why.push('amount differs');
    if (daysApart(String(r.expDay), day) > MATCH_DAYS) why.push(`days apart > ${MATCH_DAYS}`);
    if (r.voidedAt) why.push('expense is voided');
    if (r.cardId && r.expCard && r.cardId !== r.expCard) {
      const a = holders.get(r.cardId), b = holders.get(r.expCard);
      if (!a || !b || a !== b) why.push('different card and holder');
    }
    if (why.length) out.badLinks.push({ reference: r.reference, lineDay: day, lineCents: cents, expenseDay: String(r.expDay), expenseCents: Number(r.expCents), expenseId: r.expenseId, why: why.join(', ') });
  }
  out.byDay = [...days].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day));
  out.byCard = [...cards].map(([digits, v]) => ({ digits, ...v })).sort((a, b) => a.digits.localeCompare(b.digits));
  return out;
}
