import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { queryEntries, type ErrorBody, type Query } from '../../types/api';
import type { ExpenseInput } from '../../utils/cardReceipts';
import type { Card, Category, Expense, Me, Person } from './types';

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
  const data: ErrorBody & { problems?: unknown; repeat?: unknown } = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.message || data.error || `Something went wrong (${res.status}).`), {
      status: res.status, problems: data.problems || {}, repeat: data.repeat || null
    });
  }
  return data as T;
}

export type ExpenseBody = ExpenseInput & { confirmRepeat?: boolean };

export const loadMe = () => call<Me>('/me');
export const listExpenses = (scope: 'mine' | 'all' | 'waiting', month: string) =>
  call<{ expenses: Expense[] }>('/expenses', { query: scope === 'waiting' ? { scope } : { scope, month } });
export const addExpense = (id: string, body: ExpenseBody) => call<{ expense: Expense; alreadySaved?: boolean }>('/expenses', { method: 'POST', body: { id, ...body } });
export const editExpense = (id: string, body: ExpenseBody) => call<{ expense: Expense }>(`/expenses/${id}`, { method: 'PUT', body });
export const approveExpense = (id: string, comment: string) => call<{ expense: Expense }>(`/expenses/${id}/approve`, { method: 'POST', body: { comment } });
export const sendBackExpense = (id: string, comment: string) => call<{ expense: Expense }>(`/expenses/${id}/send-back`, { method: 'POST', body: { comment } });
export const voidExpense = (id: string, reason: string) => call<{ expense: Expense }>(`/expenses/${id}/void`, { method: 'POST', body: { reason } });
export const uploadReceipt = (data: string) => call<{ url: string }>('/attachments', { method: 'POST', body: { data } });

export const listCategories = () => call<{ categories: Category[] }>('/categories');
export const addCategory = (body: Pick<Category, 'label' | 'fields'>) => call<{ category: Category }>('/categories', { method: 'POST', body });
export const editCategory = (id: string, body: Partial<Pick<Category, 'label' | 'fields' | 'active'>>) => call<{ category: Category }>(`/categories/${id}`, { method: 'PUT', body });
export const reorderCategories = (ids: string[]) => call<{ categories: Category[] }>('/categories/reorder', { method: 'PATCH', body: { ids } });
export const categoryUses = (id: string) => call<{ uses: number }>(`/categories/${id}/uses`);
export const deleteCategory = (id: string, replaceWith?: string) => call<{ deleted: boolean; moved: number }>(`/categories/${id}`, { method: 'DELETE', body: replaceWith ? { replaceWith } : {} });

export const listCards = () => call<{ cards: Card[]; people: Person[] }>('/cards');
export const addCard = (body: Pick<Card, 'userId' | 'label' | 'issuer' | 'lastDigits'>) => call<{ card: Card }>('/cards', { method: 'POST', body });
export const editCard = (id: string, body: Partial<Pick<Card, 'userId' | 'label' | 'issuer' | 'lastDigits' | 'active'>>) => call<{ card: Card }>(`/cards/${id}`, { method: 'PUT', body });
