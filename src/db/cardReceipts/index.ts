/**
 * Credit Card Receipts' data layer: the route reads and writes cards, categories and expenses
 * through these, and each picks MongoDB or Postgres by the area's switch (`DB_CARD_RECEIPTS`,
 * src/db/appDb.ts). Both answer the same (cardReceipts.parity.test.ts). Users and Roles are not
 * here: they stay on MongoDB until the Users area moves.
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { Loose } from '../../types/records.ts';
import type { ExpenseFilter, ExpenseHistoryEntry } from './types.ts';

export type { ExpenseFilter, ExpenseHistoryEntry } from './types.ts';

const onPostgres = () => areaOn('card_receipts') === 'postgres';

// Categories
export const listCategories = async () => onPostgres() ? pg.listCategories(await appDb()) : mongo.listCategories();
export const seedCategories = async (docs: Loose[]) => onPostgres() ? pg.seedCategories(await appDb(), docs) : mongo.seedCategories(docs);
export const findCategory = async (id: string) => onPostgres() ? pg.findCategory(await appDb(), id) : mongo.findCategory(id);
export const addCategory = async (id: string, value: Loose) => onPostgres() ? pg.addCategory(await appDb(), id, value) : mongo.addCategory(id, value);
export const changeCategory = async (id: string, set: Loose) => onPostgres() ? pg.changeCategory(await appDb(), id, set) : mongo.changeCategory(id, set);
export const categoryIds = async () => onPostgres() ? pg.categoryIds(await appDb()) : mongo.categoryIds();
export const reorderCategories = async (ids: string[]) => onPostgres() ? pg.reorderCategories(await appDb(), ids) : mongo.reorderCategories(ids);
export const categoryUses = async (name: string) => onPostgres() ? pg.categoryUses(await appDb(), name) : mongo.categoryUses(name);
export const deleteCategory = async (id: string, name: string, move: { to: string; entry: ExpenseHistoryEntry } | null) =>
  onPostgres() ? pg.deleteCategory(await appDb(), id, name, move) : mongo.deleteCategory(id, name, move);

// Cards
export const listCards = async () => onPostgres() ? pg.listCards(await appDb()) : mongo.listCards();
export const findCard = async (id: string) => onPostgres() ? pg.findCard(await appDb(), id) : mongo.findCard(id);
export const activeCardOf = async (userId: string) => onPostgres() ? pg.activeCardOf(await appDb(), userId) : mongo.activeCardOf(userId);
export const activeCardClash = async (userId: string, label: string, exceptId: string | null) =>
  onPostgres() ? pg.activeCardClash(await appDb(), userId, label, exceptId) : mongo.activeCardClash(userId, label, exceptId);
export const addCard = async (id: string, value: Loose) => onPostgres() ? pg.addCard(await appDb(), id, value) : mongo.addCard(id, value);
export const changeCard = async (id: string, set: Loose) => onPostgres() ? pg.changeCard(await appDb(), id, set) : mongo.changeCard(id, set);

// Expenses
export const listExpenses = async (filter: ExpenseFilter) => onPostgres() ? pg.listExpenses(await appDb(), filter) : mongo.listExpenses(filter);
export const findExpense = async (id: string) => onPostgres() ? pg.findExpense(await appDb(), id) : mongo.findExpense(id);
export const findExpenseByReceipt = async (receiptUrl: string) => onPostgres() ? pg.findExpenseByReceipt(await appDb(), receiptUrl) : mongo.findExpenseByReceipt(receiptUrl);
export const sameDayAmount = async (userId: string, date: string, cents: number) =>
  onPostgres() ? pg.sameDayAmount(await appDb(), userId, date, cents) : mongo.sameDayAmount(userId, date, cents);
export const addExpense = async (id: string, doc: Loose) => onPostgres() ? pg.addExpense(await appDb(), id, doc) : mongo.addExpense(id, doc);
export const changeExpense = async (id: string, set: Loose, entry: ExpenseHistoryEntry) =>
  onPostgres() ? pg.changeExpense(await appDb(), id, set, entry) : mongo.changeExpense(id, set, entry);
