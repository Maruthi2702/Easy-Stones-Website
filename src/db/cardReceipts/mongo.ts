/** Credit Card Receipts on MongoDB — the route's own Mongoose calls, moved here unchanged. */
import { CompanyCard, ReceiptCategory, CardExpense } from '../../models/CardReceipts.ts';
import type { Loose } from '../../types/records.ts';
import { StaleExpenseError, EXPENSE_LIST_CAP } from './types.ts';
import type { ExpenseFilter, ExpenseHistoryEntry } from './types.ts';

const lean = <T>(q: PromiseLike<unknown>) => q as unknown as Promise<T>;
const duplicate = (error: unknown) => (error as { code?: number }).code === 11000;

/* ---- Categories ---- */

export const listCategories = () => lean<Loose[]>(ReceiptCategory.find({}).sort({ order: 1, _id: 1 }).lean());

/** Fill an EMPTY list once; a second writer's duplicates are ignored. */
export async function seedCategories(docs: Loose[]): Promise<void> {
  await ReceiptCategory.insertMany(docs, { ordered: false }).catch(() => undefined);
}

export const findCategory = (id: string) => lean<Loose | null>(ReceiptCategory.findById(id).lean());

export async function addCategory(id: string, value: Loose): Promise<Loose> {
  return (await ReceiptCategory.create({ _id: id, ...value })).toObject() as unknown as Loose;
}

export async function changeCategory(id: string, set: Loose): Promise<Loose | null> {
  const category = await ReceiptCategory.findById(id);
  if (!category) return null;
  category.set(set);
  await category.save();
  return category.toObject() as unknown as Loose;
}

export const categoryIds = async () => (await ReceiptCategory.find({}, '_id').lean()).map(c => String(c._id));

export async function reorderCategories(ids: string[]): Promise<void> {
  await ReceiptCategory.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: i } } } })));
}

export const approvedInCategory = (name: string) => lean<Loose[]>(CardExpense.find({ category: name, status: 'approved' }).lean());
export const categoryUses = (name: string) => CardExpense.countDocuments({ category: name });

/** Move the expenses first (a stop in between leaves nothing lost), then delete the category. */
export async function deleteCategory(id: string, name: string, move: { to: string; entry: ExpenseHistoryEntry } | null): Promise<void> {
  if (move) await CardExpense.updateMany({ category: name }, { $set: { category: move.to, subcategory: '' }, $push: { history: move.entry } });
  await ReceiptCategory.deleteOne({ _id: id });
}

/* ---- Cards ---- */

export const listCards = () => lean<Loose[]>(CompanyCard.find({}).sort({ active: -1, label: 1 }).lean());
export const findCard = (id: string) => lean<Loose | null>(CompanyCard.findById(id).lean());
export const activeCardOf = (userId: string) => lean<Loose | null>(CompanyCard.findOne({ userId, active: true }).lean());

/** Another active card held by this person or with this ID (`exceptId` = the card being saved). */
export const activeCardClash = (userId: string, label: string, exceptId: string | null) =>
  lean<Loose | null>(CompanyCard.findOne({ active: true, _id: { $ne: exceptId }, $or: [{ userId }, { label }] }).lean());

/** Any card, active or not, with this ID (`exceptId` = the card being saved): a card ID is never used twice. */
export const cardWithLabel = (label: string, exceptId: string | null) =>
  lean<Loose | null>(CompanyCard.findOne({ label, _id: { $ne: exceptId } }).sort({ active: -1 }).lean());

export async function addCard(id: string, value: Loose): Promise<Loose> {
  return (await CompanyCard.create({ _id: id, ...value })).toObject() as unknown as Loose;
}

/** Change a card; null when it is gone. */
export async function changeCard(id: string, set: Loose): Promise<Loose | null> {
  const card = await CompanyCard.findById(id);
  if (!card) return null;
  card.set(set);
  await card.save();
  return card.toObject() as unknown as Loose;
}

/* ---- Expenses ---- */

export function listExpenses(filter: ExpenseFilter): Promise<Loose[]> {
  const where: Record<string, unknown> = filter.kind === 'waiting'
    ? { status: 'waiting', voidedAt: null, $or: [{ userId: { $in: [...filter.userIds] } }, ...(filter.overCents != null ? [{ cents: { $gt: filter.overCents } }] : [])] }
    : { month: filter.month, ...(filter.userId ? { userId: filter.userId } : {}), ...(filter.userIds ? { userId: { $in: [...filter.userIds] } } : {}) };
  // `_id` last: two receipts of one day and moment keep a fixed order (it was arbitrary).
  return lean<Loose[]>(CardExpense.find(where).sort({ date: -1, createdAt: -1, _id: -1 }).limit(EXPENSE_LIST_CAP).lean());
}

export const findExpense = (id: string) => lean<Loose | null>(CardExpense.findById(id).lean());

/** The expense a saved receipt file belongs to (its `receiptUrl`), newest first, or null. */
export const findExpenseByReceipt = (receiptUrl: string) => lean<Loose | null>(CardExpense.findOne({ receiptUrl }).sort({ createdAt: -1 }).lean());

/** The caller's live (not voided) expenses on that day for that amount: a possible repeat. */
export const sameDayAmount = (userId: string, date: string, cents: number) =>
  lean<Loose[]>(CardExpense.find({ userId, date, cents, voidedAt: null }).lean());

/** Add one expense; null when that id is already taken (a repeat of the same save). */
export async function addExpense(id: string, fullDoc: Loose): Promise<Loose | null> {
  const { repeatCheck: _repeatCheck, ...doc } = fullDoc; // the duplicate check under a lock is the Postgres path's
  try {
    return (await CardExpense.create({ _id: id, ...doc })).toObject() as unknown as Loose;
  } catch (error) {
    if (duplicate(error)) return null;
    throw error;
  }
}

/** Change an expense and keep the line in its history; null if it is gone. */
export async function changeExpense(id: string, set: Loose, fullEntry: ExpenseHistoryEntry): Promise<Loose | null> {
  const { expectedUpdatedAt, ...entry } = fullEntry;
  const expense = await CardExpense.findById(id);
  if (!expense) return null;
  // Best effort on MongoDB (read then save, no row lock); the Postgres path is the atomic one.
  if (expectedUpdatedAt != null && new Date(expectedUpdatedAt).getTime() !== new Date(expense.updatedAt as unknown as Date).getTime()) throw new StaleExpenseError();
  expense.set(set);
  expense.history.push(entry);
  await expense.save();
  return expense.toObject() as unknown as Loose;
}
