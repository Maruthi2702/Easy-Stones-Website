import type { Card, Person } from './types';

/**
 * Cards tab rules (2026-11-25, design: claude.ai artifact "Cards tab redesign canvas",
 * https://claude.ai/artifact/T24JF9juv4RC2q4pwXELPZ): one entry per person with their cards listed in it,
 * sorted by the person's location A–Z, then name A–Z (owner's ask), people with no holder yet last. The
 * Filters panel holds Bank, Status and Location; the list opens on Active.
 */
export type CardBank = '' | 'amex' | 'encore' | 'other';
export type CardStatus = 'active' | 'inactive' | 'unassigned' | 'all';
export type CardFilters = { search: string; bank: CardBank; status: CardStatus; location: string };

export const NO_CARD_FILTERS: CardFilters = { search: '', bank: '', status: 'active', location: '' };

export const CARD_STATUSES: { key: Exclude<CardStatus, 'all'>; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Deactivated' },
  { key: 'unassigned', label: 'Not assigned yet' }
];

export const BANK_CHOICES: { key: Exclude<CardBank, ''>; label: string }[] = [
  { key: 'amex', label: 'Amex' },
  { key: 'encore', label: 'Encore' }
];

export type CardNames = { holderName: (c: Card) => string; place: (c: Card) => string };

const BANK_ORDER: Record<string, number> = { amex: 0, encore: 1, other: 2 };

/** Filters count as on when they differ from the opening view (Active, nothing else). */
export const filtersOn = (f: CardFilters) => (f.search.trim() ? 1 : 0) + (f.bank ? 1 : 0) + (f.status !== 'active' ? 1 : 0) + (f.location ? 1 : 0);

/** Whether one card passes the filters. `skip` leaves one filter out, for the counts beside each choice. */
export function cardMatches(c: Card, f: CardFilters, names: CardNames, skip?: keyof CardFilters): boolean {
  if (skip !== 'bank' && f.bank && c.issuer !== f.bank) return false;
  if (skip !== 'location' && f.location && names.place(c) !== f.location) return false;
  if (skip !== 'status') {
    if (f.status === 'active' && !c.active) return false;
    if (f.status === 'inactive' && c.active) return false;
    if (f.status === 'unassigned' && c.userId) return false;
  }
  const q = f.search.trim().toLowerCase();
  if (skip !== 'search' && q) {
    const hay = [c.label, c.lastDigits, c.amexName, c.statementName, names.holderName(c), names.place(c)].filter(Boolean).join(' ').toLowerCase();
    if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  return true;
}

export type CardGroup = { key: string; userId: string; place: string; name: string; cards: Card[] };

/** One group per person (a card with no holder stands alone), A–Z by location then name, unassigned last. */
export function groupCards(cards: Card[], names: CardNames): CardGroup[] {
  const by = new Map<string, Card[]>();
  for (const c of cards) {
    const key = c.userId || `none:${c._id}`;
    by.set(key, [...(by.get(key) || []), c]);
  }
  const groups = [...by.entries()].map(([key, list]) => ({
    key,
    userId: list[0]!.userId,
    place: names.place(list[0]!),
    name: list[0]!.userId ? names.holderName(list[0]!) : '',
    cards: [...list].sort((a, b) => Number(b.active) - Number(a.active) || (BANK_ORDER[a.issuer] ?? 3) - (BANK_ORDER[b.issuer] ?? 3) || a.label.localeCompare(b.label))
  }));
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  return groups.sort((a, b) =>
    (a.userId ? 0 : 1) - (b.userId ? 0 : 1)
    // A person with no location sits after the located ones.
    || (a.place ? 0 : 1) - (b.place ? 0 : 1)
    || text(a.place, b.place)
    || text(a.name, b.name)
    || text(a.cards[0]!.label, b.cards[0]!.label));
}

/** The branches a card can be filtered by: where people work, plus any kept on a card with no holder. */
export function cardLocations(cards: Card[], people: Person[], names: CardNames): string[] {
  void people;
  return [...new Set(cards.map((c) => names.place(c)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export const initialOf = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '?') + (words.length > 1 ? words[words.length - 1]![0]! : '')).toUpperCase();
};
