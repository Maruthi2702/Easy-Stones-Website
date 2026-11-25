/**
 * One-time cleanup (owner, 2026-11-25): take the Amex report out of Credit Card Receipts for every charge **before a
 * day** (2026-10-26), and take out the whole of one old report file (`Amex activity Oct'26.xlsx`) with the expenses the
 * "before the check started" backfill (scripts/amex-month-approve.ts) made from it.
 *
 * What goes, Amex only (Encore is never touched):
 *  - Statements lines dated before the day, and the lines only the named file's uploads carry (and those uploads).
 *    A line another upload also carries stays; its first / last pointer is moved off the removed upload.
 *  - Expenses on an Amex card that are placeholders, never a person's work: an Approved "without a receipt" backfill row
 *    or an untouched Missing receipt row. A placeholder goes when it is dated before the day, or when it only answered
 *    lines that are going (a backfill row no line points at goes too). One a **remaining** line points at stays.
 *  - Each expense is saved whole to `card_expense_deletions` first (history goes with it), and a line that pointed at it is
 *    unlinked. Statement lines are not backed up: the file can be uploaded again.
 *
 * What never goes: an expense with a receipt file or a lost-receipt reason (listed as `keptReal`), and any other row dated
 * before the day a person made or touched (a draft, a waiting one with no file, a sent-back, a voided one — `keptOther`).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { cardStatementLines as lines, cardStatementImports as imports } from '../schema/cardStatements.ts';
import { cardExpenses, cardExpenseHistory, cardExpenseDeletions, companyCards } from '../schema/cardsSuppliers.ts';
import { findExpense } from '../cardReceipts/postgres.ts';
import type { Db } from '../copy/plan.ts';

export const BACKFILL_NOTE = 'Added from the Amex statement without a receipt (before the check started)';

type Row = { id: string; holderName: string; merchant: string; day: string; cents: number; status: string };
export interface RemoveBeforePlan {
  before: string;
  file: string;
  imports: { id: string; fileName: string; lines: number }[];
  /** Statement lines that go (by Amex reference). */
  removeLines: string[];
  /** Lines the file's uploads share with another upload: kept, pointer moved. */
  sharedLines: string[];
  expenses: (Row & { why: string })[];
  /** Dated before the day with a receipt file or a lost-receipt reason: left alone. */
  keptReal: Row[];
  /** Dated before the day, no receipt, but a person's work or not a placeholder: left alone. */
  keptOther: Row[];
}

const CHUNK = 2000;
const chunks = <T,>(a: T[]) => Array.from({ length: Math.ceil(a.length / CHUNK) }, (_, i) => a.slice(i * CHUNK, (i + 1) * CHUNK));

export async function planRemoveBefore(db: Db, { before, file = '' }: { before: string; file?: string }): Promise<RemoveBeforePlan> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new Error('Say the day as YYYY-MM-DD.');
  const needle = file.trim().toLowerCase();
  const fileImports = needle
    ? (await db.select().from(imports).where(eq(imports.issuer, 'amex'))).filter(i => i.fileName.toLowerCase().includes(needle))
    : [];
  const fileIds = new Set(fileImports.map(i => i.id));

  const amexLines = await db.select({ reference: lines.reference, day: lines.day, expenseId: lines.expenseId, first: lines.firstImportId, last: lines.lastImportId })
    .from(lines).where(eq(lines.issuer, 'amex'));
  const going = new Set<string>();
  const shared: string[] = [];
  for (const l of amexLines) {
    const fromFile = fileIds.has(l.first) && fileIds.has(l.last);
    if (String(l.day) < before || fromFile) going.add(l.reference);
    else if (fileIds.has(l.first) || fileIds.has(l.last)) shared.push(l.reference);
  }
  // Who a remaining line points at, and who only going lines point at.
  const pointedByKept = new Set<string>(), pointedByGoing = new Set<string>();
  for (const l of amexLines) {
    if (!l.expenseId) continue;
    (going.has(l.reference) ? pointedByGoing : pointedByKept).add(l.expenseId);
  }

  const rows = await db.select({
    id: cardExpenses.id, holderName: cardExpenses.holderName, merchant: cardExpenses.merchant, day: cardExpenses.day, cents: cardExpenses.cents,
    status: cardExpenses.status, receiptUrl: cardExpenses.receiptUrl, lostReason: cardExpenses.lostReason, voidedAt: cardExpenses.voidedAt,
    firstAction: sql<string>`(select h.action from ${cardExpenseHistory} h where h.expense_id = ${cardExpenses.id} and h.position = 0)`,
    firstChanges: sql<string>`(select h.changes from ${cardExpenseHistory} h where h.expense_id = ${cardExpenses.id} and h.position = 0)`,
    n: sql<number>`(select count(*)::int from ${cardExpenseHistory} h where h.expense_id = ${cardExpenses.id})`
  }).from(cardExpenses).innerJoin(companyCards, eq(companyCards.id, cardExpenses.cardId)).where(eq(companyCards.issuer, 'amex'));

  const plan: RemoveBeforePlan = {
    before, file, imports: fileImports.map(i => ({ id: i.id, fileName: i.fileName, lines: i.lines })),
    removeLines: [...going], sharedLines: shared, expenses: [], keptReal: [], keptOther: []
  };
  for (const r of rows) {
    const day = String(r.day);
    const brief: Row = { id: r.id, holderName: r.holderName, merchant: r.merchant, day, cents: Number(r.cents), status: r.status };
    const noReceipt = !r.receiptUrl && !r.lostReason;
    const backfill = r.status === 'approved' && noReceipt && !r.voidedAt && r.firstAction === 'added' && String(r.firstChanges ?? '').startsWith(BACKFILL_NOTE);
    const placeholderMissing = r.status === 'missing' && noReceipt && !r.voidedAt && r.n <= 1;
    const keptByLine = pointedByKept.has(r.id);
    if (backfill || placeholderMissing) {
      if (day < before && !keptByLine) { plan.expenses.push({ ...brief, why: `dated before ${before}` }); continue; }
      if (day < before && keptByLine) { plan.keptOther.push(brief); continue; }
      if (backfill && !keptByLine) { plan.expenses.push({ ...brief, why: 'backfill row no remaining line points at' }); continue; }
      if (placeholderMissing && pointedByGoing.has(r.id) && !keptByLine) { plan.expenses.push({ ...brief, why: 'its line goes with the removed report' }); continue; }
      continue;
    }
    if (day < before) (noReceipt ? plan.keptOther : plan.keptReal).push(brief);
  }
  return plan;
}

export async function applyRemoveBefore(db: Db, opts: { before: string; file?: string }, reason: string, by = 'script'): Promise<RemoveBeforePlan> {
  return db.transaction(async (tx: Db) => {
    const plan = await planRemoveBefore(tx, opts);
    // Expenses first: saved whole, lines unlinked, then deleted (their history goes with them).
    for (const e of plan.expenses) {
      const existing = await findExpense(tx, e.id);
      if (!existing) continue;
      await tx.insert(cardExpenseDeletions).values({ expenseId: e.id, expense: JSON.parse(JSON.stringify(existing)), deletedBy: by, reason }).onConflictDoNothing();
    }
    for (const part of chunks(plan.expenses.map(e => e.id))) {
      await tx.update(lines).set({ expenseId: null, updatedAt: new Date() }).where(inArray(lines.expenseId, part));
      await tx.delete(cardExpenses).where(and(inArray(cardExpenses.id, part), sql`${cardExpenses.status} in ('approved', 'missing')`));
    }
    // Lines the file's uploads share with another upload: point them at the one that stays.
    const ids = new Set(plan.imports.map(i => i.id));
    for (const part of chunks(plan.sharedLines)) {
      for (const l of await tx.select().from(lines).where(inArray(lines.reference, part))) {
        const first = ids.has(l.firstImportId) ? l.lastImportId : l.firstImportId;
        const last = ids.has(l.lastImportId) ? l.firstImportId : l.lastImportId;
        await tx.update(lines).set({ firstImportId: first, lastImportId: last }).where(eq(lines.reference, l.reference));
      }
    }
    for (const part of chunks(plan.removeLines)) await tx.delete(lines).where(inArray(lines.reference, part));
    if (plan.imports.length) await tx.delete(imports).where(inArray(imports.id, plan.imports.map(i => i.id)));
    return plan;
  });
}
