import { describe, expect, it } from 'vitest';
import type { VoiceWord } from '../../utils/assistantContract';
import { changedFields, currentMonth, failRate, filterWords, formatCost, formatTokens, kindCounts, parsePastedList, pasteSummary, sortPeople, wordFormErrors } from './voiceWordsView';

const word = (over: Partial<VoiceWord>): VoiceWord => ({ id: 'x', heard: '', meant: 'Word', kind: 'other', active: true, note: '', updatedAt: '', ...over });
const WORDS = [
  word({ id: '1', meant: 'Calacatta Gold', heard: 'cala cotta gold', kind: 'stone' }),
  word({ id: '2', meant: 'Silestone', kind: 'brand' }),
  word({ id: '3', meant: 'Bellevue', heard: 'bell view', kind: 'branch', active: false }),
  word({ id: '4', meant: 'slab', kind: 'slang', note: 'a big piece of stone' })
];

describe('filterWords / kindCounts', () => {
  it('shows active words A–Z by default and finds a word by what was heard or the note', () => {
    expect(filterWords(WORDS, { query: '', kind: 'all', status: 'active' }).map((w) => w.id)).toEqual(['1', '2', '4']);
    expect(filterWords(WORDS, { query: 'cotta', kind: 'all', status: 'all' }).map((w) => w.id)).toEqual(['1']);
    expect(filterWords(WORDS, { query: 'big piece', kind: 'all', status: 'all' }).map((w) => w.id)).toEqual(['4']);
  });
  it('filters by kind and hidden', () => {
    expect(filterWords(WORDS, { query: '', kind: 'branch', status: 'hidden' }).map((w) => w.id)).toEqual(['3']);
    expect(filterWords(WORDS, { query: '', kind: 'branch', status: 'active' })).toEqual([]);
  });
  it('counts each kind under the search and status, not under the kind filter', () => {
    const c = kindCounts(WORDS, { query: '', status: 'active' });
    expect(c).toMatchObject({ all: 3, stone: 1, brand: 1, branch: 0, slang: 1 });
    expect(kindCounts(WORDS, { query: '', status: 'all' }).all).toBe(4);
    expect(kindCounts(WORDS, { query: 'sile', status: 'all' })).toMatchObject({ all: 1, brand: 1, stone: 0 });
  });
});

describe('the form rules', () => {
  const ok = { meant: 'Calacatta', heard: '', kind: 'stone' as const, note: '' };
  it('needs the word, and refuses a heard that is the same word', () => {
    expect(wordFormErrors({ ...ok, meant: '  ' }).meant).toBe('Enter the word');
    expect(wordFormErrors({ ...ok, heard: 'calacatta' }).heard).toMatch(/Same as the word/);
    expect(wordFormErrors({ ...ok, heard: 'cala cotta' })).toEqual({});
  });
  it('lists only what changed', () => {
    const w = word({ meant: 'Silestone', heard: '', kind: 'brand', note: '' });
    expect(changedFields({ meant: 'Silestone ', heard: '', kind: 'brand', note: '' }, w)).toEqual({});
    expect(changedFields({ meant: 'Silestone', heard: 'sile stone', kind: 'stone', note: 'n' }, w)).toEqual({ heard: 'sile stone', kind: 'stone', note: 'n' });
  });
});

describe('parsePastedList', () => {
  it('reads heard = meant, a plain word, and odd separators and bullets', () => {
    const rows = parsePastedList('cala cotta gold = Calacatta Gold\nQuartzite\n- sile stone -> Silestone\n3. “quartz ite” → Quartzite\nfu\t Foo\nbarr | Bar\nbazz => Baz', [], 'stone');
    expect(rows.map((r) => [r.heard, r.meant])).toEqual([
      ['cala cotta gold', 'Calacatta Gold'], ['', 'Quartzite'], ['sile stone', 'Silestone'], ['quartz ite', 'Quartzite'], ['fu', 'Foo'], ['barr', 'Bar'], ['bazz', 'Baz']
    ]);
    expect(rows.every((r) => r.kind === 'stone' && r.status === 'new')).toBe(true);
  });
  it('skips blank lines and # comments, and keeps real line numbers', () => {
    const rows = parsePastedList('# stones\n\nA = B\r\n   \nC', []);
    expect(rows.map((r) => r.line)).toEqual([3, 5]);
  });
  it('marks words already in the list and repeats inside the paste, case-insensitively', () => {
    const rows = parsePastedList('Cala Cotta Gold = Calacatta Gold\nsilestone\nSILESTONE\nx = Y\nX = Z', [word({ heard: 'cala cotta gold', meant: 'Calacatta Gold' }), word({ meant: 'Silestone' })]);
    expect(rows.map((r) => r.status)).toEqual(['exists', 'exists', 'exists', 'new', 'repeat']);
    expect(pasteSummary(rows)).toEqual({ add: 1, skip: 4, invalid: 0 });
  });
  it('refuses a missing meaning, the same word twice and an over-long word', () => {
    const rows = parsePastedList('abc =\nsame = SAME\n' + 'z'.repeat(81));
    expect(rows.map((r) => r.status)).toEqual(['invalid', 'invalid', 'invalid']);
    expect(rows[0].problem).toMatch(/after the separator/);
  });
  it('only the first separator splits', () => {
    const [row] = parsePastedList('a = b = c');
    expect([row.heard, row.meant]).toEqual(['a', 'b = c']);
  });
});

describe('usage formatting', () => {
  it('writes cost, tokens and failure rates', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0234)).toBe('$0.023');
    expect(formatCost(0.0001)).toBe('<$0.001');
    expect(formatCost(12.345)).toBe('$12.35');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12345)).toBe('12,345');
    expect(formatTokens(2_500_000)).toBe('2.5M');
    expect(failRate(0, 0)).toBe('—');
    expect(failRate(1, 40)).toBe('2.5%');
    expect(failRate(5, 10)).toBe('50%');
    expect(failRate(0, 10)).toBe('0%');
  });
  it('orders people busiest first, then A–Z, and names the month', () => {
    const people = [{ userId: 'a', name: 'Zed', turns: 3, failed: 0 }, { userId: 'b', name: 'Amy', turns: 3, failed: 1 }, { userId: 'c', name: 'Bo', turns: 9, failed: 0 }];
    expect(sortPeople(people).map((p) => p.name)).toEqual(['Bo', 'Amy', 'Zed']);
    expect(currentMonth(new Date(2026, 10, 28))).toBe('2026-11');
  });
});
