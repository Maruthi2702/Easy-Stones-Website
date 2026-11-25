import { describe, expect, it } from 'vitest';
import { NO_SAVED, parseSavedFilters, parseSavedPeriod, savedFiltersKey, savedOf, savedPeriodKey } from './savedFilters';
import { NO_FILTERS } from './cardReceiptsView';

describe('saved Credit Card Receipts filters', () => {
  it('keeps nothing until the viewer is known', () => {
    expect(savedFiltersKey('')).toBe('');
    expect(savedFiltersKey('u1')).toBe('ccr-filters:u1');
  });

  it('reads back what was kept', () => {
    const kept = savedOf({ ...NO_FILTERS, search: 'panera', status: 'waiting', bank: 'amex', statement: 'off', category: 'meals' }, 'second');
    expect(kept).toEqual({ status: 'waiting', bank: 'amex', statement: 'off', category: 'meals', wait: 'second' });
    expect(parseSavedFilters(JSON.stringify(kept))).toEqual(kept);
  });

  it('never keeps the search box', () => {
    expect(savedOf({ ...NO_FILTERS, search: 'panera' }, 'all')).not.toHaveProperty('search');
  });

  it('puts anything unknown back to its default', () => {
    expect(parseSavedFilters(null)).toEqual(NO_SAVED);
    expect(parseSavedFilters('not json')).toEqual(NO_SAVED);
    expect(parseSavedFilters('[1,2]')).toEqual(NO_SAVED);
    expect(parseSavedFilters(JSON.stringify({ status: 'lost', bank: 'visa', statement: 'maybe', category: 4, wait: 'boss' }))).toEqual(NO_SAVED);
    expect(parseSavedFilters(JSON.stringify({ bank: 'encore' }))).toEqual({ ...NO_SAVED, bank: 'encore' });
  });

  it('keeps the period: a month or a custom range, checked against today', () => {
    const today = '2026-11-24';
    expect(savedPeriodKey('')).toBe('');
    expect(parseSavedPeriod(null, today)).toEqual({ month: '2026-11', range: null });
    expect(parseSavedPeriod(JSON.stringify({ month: '2026-09' }), today)).toEqual({ month: '2026-09', range: null });
    // A range wins and puts the month on its first day.
    expect(parseSavedPeriod(JSON.stringify({ month: '2026-11', range: { from: '2026-10-03', to: '2026-10-20' } }), today))
      .toEqual({ month: '2026-10', range: { from: '2026-10-03', to: '2026-10-20' } });
    // Junk, a month after this one, a backwards or over-a-year range, or one starting after today: this month.
    expect(parseSavedPeriod('nope', today)).toEqual({ month: '2026-11', range: null });
    expect(parseSavedPeriod(JSON.stringify({ month: '2026-12' }), today)).toEqual({ month: '2026-11', range: null });
    expect(parseSavedPeriod(JSON.stringify({ month: '2026-13' }), today)).toEqual({ month: '2026-11', range: null });
    expect(parseSavedPeriod(JSON.stringify({ range: { from: '2026-10-20', to: '2026-10-03' } }), today)).toEqual({ month: '2026-11', range: null });
    expect(parseSavedPeriod(JSON.stringify({ range: { from: '2025-01-01', to: '2026-11-01' } }), today)).toEqual({ month: '2026-11', range: null });
    expect(parseSavedPeriod(JSON.stringify({ range: { from: '2026-11-25', to: '2026-11-30' } }), today)).toEqual({ month: '2026-11', range: null });
  });
});
