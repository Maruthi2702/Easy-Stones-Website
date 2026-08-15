import { describe, it, expect, beforeEach } from 'vitest';
import {
  RECENCY_COLORS,
  RECENCY_DARK_TEXT,
  FALLBACK_CENTER,
  pad,
  todayKey,
  friendlyDate,
  whenLabel,
  real,
  nameOf,
  isPlaceholderEmail,
  parseAddressComponents,
  loadRecentLeadSearches,
  saveRecentLeadSearch,
  removeRecentLeadSearch
} from './helpers';

describe('pad', () => {
  it('zero-pads single digits', () => {
    expect(pad(5)).toBe('05');
  });

  it('leaves two-digit numbers alone', () => {
    expect(pad(15)).toBe('15');
  });
});

describe('todayKey', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(todayKey(new Date(2026, 7, 5))).toBe('2026-08-05');
  });
});

describe('friendlyDate', () => {
  it('formats a stored YYYY-MM-DD as a short month/day', () => {
    expect(friendlyDate('2026-08-19')).toBe('Aug 19');
  });

  it('returns the original string for something unparseable', () => {
    expect(friendlyDate('not-a-date')).toBe('not-a-date');
  });
});

describe('whenLabel', () => {
  it('returns just the date slice for something unparseable', () => {
    expect(whenLabel('garbage-value-not-a-date')).toBe('garbage-va');
  });

  it('formats a real ISO start time into a readable string', () => {
    const label = whenLabel('2026-08-19T09:00:00.000');
    // Exact wording depends on the runtime's locale data, so check shape
    // (contains the day number and isn't the raw ISO string) rather than
    // an exact string match.
    expect(label).toContain('19');
    expect(label).not.toBe('2026-08-19T09:00:00.000');
  });
});

describe('real', () => {
  it('passes through a genuine value untouched (trimmed)', () => {
    expect(real('  Acme Stone Co.  ')).toBe('Acme Stone Co.');
  });

  it('blanks out known filler values', () => {
    expect(real('N/A')).toBe('');
    expect(real('none')).toBe('');
    expect(real('---')).toBe('');
    expect(real('TBD')).toBe('');
  });

  it('blanks out an empty/whitespace-only value', () => {
    expect(real('   ')).toBe('');
    expect(real(undefined)).toBe('');
  });
});

describe('nameOf', () => {
  it('prefers the company name', () => {
    expect(nameOf({ company: 'Acme Stone', contactName: 'Jane Doe' })).toBe('Acme Stone');
  });

  it('falls back to the contact name when company is filler/blank', () => {
    expect(nameOf({ company: 'N/A', contactName: 'Jane Doe' })).toBe('Jane Doe');
  });

  it('falls back to "Unknown" when both are filler/blank', () => {
    expect(nameOf({ company: '', contactName: 'none' })).toBe('Unknown');
  });
});

describe('isPlaceholderEmail (re-exported from customerMatch)', () => {
  it('flags an in-house @easystones.com address', () => {
    expect(isPlaceholderEmail('someone@easystones.com')).toBe(true);
  });

  it('does not flag a genuine customer email', () => {
    expect(isPlaceholderEmail('owner@acmestone.com')).toBe(false);
  });
});

describe('parseAddressComponents', () => {
  it('pulls street/city/state/zip out of Places API addressComponents', () => {
    const components = [
      { longText: '123', types: ['street_number'] },
      { longText: 'Main St', types: ['route'] },
      { longText: 'Redmond', types: ['locality'] },
      { shortText: 'WA', types: ['administrative_area_level_1'] },
      { longText: '98052', types: ['postal_code'] }
    ];
    expect(parseAddressComponents(components)).toEqual({
      street: '123 Main St',
      city: 'Redmond',
      state: 'WA',
      zipCode: '98052'
    });
  });

  it('falls back to postal_town when locality is absent', () => {
    const components = [{ longText: 'Some Town', types: ['postal_town'] }];
    expect(parseAddressComponents(components).city).toBe('Some Town');
  });

  it('returns blanks for an empty/missing component list', () => {
    expect(parseAddressComponents()).toEqual({ street: '', city: '', state: '', zipCode: '' });
    expect(parseAddressComponents([])).toEqual({ street: '', city: '', state: '', zipCode: '' });
  });
});

describe('recent lead searches (localStorage-backed)', () => {
  // jsdom-free localStorage stand-in — just enough of the Storage API for
  // these three functions (getItem/setItem), scoped fresh per test so one
  // test's saved searches can't leak into the next.
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key)
    };
  });

  it('starts empty', () => {
    expect(loadRecentLeadSearches()).toEqual([]);
  });

  it('saves a search and returns the updated list, most recent first', () => {
    saveRecentLeadSearch('countertops');
    const after = saveRecentLeadSearch('cabinets');
    expect(after).toEqual(['cabinets', 'countertops']);
    expect(loadRecentLeadSearches()).toEqual(['cabinets', 'countertops']);
  });

  it('re-saving an existing term (case-insensitively) moves it to the front instead of duplicating', () => {
    saveRecentLeadSearch('countertops');
    saveRecentLeadSearch('cabinets');
    const after = saveRecentLeadSearch('COUNTERTOPS');
    expect(after).toEqual(['COUNTERTOPS', 'cabinets']);
  });

  it('ignores a blank/whitespace-only term', () => {
    const after = saveRecentLeadSearch('   ');
    expect(after).toEqual([]);
  });

  it('caps the list at 8 entries', () => {
    for (let i = 0; i < 10; i += 1) saveRecentLeadSearch(`term-${i}`);
    expect(loadRecentLeadSearches()).toHaveLength(8);
    // Most recent (term-9) survives; oldest (term-0, term-1) are pushed out.
    expect(loadRecentLeadSearches()[0]).toBe('term-9');
  });

  it('removes a specific term', () => {
    saveRecentLeadSearch('countertops');
    saveRecentLeadSearch('cabinets');
    const after = removeRecentLeadSearch('countertops');
    expect(after).toEqual(['cabinets']);
  });
});

describe('constants', () => {
  it('RECENCY_COLORS has both themes with all four buckets', () => {
    for (const theme of ['dark', 'light']) {
      expect(Object.keys(RECENCY_COLORS[theme]).sort()).toEqual(['due', 'never', 'overdue', 'recent']);
    }
  });

  it('RECENCY_DARK_TEXT only marks the brighter buckets', () => {
    expect(RECENCY_DARK_TEXT.has('overdue')).toBe(true);
    expect(RECENCY_DARK_TEXT.has('due')).toBe(true);
    expect(RECENCY_DARK_TEXT.has('never')).toBe(false);
    expect(RECENCY_DARK_TEXT.has('recent')).toBe(false);
  });

  it('FALLBACK_CENTER is a real lat/lng pair', () => {
    expect(FALLBACK_CENTER).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
  });
});
