import { BANK_FILTERS, STATUS_KEYS, monthOf, rangeProblem } from '../../utils/cardReceipts';
import { NO_FILTERS, STATEMENT_FILTERS, WAIT_FILTERS, type ReceiptFilters, type WaitFilter } from './cardReceiptsView';

/**
 * Credit Card Receipts' Filters are kept until the person changes them (owner, 2026-11-24: "filters are gone when they
 * refresh"). Kept per person on this device (localStorage), never on the server: Card, Status, Statement, Category, the
 * Waiting for me queue, (through usePeopleFilter) Cardholder and the period — a month or a custom From–To (owner,
 * 2026-11-24: "what about the period??"), read back by useCardReceipts. Not kept: the search box.
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

/** The period: a month, or a custom range (which wins). */
export type SavedPeriod = { month: string; range: { from: string; to: string } | null };
export const savedPeriodKey = (viewerId: string) => (viewerId ? `ccr-period:${viewerId}` : '');

/**
 * The kept period, checked against today: a month after this one or a range that isn't a real From–To (or starts after
 * today) is dropped, and nothing kept opens on this month — what the page always did.
 */
export function parseSavedPeriod(raw: string | null, today: string): SavedPeriod {
  const thisMonth = monthOf(today);
  const none: SavedPeriod = { month: thisMonth, range: null };
  if (!raw) return none;
  let o: Record<string, unknown>;
  try { o = JSON.parse(raw); } catch { return none; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return none;
  const r = o.range as Record<string, unknown> | null | undefined;
  if (r && typeof r === 'object' && !rangeProblem(r.from, r.to) && String(r.from) <= today) {
    return { month: monthOf(String(r.from)), range: { from: String(r.from), to: String(r.to) } };
  }
  const month = typeof o.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(o.month) && o.month <= thisMonth ? o.month : thisMonth;
  return { month, range: null };
}
