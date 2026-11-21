import { displayNameOf } from '../../utils/salesReps';
import { missingFor, missingLine, statusTotals, subLabel } from '../../utils/cardReceipts';
import { ALL_PEOPLE, viewerLocations, workLocationsOf } from '../../utils/teamScope';
import type { PersonOption } from '../../api/myTeam';
import type { Loose } from '../../types/records';
import type { Category, Expense } from './types';

/** "Gas · Truck": the category and, when it has one, the type. */
export const categoryText = (categories: readonly Category[], e: { category: string; subcategory?: string }) => {
  const sub = e.subcategory ? subLabel(categories.find((c) => c.name === e.category), e.subcategory) : '';
  return [categoryLabel(categories, e.category), sub].filter(Boolean).join(' · ');
};

/** What the Filters panel, the search box and the status tiles narrow the list to. */
/** `people` is the cardholders ticked in the People filter; [] = everyone in view. */
export type ReceiptFilters = { search: string; status: string; people: string[]; category: string };
export const NO_FILTERS: ReceiptFilters = { search: '', status: 'all', people: [], category: '' };

export const categoryLabel = (categories: readonly Category[], name: string) =>
  categories.find((c) => c.name === name)?.label || (name ? name.replace(/_/g, ' ') : '');

/**
 * `base` is the list before the status tile and search (what the tiles count),
 * `rows` what's shown. Voided ones stay out unless asked for.
 */
export function visibleExpenses(list: readonly Expense[], f: ReceiptFilters, categories: readonly Category[]) {
  const base = list.filter((e) => !e.voided
    && (!f.people.length || f.people.includes(e.userId))
    && (!f.category || e.category === f.category));
  const q = f.search.trim().toLowerCase();
  const rows = base.filter((e) => (f.status === 'all' || e.status === f.status)
    && (!q || [e.merchant, e.holderName, e.cardLabel, e.note, e.purpose, e.customerName, categoryText(categories, e), e.location]
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

/**
 * The People filter's list: each cardholder in the list once, under the branch
 * they work at (the Visits People filter's headings). The list the server sent
 * is already limited to the viewer's access (View all / View branch → their
 * team), so only those people are offered. A person under two branches sits
 * under one the viewer is assigned, else their first; someone the staff list
 * doesn't know sits under the branch on their receipt.
 */
export function holderPeople(
  list: readonly Expense[], staff: readonly Loose[], viewer: Loose | null | undefined,
  /** Everyone with a card (GET /cardholders), so the list isn't only who has an expense in this month. */
  holders: readonly { id: string; name: string }[] = []
): PersonOption[] {
  const mine = viewerLocations(viewer);
  const byId = new Map(staff.map((p) => [String(p._id ?? p.id), p]));
  const seen = new Map<string, { name: string; location: string }>();
  for (const h of holders) if (!seen.has(h.id)) seen.set(h.id, { name: h.name, location: '' });
  for (const e of list) seen.set(e.userId, { name: e.holderName || e.cardLabel || seen.get(e.userId)?.name || '', location: e.location || '' });
  return [...seen.entries()].map(([id, e]) => {
    const person = byId.get(id);
    const works = person ? workLocationsOf(person) : [];
    const heading = (mine === ALL_PEOPLE ? works[0] : works.find((l) => mine.includes(l)) || works[0]) || e.location || '';
    return { value: id, id, label: person ? displayNameOf(person) : e.name, location: heading, locations: works, inactive: Boolean(person && person.isActive === false) };
  }).sort((a, b) => a.label.localeCompare(b.label));
}
