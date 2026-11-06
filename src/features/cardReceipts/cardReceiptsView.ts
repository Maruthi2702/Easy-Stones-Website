import { missingFor, missingLine, statusTotals } from '../../utils/cardReceipts';
import type { Category, Expense } from './types';

/** What the Filters panel, the search box and the status tiles narrow the list to. */
export type ReceiptFilters = { search: string; status: string; location: string; holder: string; category: string };
export const NO_FILTERS: ReceiptFilters = { search: '', status: 'all', location: '', holder: '', category: '' };

export const categoryLabel = (categories: readonly Category[], name: string) =>
  categories.find((c) => c.name === name)?.label || (name ? name.replace(/_/g, ' ') : '');

/**
 * `base` is the list before the status tile and search (what the tiles count),
 * `rows` what's shown. Voided ones stay out unless asked for.
 */
export function visibleExpenses(list: readonly Expense[], f: ReceiptFilters, categories: readonly Category[]) {
  const base = list.filter((e) => !e.voided
    && (!f.location || e.location === f.location)
    && (!f.holder || e.userId === f.holder)
    && (!f.category || e.category === f.category));
  const q = f.search.trim().toLowerCase();
  const rows = base.filter((e) => (f.status === 'all' || e.status === f.status)
    && (!q || [e.merchant, e.holderName, e.cardLabel, e.note, e.purpose, e.customerName, categoryLabel(categories, e.category), e.location]
      .some((v) => String(v || '').toLowerCase().includes(q))));
  return { base, rows, totals: statusTotals(base), shown: statusTotals(rows) };
}

export const isPdfUrl = (url: string) => /\.pdf($|\?)/i.test(url) || url.startsWith('data:application/pdf');

/** What the cardholder still has to do, or why it was sent back — the line beside the status. */
export function statusLine(e: Expense, categories: readonly Category[]) {
  if (e.status === 'sent_back' && e.sentBack?.comment) return `“${e.sentBack.comment}” · ${e.sentBack.byName}`;
  if (e.status === 'draft' || e.status === 'sent_back' || e.status === 'missing') {
    return missingLine(missingFor(e, categories.find((c) => c.name === e.category)));
  }
  return '';
}

/** Each cardholder once, A–Z, for the Filters panel. */
export const holdersOf = (list: readonly Expense[]) =>
  [...new Map(list.map((e) => [e.userId, e.holderName || e.cardLabel])).entries()]
    .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
export const locationsOf = (list: readonly Expense[]) => [...new Set(list.map((e) => e.location).filter(Boolean))].sort();
