/**
 * Credit Card Receipts on Postgres, answering in MongoDB's shape (cardDocs.ts). A save builds
 * the record as MongoDB would hold it, then makes its rows with the copy's own builders
 * (companyCardRowOf, receiptCategoryRowOf, cardExpenseRowsOf), so it writes what a re-copy
 * of MongoDB would.
 */
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { companyCards, receiptCategories, cardExpenses, cardExpenseHistory } from '../schema/cardsSuppliers.ts';
import { locations } from '../schema/reference.ts';
import { customers } from '../schema/customers.ts';
import { companyCardRowOf, receiptCategoryRowOf, cardExpenseRowsOf } from '../copy/cardsSuppliersRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import { cardDoc, categoryDoc, expenseDoc } from './cardDocs.ts';
import type { Loose } from '../../types/records.ts';
import type { ExpenseFilter, ExpenseHistoryEntry } from './types.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;
const q = (c: Conn) => c as Db;
const lower = (id: string) => String(id).toLowerCase();

/* ---- Categories ---- */

export async function listCategories(db: Db): Promise<Loose[]> {
  return (await db.select().from(receiptCategories).orderBy(asc(receiptCategories.order), asc(receiptCategories.id))).map(categoryDoc);
}

export async function seedCategories(db: Db, docs: Loose[]): Promise<void> {
  const now = new Date();
  const rows = docs.map(d => receiptCategoryRowOf({ createdAt: now, updatedAt: now, ...d }, [])!);
  if (rows.length) await db.insert(receiptCategories).values(rows).onConflictDoNothing();
}

export async function findCategory(db: Db, id: string): Promise<Loose | null> {
  const [row] = await db.select().from(receiptCategories).where(eq(receiptCategories.id, lower(id)));
  return row ? categoryDoc(row) : null;
}

export async function addCategory(db: Db, id: string, value: Loose): Promise<Loose> {
  const now = new Date();
  const row = receiptCategoryRowOf({ _id: id, order: 0, active: true, ...value, createdAt: now, updatedAt: now }, []);
  if (!row) throw new Error('That category can’t be stored.');
  await db.insert(receiptCategories).values(row);
  return (await findCategory(db, row.id))!;
}

export async function changeCategory(db: Db, id: string, set: Loose): Promise<Loose | null> {
  return db.transaction(async tx => {
    const [found] = await tx.select().from(receiptCategories).where(eq(receiptCategories.id, lower(id))).for('update');
    if (!found) return null;
    const row = receiptCategoryRowOf({ ...categoryDoc(found), ...set, updatedAt: new Date() }, []);
    if (!row) throw new Error('That category can’t be stored.');
    const { id: _id, createdAt: _created, ...columns } = row;
    await tx.update(receiptCategories).set(columns).where(eq(receiptCategories.id, found.id));
    return (await findCategory(tx as unknown as Db, found.id))!;
  });
}

export async function categoryIds(db: Db): Promise<string[]> {
  return (await db.select({ id: receiptCategories.id }).from(receiptCategories)).map(r => r.id);
}

export async function reorderCategories(db: Db, ids: string[]): Promise<void> {
  await db.transaction(async tx => {
    const now = new Date();
    for (const [i, id] of ids.entries()) await tx.update(receiptCategories).set({ order: i, updatedAt: now }).where(eq(receiptCategories.id, lower(id)));
  });
}

export async function categoryUses(db: Db, name: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(cardExpenses).where(eq(cardExpenses.category, name));
  return row?.n ?? 0;
}

export async function deleteCategory(db: Db, id: string, name: string, move: { to: string; entry: ExpenseHistoryEntry } | null): Promise<void> {
  await db.transaction(async tx => {
    if (move) {
      const moved = await tx.select({ id: cardExpenses.id }).from(cardExpenses).where(eq(cardExpenses.category, name)).for('update');
      if (moved.length) {
        const ids = moved.map(m => m.id);
        const counts = await tx.select({ id: cardExpenseHistory.expenseId, n: sql<number>`count(*)::int` }).from(cardExpenseHistory)
          .where(inArray(cardExpenseHistory.expenseId, ids)).groupBy(cardExpenseHistory.expenseId);
        const next = new Map(counts.map(c => [c.id, c.n]));
        await tx.update(cardExpenses).set({ category: move.to, subcategory: '', updatedAt: new Date() }).where(inArray(cardExpenses.id, ids));
        await tx.insert(cardExpenseHistory).values(ids.map(expenseId => ({
          expenseId, position: next.get(expenseId) ?? 0, at: move.entry.at, by: move.entry.by, action: move.entry.action, changes: move.entry.changes ?? ''
        })));
      }
    }
    await tx.delete(receiptCategories).where(eq(receiptCategories.id, lower(id)));
  });
}

/* ---- Cards ---- */

export async function listCards(db: Db): Promise<Loose[]> {
  return (await db.select().from(companyCards)
    .orderBy(desc(companyCards.active), sql`${companyCards.label} collate "C"`, asc(companyCards.id))).map(cardDoc);
}

export async function findCard(db: Db, id: string): Promise<Loose | null> {
  const [row] = await db.select().from(companyCards).where(eq(companyCards.id, lower(id)));
  return row ? cardDoc(row) : null;
}

export async function activeCardOf(db: Db, userId: string): Promise<Loose | null> {
  const [row] = await db.select().from(companyCards).where(and(eq(companyCards.userId, lower(userId)), eq(companyCards.active, true)));
  return row ? cardDoc(row) : null;
}

export async function activeCardClash(db: Db, userId: string, label: string, exceptId: string | null): Promise<Loose | null> {
  const [row] = await db.select().from(companyCards).where(and(
    eq(companyCards.active, true), exceptId ? ne(companyCards.id, lower(exceptId)) : undefined,
    or(eq(companyCards.userId, lower(userId)), eq(companyCards.label, label))));
  return row ? cardDoc(row) : null;
}

export async function addCard(db: Db, id: string, value: Loose): Promise<Loose> {
  return db.transaction(async tx => {
    const now = new Date();
    const row = companyCardRowOf({ _id: id, issuer: 'amex', active: true, ...value, createdAt: now, updatedAt: now }, await referenceIndexOf(tx as unknown as Db), []);
    if (!row) throw new Error('That card can’t be stored: the cardholder is not in Postgres yet.');
    await tx.insert(companyCards).values(row);
    return (await findCard(tx as unknown as Db, row.id))!;
  });
}

export async function changeCard(db: Db, id: string, set: Loose): Promise<Loose | null> {
  return db.transaction(async tx => {
    const [found] = await tx.select().from(companyCards).where(eq(companyCards.id, lower(id))).for('update');
    if (!found) return null;
    const row = companyCardRowOf({ ...cardDoc(found), ...set, updatedAt: new Date() }, await referenceIndexOf(tx as unknown as Db), []);
    if (!row) throw new Error('That card can’t be stored: the cardholder is not in Postgres yet.');
    const { id: _id, createdAt: _created, ...columns } = row;
    await tx.update(companyCards).set(columns).where(eq(companyCards.id, found.id));
    return (await findCard(tx as unknown as Db, found.id))!;
  });
}

/* ---- Expenses ---- */

const selectExpenses = (c: Conn) => q(c).select({ e: cardExpenses, locationName: locations.name })
  .from(cardExpenses).leftJoin(locations, eq(locations.id, cardExpenses.locationId));

async function withHistory(c: Conn, rows: { e: typeof cardExpenses.$inferSelect; locationName: string | null }[]): Promise<Loose[]> {
  if (!rows.length) return [];
  const lines = await q(c).select().from(cardExpenseHistory).where(inArray(cardExpenseHistory.expenseId, rows.map(r => r.e.id)));
  return rows.map(r => expenseDoc(r.e, r.locationName, lines.filter(l => l.expenseId === r.e.id)));
}

export async function listExpenses(db: Db, filter: ExpenseFilter): Promise<Loose[]> {
  if (filter.kind === 'waiting' && !filter.userIds.length && filter.overCents == null) return [];
  const where = filter.kind === 'waiting'
    ? and(eq(cardExpenses.status, 'waiting'), isNull(cardExpenses.voidedAt), or(filter.userIds.length ? inArray(cardExpenses.userId, filter.userIds.map(lower)) : undefined, filter.overCents != null ? gt(cardExpenses.cents, filter.overCents) : undefined))
    : and(eq(cardExpenses.month, filter.month), filter.userId ? eq(cardExpenses.userId, lower(filter.userId)) : undefined);
  const rows = await selectExpenses(db).where(where).orderBy(desc(cardExpenses.day), desc(cardExpenses.createdAt), desc(cardExpenses.id)).limit(5000);
  return withHistory(db, rows);
}

export async function findExpense(db: Db, id: string): Promise<Loose | null> {
  return (await withHistory(db, await selectExpenses(db).where(eq(cardExpenses.id, lower(id)))))[0] ?? null;
}

export async function sameDayAmount(db: Db, userId: string, date: string, cents: number): Promise<Loose[]> {
  return withHistory(db, await selectExpenses(db).where(and(
    eq(cardExpenses.userId, lower(userId)), eq(cardExpenses.day, date), eq(cardExpenses.cents, cents), isNull(cardExpenses.voidedAt))));
}

/** Rows for an expense as MongoDB would hold it; a card, category or customer that doesn't exist keeps no link. */
async function rowsFor(tx: Conn, doc: Loose) {
  const ref = await referenceIndexOf(q(tx));
  const hex = (v: unknown) => (typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v) ? v.toLowerCase() : null);
  const [cardId, customerId] = [hex(doc.cardId), hex(doc.customerId)];
  const [cards, cats, custs] = await Promise.all([
    cardId ? q(tx).select({ id: companyCards.id }).from(companyCards).where(eq(companyCards.id, cardId)) : [],
    doc.category ? q(tx).select({ name: receiptCategories.name }).from(receiptCategories).where(eq(receiptCategories.name, String(doc.category))) : [],
    customerId ? q(tx).select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)) : []
  ]);
  const built = cardExpenseRowsOf(doc, ref, {
    cardIds: new Set(cards.map(c => c.id)), categoryNames: new Set(cats.map(c => c.name)), customerIds: new Set(custs.map(c => c.id))
  }, []);
  if (!built) throw new Error('That receipt can’t be stored: it has no day, amount or status.');
  return built;
}

export async function addExpense(db: Db, id: string, value: Loose): Promise<Loose | null> {
  return db.transaction(async tx => {
    const [taken] = await tx.select({ id: cardExpenses.id }).from(cardExpenses).where(eq(cardExpenses.id, lower(id)));
    if (taken) return null;
    const now = new Date();
    const { history = [], ...rest } = value;
    const built = await rowsFor(tx, { _id: lower(id), voidedAt: null, ...rest, history, createdAt: now, updatedAt: now });
    await tx.insert(cardExpenses).values(built.expense);
    if (built.history.length) await tx.insert(cardExpenseHistory).values(built.history);
    return (await findExpense(tx as unknown as Db, built.expense.id))!;
  });
}

export async function changeExpense(db: Db, id: string, set: Loose, entry: ExpenseHistoryEntry): Promise<Loose | null> {
  return db.transaction(async tx => {
    const [found] = await tx.select().from(cardExpenses).where(eq(cardExpenses.id, lower(id))).for('update');
    if (!found) return null;
    const existing = (await findExpense(tx as unknown as Db, found.id))!;
    const built = await rowsFor(tx, { ...existing, ...set, history: [...(existing.history as Loose[]), entry], updatedAt: new Date() });
    const { id: _id, createdAt: _created, ...columns } = built.expense;
    await tx.update(cardExpenses).set(columns).where(eq(cardExpenses.id, found.id));
    await tx.delete(cardExpenseHistory).where(eq(cardExpenseHistory.expenseId, found.id));
    if (built.history.length) await tx.insert(cardExpenseHistory).values(built.history);
    return (await findExpense(tx as unknown as Db, found.id))!;
  });
}
