/**
 * Card receipt reminders' reads and the one write (src/utils/receiptReminders.ts), on whichever database the
 * area is on (`DB_CARD_RECEIPTS`, like ./index.ts). `markReminded` records a reminder on the receipt and adds one
 * history line **without moving `updatedAt`**, so an approver who has the receipt open is never told it changed.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import mongoose from 'mongoose';
import { appDb, areaOn } from '../appDb.ts';
import type { Db } from '../copy/plan.ts';
import { cardExpenses, cardExpenseHistory, companyCards } from '../schema/cardsSuppliers.ts';
import { locations } from '../schema/reference.ts';
import { CardExpense } from '../../models/CardReceipts.ts';
import { expenseDoc } from './cardDocs.ts';
import type { Loose } from '../../types/records.ts';

/** A history line a reminder leaves: `{by} {action}: {changes}`. */
export type ReminderHistoryEntry = { at: Date; by: string; action: string; changes: string };
/**
 * Write only while `reminders[key]` is unset (no `value`), or isn't `value` — so two runs or two clicks can't
 * both send. Answers false when the guard stopped it.
 */
export type ReminderGuard = { key: string; value?: string };

const onPostgres = () => areaOn('card_receipts') === 'postgres';
const hexIds = (ids: readonly string[]) => [...new Set(ids.map((i) => String(i).toLowerCase()).filter((i) => /^[0-9a-f]{24}$/.test(i)))];
const KEY = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

/* ---- Postgres ---- */

const selectExpenses = (db: Db) => db.select({ e: cardExpenses, locationName: sql<string | null>`coalesce(${locations.name}, nullif(${companyCards.location}, ''))` })
  .from(cardExpenses).leftJoin(locations, eq(locations.id, cardExpenses.locationId))
  .leftJoin(companyCards, eq(companyCards.id, cardExpenses.cardId));

export async function pgListMissing(db: Db): Promise<Loose[]> {
  const rows = await selectExpenses(db).where(and(eq(cardExpenses.status, 'missing'), isNull(cardExpenses.voidedAt), sql`${cardExpenses.userId} is not null`));
  return rows.map((r) => expenseDoc(r.e, r.locationName, []));
}

export async function pgListByIds(db: Db, ids: readonly string[]): Promise<Loose[]> {
  const list = hexIds(ids);
  if (!list.length) return [];
  const rows = await selectExpenses(db).where(inArray(cardExpenses.id, list));
  return rows.map((r) => expenseDoc(r.e, r.locationName, []));
}

export async function pgMarkReminded(db: Db, id: string, patch: Record<string, string>, entry: ReminderHistoryEntry, guard?: ReminderGuard): Promise<boolean> {
  if (guard && !KEY.test(guard.key)) throw new Error('Bad reminder key.');
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const guardSql = !guard ? undefined
      : guard.value == null ? sql`${cardExpenses.reminders} ->> ${guard.key} is null`
        : sql`(${cardExpenses.reminders} ->> ${guard.key}) is distinct from ${guard.value}`;
    // The row first (it takes the row lock, so an edit running now finishes before the history line goes in).
    const changed = await t.update(cardExpenses)
      .set({ reminders: sql`coalesce(${cardExpenses.reminders}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` })
      .where(and(eq(cardExpenses.id, id.toLowerCase()), guardSql))
      .returning({ id: cardExpenses.id });
    if (!changed.length) return false;
    const [last] = await t.select({ n: sql<number>`coalesce(max(${cardExpenseHistory.position}), -1)::int` }).from(cardExpenseHistory)
      .where(eq(cardExpenseHistory.expenseId, id.toLowerCase()));
    await t.insert(cardExpenseHistory).values({
      expenseId: id.toLowerCase(), position: (last?.n ?? -1) + 1, at: entry.at, by: entry.by, action: entry.action, changes: entry.changes
    });
    return true;
  });
}

/* ---- MongoDB ---- */

const mongoListMissing = async () =>
  (await CardExpense.find({ status: 'missing', voidedAt: null, userId: { $nin: [null, ''] } }).lean()) as unknown as Loose[];

const mongoListByIds = async (ids: readonly string[]) => {
  const list = hexIds(ids).filter((i) => mongoose.isValidObjectId(i));
  return list.length ? (await CardExpense.find({ _id: { $in: list } }).lean()) as unknown as Loose[] : [];
};

async function mongoMarkReminded(id: string, patch: Record<string, string>, entry: ReminderHistoryEntry, guard?: ReminderGuard): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  if (guard && !KEY.test(guard.key)) throw new Error('Bad reminder key.');
  const set = Object.fromEntries(Object.entries(patch).filter(([k]) => KEY.test(k)).map(([k, v]) => [`reminders.${k}`, v]));
  const filter: Record<string, unknown> = { _id: id };
  if (guard) filter[`reminders.${guard.key}`] = guard.value == null ? null : { $ne: guard.value };
  // A record saved before `reminders` existed may hold null there: give it an object first.
  await CardExpense.updateOne({ _id: id, reminders: null }, { $set: { reminders: {} } }, { timestamps: false });
  const res = await CardExpense.updateOne(filter, { $set: set, $push: { history: entry } }, { timestamps: false });
  return res.modifiedCount > 0;
}

/* ---- Either ---- */

/** Every Missing-receipt row that isn't voided and has a cardholder (the hourly job). */
export const listMissingForReminders = async (): Promise<Loose[]> => (onPostgres() ? pgListMissing(await appDb()) : mongoListMissing());
/** These receipts (unknown ids are left out). */
export const listByIds = async (ids: readonly string[]): Promise<Loose[]> => (onPostgres() ? pgListByIds(await appDb(), ids) : mongoListByIds(ids));
/** Merge `patch` into the receipt's `reminders` and add one history line, `updatedAt` untouched. False when `guard` stopped it. */
export const markReminded = async (id: string, patch: Record<string, string>, entry: ReminderHistoryEntry, guard?: ReminderGuard): Promise<boolean> =>
  (onPostgres() ? pgMarkReminded(await appDb(), id, patch, entry, guard) : mongoMarkReminded(id, patch, entry, guard));
