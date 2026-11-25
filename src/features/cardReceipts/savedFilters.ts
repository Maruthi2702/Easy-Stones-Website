import { BANK_FILTERS, STATUS_KEYS } from '../../utils/cardReceipts';
import { NO_FILTERS, STATEMENT_FILTERS, WAIT_FILTERS, type ReceiptFilters, type WaitFilter } from './cardReceiptsView';

/**
 * Credit Card Receipts' Filters are kept until the person changes them (owner, 2026-11-24: "filters are gone when they
 * refresh"). Kept per person on this device (localStorage), never on the server: Card, Status, Statement, Category, the
 * Waiting for me queue and (through usePeopleFilter) Cardholder. Not kept: the search box and the period, which opens
 * on this month.
 */
export type SavedFilters = Pick<ReceiptFilters, 'status' | 'category' | 'bank' | 'statement'> & { wait: WaitFilter };
export const NO_SAVED: SavedFilters = { status: NO_FILTERS.status, category: NO_FILTERS.category, bank: NO_FILTERS.bank, statement: NO_FILTERS.statement, wait: 'all' };

/** '' (nothing kept) until the viewer is known, so one person's picks never land under another's key. */
export const savedFiltersKey = (viewerId: string) => (viewerId ? `ccr-filters:${viewerId}` : '');
export const savedPeopleKey = (viewerId: string) => (viewerId ? `ccr-people:${viewerId}` : '');

const pick = (value: unknown, allowed: readonly string[], fallback: string) =>
  typeof value === 'string' && allowed.includes(value) ? value : fallback;

/** What was kept, with anything unknown (an old key, a renamed choice, junk) put back to its default. */
export function parseSavedFilters(raw: string | null): SavedFilters {
  if (!raw) return NO_SAVED;
  let o: Record<string, unknown>;
  try { o = JSON.parse(raw); } catch { return NO_SAVED; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return NO_SAVED;
  return {
    status: pick(o.status, ['all', ...STATUS_KEYS], NO_SAVED.status),
    bank: pick(o.bank, ['', ...BANK_FILTERS.map((b) => b.key)], NO_SAVED.bank),
    statement: pick(o.statement, ['', ...STATEMENT_FILTERS.map((s) => s.key)], NO_SAVED.statement),
    // A category is checked against the list where it's shown: one hidden or deleted since just matches nothing until cleared.
    category: typeof o.category === 'string' ? o.category.slice(0, 120) : NO_SAVED.category,
    wait: pick(o.wait, WAIT_FILTERS.map((w) => w.key), NO_SAVED.wait) as WaitFilter
  };
}

export const savedOf = (f: ReceiptFilters, wait: WaitFilter): SavedFilters =>
  ({ status: f.status, category: f.category, bank: f.bank, statement: f.statement, wait });
