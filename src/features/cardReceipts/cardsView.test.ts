import { describe, it, expect } from 'vitest';
import { NO_CARD_FILTERS, cardMatches, filtersOn, groupCards, initialOf } from './cardsView';
import type { Card } from './types';

const card = (over: Partial<Card>): Card => ({ _id: 'x', userId: 'u', label: 'AAAA1111', issuer: 'amex', lastDigits: '1111', active: true, amexName: '', location: '', ...over } as Card);
const people: Record<string, { name: string; place: string }> = {
  a: { name: 'Albert Aranda', place: 'Dallas' },
  b: { name: 'Babu Manam', place: 'Dallas' },
  c: { name: 'Akhil Gangapuram', place: 'Charleston' },
  d: { name: 'Zed Nolocation', place: '' }
};
const names = { holderName: (c: Card) => people[c.userId]?.name || '', place: (c: Card) => people[c.userId]?.place || c.location || '' };

describe('Cards tab rules', () => {
  const cards = [
    card({ _id: '1', userId: 'b', label: 'BABU6162', issuer: 'encore' }),
    card({ _id: '2', userId: 'a', label: 'ALBE91962' }),
    card({ _id: '3', userId: 'b', label: 'MANA92473' }),
    card({ _id: '4', userId: '', label: 'GAJU93017', location: 'Atlanta' }),
    card({ _id: '5', userId: 'c', label: 'AKHI3992', issuer: 'encore' }),
    card({ _id: '6', userId: 'd', label: 'ZED1' })
  ];

  it('sorts people by location, then name; no location after the located; no holder last', () => {
    const groups = groupCards(cards, names);
    expect(groups.map((g) => g.name || '(none)')).toEqual(['Akhil Gangapuram', 'Albert Aranda', 'Babu Manam', 'Zed Nolocation', '(none)']);
  });

  it('keeps a person’s cards in one entry, Amex before Encore', () => {
    const babu = groupCards(cards, names).find((g) => g.name === 'Babu Manam')!;
    expect(babu.cards.map((c) => c.label)).toEqual(['MANA92473', 'BABU6162']);
  });

  it('opens on Active and counts only other filters as on', () => {
    expect(NO_CARD_FILTERS.status).toBe('active');
    expect(filtersOn(NO_CARD_FILTERS)).toBe(0);
    expect(filtersOn({ ...NO_CARD_FILTERS, status: 'all' })).toBe(1);
    expect(filtersOn({ ...NO_CARD_FILTERS, bank: 'amex', location: 'Dallas' })).toBe(2);
  });

  it('filters by bank, status, location and search words', () => {
    const f = { ...NO_CARD_FILTERS };
    const hit = (over: Partial<typeof f>) => cards.filter((c) => cardMatches(c, { ...f, ...over }, names)).map((c) => c._id);
    expect(hit({ bank: 'encore' })).toEqual(['1', '5']);
    expect(hit({ location: 'Dallas' })).toEqual(['1', '2', '3']);
    expect(hit({ status: 'unassigned' })).toEqual(['4']);
    expect(hit({ search: 'babu 6162' })).toEqual(['1']);
    expect(hit({ search: '92473' })).toEqual(['3']);
  });

  it('a deactivated card only shows under Deactivated or All', () => {
    const off = card({ _id: '9', active: false });
    expect(cardMatches(off, NO_CARD_FILTERS, names)).toBe(false);
    expect(cardMatches(off, { ...NO_CARD_FILTERS, status: 'inactive' }, names)).toBe(true);
    expect(cardMatches(off, { ...NO_CARD_FILTERS, status: 'all' }, names)).toBe(true);
  });

  it('skip leaves one filter out for the counts', () => {
    const c = card({ userId: 'a', issuer: 'amex' });
    expect(cardMatches(c, { ...NO_CARD_FILTERS, bank: 'encore' }, names)).toBe(false);
    expect(cardMatches(c, { ...NO_CARD_FILTERS, bank: 'encore' }, names, 'bank')).toBe(true);
  });

  it('initials', () => {
    expect(initialOf('Akhil Gangapuram')).toBe('AG');
    expect(initialOf('Abhi')).toBe('A');
    expect(initialOf('')).toBe('?');
  });
});
