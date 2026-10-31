import type { Loose } from '../types/records.ts';
/**
 * Deleting customers from the Customer List in bulk (2026-10-17): the rules
 * the bulk bar's confirmation and the server share. The route is
 * src/routes/customerBulkDelete.ts; who may is canDeleteCustomers
 * (src/utils/customerAccess.ts — the Delete switch, which needs View).
 *
 * Every deleted customer is saved whole first (customerdeletebackups), so
 * Undo puts it back under the same id and its deliveries, lost sales,
 * schedules and activity point at it again. Pure and DOM-free; tested in
 * customerBulkDelete.test.js.
 */

/** The most customers one request may delete. */
export const MAX_BULK_DELETE = 500;

/** Above this many, the confirmation also asks for the number to be typed. */
export const TYPE_TO_CONFIRM_ABOVE = 10;

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * The ids to delete, repeats dropped — or why the request can't go ahead.
 * `{ ids }` or `{ error }`.
 */
export const bulkDeleteIds = (raw: unknown) => {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Choose the customers to delete.' };
  const ids = [...new Set(raw.map((id) => String(id ?? '').trim()))];
  if (ids.some((id) => !OBJECT_ID.test(id))) return { error: 'One of the selected customers isn’t a valid record.' };
  if (ids.length > MAX_BULK_DELETE) return { error: `Delete at most ${MAX_BULK_DELETE} customers at a time.` };
  return { ids };
};

/** Whether the confirmation asks for the count to be typed. */
export const needsTypedCount = (count: number) => count > TYPE_TO_CONFIRM_ABOVE;

/** Whether what was typed is the count (spaces ignored). */
export const typedCountMatches = (typed: unknown, count: number) => String(typed ?? '').trim() === String(count);

const customers = (n: number) => (n === 1 ? '1 customer' : `${n} customers`);

/** The confirmation's title. */
export const deleteTitle = (count: number) => `Delete ${customers(count)}?`;

/** Names for the confirmation: the first few, then "and N more". */
export const namesToShow = (names: string[] = [], shown = 5) => {
  const list = names.map((n) => String(n || '').trim() || 'Unnamed customer');
  return list.length <= shown
    ? { names: list, more: 0 }
    : { names: list.slice(0, shown), more: list.length - shown };
};

/** The bar's message after a delete. */
export const deletedMessage = (deleted: number) => `${customers(deleted)} deleted`;

/** The bar's message after Undo — including any that couldn't come back. */
export const restoredMessage = ({ restored = 0, failed = [] }: Loose = {}) => {
  const back = restored === 1 ? '1 customer restored' : `${restored} customers restored`;
  if (!failed.length) return back;
  return `${back}; ${customers(failed.length)} couldn’t be — ${failed.map((f) => f.company || f.id).join(', ')}`;
};
