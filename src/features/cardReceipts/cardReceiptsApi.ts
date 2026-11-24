import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { queryEntries, type ErrorBody, type Query } from '../../types/api';
import type { ExpenseInput } from '../../utils/cardReceipts';
import type { ReceiptScan } from '../../utils/receiptScan';
import type { AskTarget, Card, Category, Expense, Me, Person, RemindBody, AddableHolder, RemindPreview, RemindResult } from './types';

/**
 * Credit Card Receipts' calls to /api/card-receipts (src/routes/cardReceipts.ts).
 * Each resolves the JSON body or throws an Error whose message can be shown
 * as is; `status`, `problems` (field → message) and `repeat` ride along on it.
 */
async function call<T>(path: string, { method = 'GET', body, query }: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const qs = query ? `?${new URLSearchParams(queryEntries(query))}` : '';
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/card-receipts${path}${qs}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) })
    });
  } catch {
    throw Object.assign(new Error('Couldn’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data: ErrorBody & { problems?: unknown; repeat?: unknown; changed?: unknown } = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 409 `changed`: someone saved the receipt after this screen read it (`expectedUpdatedAt`).
    const changed = res.status === 409 && Boolean(data.changed);
    throw Object.assign(new Error(changed ? CHANGED_MESSAGE : data.message || data.error || `Something went wrong (${res.status}).`), {
      status: res.status, problems: data.problems || {}, repeat: data.repeat || null, changed
    });
  }
  return data as T;
}

export const CHANGED_MESSAGE = 'This receipt changed after you opened it. Look at it again.';
/** The error a write threw was the receipt changing under it (the screen reloads). */
export const isChanged = (err: unknown) => Boolean((err as { changed?: boolean } | null)?.changed);

export type ExpenseBody = ExpenseInput & { confirmRepeat?: boolean; /** The card it was paid with, when the person holds more than one. */ cardId?: string; /** Added for this cardholder (needs "Add receipts for others"). */ onBehalfOf?: string };
type One = { expense: Expense };
/** Every decision sends the `updatedAt` the screen saw; the server answers 409 `changed` if it moved since. */
const write = (path: string, body: Record<string, unknown>, seen?: string, method = 'POST') =>
  call<One>(path, { method, body: { ...body, expectedUpdatedAt: seen } });

export const loadMe = () => call<Me>('/me');
export const listExpenses = (scope: 'mine' | 'all' | 'waiting', month: string) =>
  call<{ expenses: Expense[] }>('/expenses', { query: scope === 'waiting' ? { scope } : { scope, month } });
/** Export all: every month for one bank ('amex' | 'encore') or both (''). Needs the Export all switch; `truncated` when the list hit its cap. */
export const listAllExpenses = (bank: string) =>
  call<{ expenses: Expense[]; truncated?: boolean }>('/expenses/export', { query: bank ? { bank } : {} });
export const addExpense =(id: string, body: ExpenseBody) => call<{ expense: Expense; alreadySaved?: boolean; replacedMissing?: string }>('/expenses', { method: 'POST', body: { id, ...body } });
export const editExpense = (id: string, body: ExpenseBody) => call<{ expense: Expense }>(`/expenses/${id}`, { method: 'PUT', body });
/** `seen`: the updatedAt the approver was looking at; the server refuses the decision if the receipt changed since. */
export const approveExpense = (id: string, comment: string, seen?: string) => write(`/expenses/${id}/approve`, { comment }, seen);
export const sendBackExpense = (id: string, comment: string, seen?: string) => write(`/expenses/${id}/send-back`, { comment }, seen);
export const voidExpense = (id: string, reason: string, seen?: string) => write(`/expenses/${id}/void`, { reason }, seen);
/** Ask the cardholder's branch manager / director or an Admin a question (5–500 characters). */
export const askAboutExpense = (id: string, to: string, question: string, seen?: string) => write(`/expenses/${id}/ask`, { to, question }, seen);
export const withdrawAsk = (id: string, seen?: string) => write(`/expenses/${id}/ask/withdraw`, {}, seen);
/** The person asked answers (2–500 characters); answering approves. */
export const answerAsk = (id: string, answer: string, seen?: string) => write(`/expenses/${id}/answer`, { answer }, seen);
/** Approved → waiting again, both approvals cleared (5–300 characters). */
export const reopenExpense = (id: string, reason: string, seen?: string) => write(`/expenses/${id}/reopen`, { reason }, seen);
/** Accounting fills in an Admin's own receipt: category, type, customer and note. */
export type DetailsBody = { category: string; subcategory: string; customerId: string; note: string };
export const fillExpenseDetails = (id: string, body: DetailsBody, seen?: string) => write(`/expenses/${id}/details`, body, seen, 'PUT');
export const askTargets = (id: string) => call<{ people: AskTarget[] }>(`/expenses/${id}/ask-targets`);
/** The hourly Missing-receipt reminders' switch (Manage cards). */
export const getAutoReminders = () => call<{ on: boolean }>('/auto-reminders');
export const setAutoReminders = (on: boolean) => call<{ on: boolean }>('/auto-reminders', { method: 'PUT', body: { on } });
/** Send reminder… about one receipt or several (src/routes/cardReceiptReminders.ts). */
export const remindExpenses = (body: RemindBody) => call<RemindResult>('/expenses/remind', { method: 'POST', body });
export const uploadReceipt = (data: string) => call<{ url: string }>('/attachments', { method: 'POST', body: { data } });
/** What Claude read off an uploaded receipt (src/routes/cardReceiptScan.ts). Throws (status 503) when reading isn't set up. */
export const scanReceipt = (url: string) => call<{ scan: ReceiptScan }>('/scan', { method: 'POST', body: { url } });

export const listCategories = () => call<{ categories: Category[] }>('/categories');
export const addCategory = (body: Pick<Category, 'label' | 'fields'> & { subcategories?: unknown[] }) => call<{ category: Category }>('/categories', { method: 'POST', body });
export const editCategory = (id: string, body: Partial<Pick<Category, 'label' | 'fields' | 'active'>> & { subcategories?: unknown[] }) => call<{ category: Category }>(`/categories/${id}`, { method: 'PUT', body });
export const reorderCategories = (ids: string[]) => call<{ categories: Category[] }>('/categories/reorder', { method: 'PATCH', body: { ids } });
export const categoryUses = (id: string) => call<{ uses: number }>(`/categories/${id}/uses`);
export const deleteCategory = (id: string, replaceWith?: string) => call<{ deleted: boolean; moved: number; hidden?: boolean; kept?: number }>(`/categories/${id}`, { method: 'DELETE', body: replaceWith ? { replaceWith } : {} });

/** Everyone with a card in the caller's view (View all → all, View branch → their team). */
export const listCardholders = () => call<{ holders: { id: string; name: string; active: boolean }[] }>('/cardholders');
export const listCards = () => call<{ cards: Card[]; people: Person[] }>('/cards');
export const addCard = (body: Pick<Card, 'userId' | 'label' | 'issuer' | 'lastDigits' | 'amexName' | 'location'>) => call<{ card: Card }>('/cards', { method: 'POST', body });
export const editCard = (id: string, body: Partial<Pick<Card, 'userId' | 'label' | 'issuer' | 'lastDigits' | 'amexName' | 'location' | 'active'>>) => call<{ card: Card }>(`/cards/${id}`, { method: 'PUT', body });
/** Who each group would reach, so the form can name them before anything is sent. */
export const remindPreview = (ids: string[]) => call<RemindPreview>('/expenses/remind/preview', { method: 'POST', body: { ids } });
/** Who a receipt can be added for, with their cards. */
export const getAddForHolders = () => call<{ holders: AddableHolder[] }>('/add-for-holders');
