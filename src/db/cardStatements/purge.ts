/**
 * Removes the Amex / Encore statement uploads one person made (2026-11-24, owner's ask): their `card_statement_imports`
 * rows and the lines those uploads brought, nothing else by default.
 *
 * - A line goes when its **first and last** upload are both theirs. A line another person's upload also carries stays
 *   (it is in their file too); its first / last import pointer is moved off the removed upload.
 * - Receipts people uploaded are never touched: a line that answered one just stops pointing at it.
 * - `missingRows` also deletes the Missing receipt rows the check made for a removed line, but only the untouched ones
 *   (status missing, no receipt, one history line). Approved "without a receipt" rows, voided rows and anything a person
 *   edited are listed and kept. Their history goes with them (cascade).
 * - Cards set up from an upload stay: a card is a person's, not a file's.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { cardStatementLines as lines, cardStatementImports as imports } from '../schema/cardStatements.ts';
import { cardExpenses, cardExpenseHistory } from '../schema/cardsSuppliers.ts';
import type { Db } from '../copy/plan.ts';

export interface PurgePlan {
  imports: { id: string; issuer: string; fileName: string; at: Date; lines: number; byName: string }[];
  /** Lines that go, by bank. */
  removeLines: string[];
  /** Lines the other people's uploads still carry. */
  keptLines: string[];
  answeredByReceipts: number;
  missingRows: { removable: string[]; keptApproved: number; keptOther: number };
}

const CHUNK = 2000;
const chunks = <T,>(a: T[]) => Array.from({ length: Math.ceil(a.length / CHUNK) }, (_, i) => a.slice(i * CHUNK, (i + 1) * CHUNK));

export async function planPurge(db: Db, by: string): Promise<PurgePlan> {
  const needle = by.trim().toLowerCase();
  if (!needle) throw new Error('Say whose uploads (a name).');
  const mine = (await db.select().from(imports)).filter(i => i.byName.toLowerCase().includes(needle) || i.byId.toLowerCase() === needle);
  const ids = mine.map(i => i.id);
  const empty: PurgePlan = { imports: [], removeLines: [], keptLines: [], answeredByReceipts: 0, missingRows: { removable: [], keptApproved: 0, keptOther: 0 } };
  if (!ids.length) return empty;
  const touched = await db.select().from(lines).where(or(inArray(lines.firstImportId, ids), inArray(lines.lastImportId, ids)));
  const own = new Set(ids);
  const removing = touched.filter(l => own.has(l.firstImportId) && own.has(l.lastImportId));
  const kept = touched.filter(l => !(own.has(l.firstImportId) && own.has(l.lastImportId)));
  const expenseIds = removing.map(l => l.expenseId).filter((x): x is string => Boolean(x));
  const rows: { id: string; status: string; voidedAt: Date | null; receiptUrl: string; lostReason: string; n: number }[] = [];
  for (const part of chunks(expenseIds)) {
    rows.push(...await db.select({
      id: cardExpenses.id, status: cardExpenses.status, voidedAt: cardExpenses.voidedAt, receiptUrl: cardExpenses.receiptUrl, lostReason: cardExpenses.lostReason,
      n: sql<number>`(select count(*)::int from ${cardExpenseHistory} h where h.expense_id = ${cardExpenses.id})`
    }).from(cardExpenses).where(inArray(cardExpenses.id, part)));
  }
  const untouchedMissing = (r: (typeof rows)[number]) => r.status === 'missing' && !r.voidedAt && !r.receiptUrl && !r.lostReason && r.n <= 1;
  return {
    imports: mine.map(i => ({ id: i.id, issuer: i.issuer, fileName: i.fileName, at: i.at, lines: i.lines, byName: i.byName })),
    removeLines: removing.map(l => l.reference),
    keptLines: kept.map(l => l.reference),
    answeredByReceipts: rows.filter(r => r.status !== 'missing' || r.voidedAt || r.receiptUrl || r.lostReason).length,
    missingRows: {
      removable: rows.filter(untouchedMissing).map(r => r.id),
      keptApproved: rows.filter(r => r.status === 'approved' && !r.receiptUrl && !r.lostReason).length,
      keptOther: rows.filter(r => !untouchedMissing(r) && !(r.status === 'approved' && !r.receiptUrl && !r.lostReason)).length
    }
  };
}

export async function applyPurge(db: Db, by: string, { missingRows = false }: { missingRows?: boolean } = {}): Promise<PurgePlan> {
  return db.transaction(async (tx: Db) => {
    const plan = await planPurge(tx, by);
    if (!plan.imports.length) return plan;
    const ids = plan.imports.map(i => i.id);
    // Lines another upload still carries: move their pointers off the removed uploads.
    for (const part of chunks(plan.keptLines)) {
      const rows = await tx.select().from(lines).where(inArray(lines.reference, part));
      for (const l of rows) {
        const first = ids.includes(l.firstImportId) ? l.lastImportId : l.firstImportId;
        const last = ids.includes(l.lastImportId) ? l.firstImportId : l.lastImportId;
        await tx.update(lines).set({ firstImportId: first, lastImportId: last }).where(eq(lines.reference, l.reference));
      }
    }
    for (const part of chunks(plan.removeLines)) await tx.delete(lines).where(inArray(lines.reference, part));
    if (missingRows) for (const part of chunks(plan.missingRows.removable)) {
      await tx.delete(cardExpenses).where(and(inArray(cardExpenses.id, part), eq(cardExpenses.status, 'missing')));
    }
    await tx.delete(imports).where(inArray(imports.id, ids));
    return plan;
  });
}
