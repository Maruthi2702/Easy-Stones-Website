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
import { cardExpenses, cardExpenseHistory, cardExpenseDeletions } from '../schema/cardsSuppliers.ts';
import { findExpense, restoreExpenseDoc } from '../cardReceipts/postgres.ts';
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

/**
 * The Missing receipt rows a removed upload left behind (2026-11-24): still Missing, no receipt, never edited
 * (one history line, "Missing receipt: … charge …"), and no statement line points at them any more.
 */
export async function planOrphanMissingRows(db: Db) {
  const rows = await db.select({
    id: cardExpenses.id, holderName: cardExpenses.holderName, cardLabel: cardExpenses.cardLabel, day: cardExpenses.day, cents: cardExpenses.cents,
    createdBy: cardExpenseHistory.by, changes: cardExpenseHistory.changes
  }).from(cardExpenses)
    .innerJoin(cardExpenseHistory, and(eq(cardExpenseHistory.expenseId, cardExpenses.id), eq(cardExpenseHistory.position, 0)))
    .where(and(
      eq(cardExpenses.status, 'missing'), sql`${cardExpenses.voidedAt} is null`, eq(cardExpenses.receiptUrl, ''), eq(cardExpenses.lostReason, ''),
      eq(cardExpenseHistory.action, 'added'), sql`${cardExpenseHistory.changes} like 'Missing receipt: %charge %'`,
      sql`(select count(*) from ${cardExpenseHistory} x where x.expense_id = ${cardExpenses.id}) = 1`,
      sql`not exists (select 1 from ${lines} l where l.expense_id = ${cardExpenses.id})`
    ));
  return rows;
}

export async function applyOrphanMissingRows(db: Db) {
  return db.transaction(async (tx: Db) => {
    const rows = await planOrphanMissingRows(tx);
    for (const part of chunks(rows.map(r => r.id))) {
      await tx.delete(cardExpenses).where(and(inArray(cardExpenses.id, part), eq(cardExpenses.status, 'missing')));
    }
    return rows;
  });
}

/**
 * Receipts by anyone but the people to keep (2026-11-24, owner's ask): every expense that was **not** made by one of
 * `keep` (matched on a whole word of the name it was created under, so "krish" keeps "Krish" but not "Krishna") and is not
 * Approved. Approved ones are never touched; a row with no creator name is listed and left alone.
 * Each deleted receipt is saved whole to `card_expense_deletions` first (the same record the app's own Delete writes),
 * and a statement line that pointed at it is unlinked. Receipt files in storage are not removed.
 */
export interface PrunePlan {
  /** Expenses that go. */
  remove: { id: string; createdBy: string; holderName: string; status: string; day: string; cents: number; merchant: string; onStatement: boolean }[];
  keptByName: number;
  keptApproved: number;
  noCreator: number;
  /** Left because the run was limited to one status. */
  keptOtherStatus: number;
}

const words = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export const isKeptName = (createdBy: string, keep: string[]) => {
  const have = new Set(words(createdBy));
  return keep.some(k => words(k).length > 0 && words(k).every(w => have.has(w)));
};

/**
 * `mode` 'keep' (default): delete everyone's but `names`. 'delete': delete only the ones made by `names` (owner, 2026-11-24:
 * the rows Krish and Karunakar made while testing). Approved are never deleted either way.
 */
export type PruneMode = 'keep' | 'delete';

export async function planPrune(db: Db, keep: string[], mode: PruneMode = 'keep', onlyStatus = ''): Promise<PrunePlan> {
  if (!keep.length) throw new Error('Say whose receipts.');
  const rows = await db.select({
    id: cardExpenses.id, createdBy: cardExpenses.createdBy, holderName: cardExpenses.holderName, status: cardExpenses.status,
    day: cardExpenses.day, cents: cardExpenses.cents, merchant: cardExpenses.merchant,
    onStatement: sql<boolean>`exists (select 1 from ${lines} l where l.expense_id = ${cardExpenses.id})`
  }).from(cardExpenses);
  const plan: PrunePlan = { remove: [], keptByName: 0, keptApproved: 0, noCreator: 0, keptOtherStatus: 0 };
  for (const r of rows) {
    if (r.status === 'approved') plan.keptApproved += 1;
    else if (!r.createdBy.trim()) plan.noCreator += 1;
    else if (isKeptName(r.createdBy, keep) === (mode === 'keep')) plan.keptByName += 1;
    else if (onlyStatus && r.status !== onlyStatus) plan.keptOtherStatus += 1;
    else plan.remove.push({ ...r, day: String(r.day) });
  }
  return plan;
}

export async function applyPrune(db: Db, keep: string[], reason: string, by = 'script', mode: PruneMode = 'keep', onlyStatus = ''): Promise<PrunePlan> {
  return db.transaction(async (tx: Db) => {
    const plan = await planPrune(tx, keep, mode, onlyStatus);
    for (const r of plan.remove) {
      const existing = await findExpense(tx, r.id);
      if (!existing) continue;
      await tx.insert(cardExpenseDeletions).values({ expenseId: r.id, expense: JSON.parse(JSON.stringify(existing)), deletedBy: by, reason }).onConflictDoNothing();
    }
    const ids = plan.remove.map(r => r.id);
    for (const part of chunks(ids)) {
      await tx.update(lines).set({ expenseId: null, updatedAt: new Date() }).where(inArray(lines.expenseId, part));
      await tx.delete(cardExpenses).where(and(inArray(cardExpenses.id, part), sql`${cardExpenses.status} <> 'approved'`));
    }
    return plan;
  });
}

/**
 * Bringing back receipts a cleanup deleted (2026-11-24): the ones `applyPrune` saved to `card_expense_deletions`
 * (deleted by 'script', reason "Cleanup 2026-11-24…"), limited to one status. Each is put back as it was with a
 * "restored" history line, and a statement line named in its first history line ("… charge <reference>") that
 * nothing points at is pointed at it again, so the next check doesn't make a second row for the charge.
 */
export const CLEANUP_REASON = 'Cleanup 2026-11-24';

type Stored = Record<string, any>;

export async function planRestore(db: Db, status: string) {
  const rows = await db.select().from(cardExpenseDeletions)
    .where(and(eq(cardExpenseDeletions.deletedBy, 'script'), sql`${cardExpenseDeletions.reason} like ${CLEANUP_REASON + '%'}`));
  return rows.filter(r => (r.expense as Stored).status === status).map(r => {
    const e = r.expense as Stored;
    return {
      id: r.expenseId, holderName: String(e.holderName ?? ''), merchant: String(e.merchant ?? ''), day: String(e.date ?? ''), cents: Number(e.cents ?? 0),
      status: String(e.status), createdBy: String(e.createdBy ?? ''), hasReceipt: Boolean(e.receiptUrl), expense: e
    };
  });
}

export async function applyRestore(db: Db, status: string, by = 'script') {
  const found = await planRestore(db, status);
  const done: { id: string; relinked: string }[] = [];
  const skipped: string[] = [];
  for (const f of found) {
    const back = await restoreExpenseDoc(db, f.expense, 'Restored: a cleanup deleted it by mistake', by);
    if (!back) { skipped.push(f.id); continue; }
    const reference = /charge ([^\s)]+)/.exec(String(f.expense.history?.[0]?.changes ?? ''))?.[1] ?? '';
    let relinked = '';
    if (reference) {
      const res = await db.update(lines).set({ expenseId: f.id, updatedAt: new Date() })
        .where(and(eq(lines.reference, reference), sql`${lines.expenseId} is null`)).returning({ reference: lines.reference });
      relinked = res[0]?.reference ?? '';
    }
    done.push({ id: f.id, relinked });
  }
  return { found, done, skipped };
}
