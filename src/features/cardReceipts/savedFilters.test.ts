import { describe, expect, it } from 'vitest';
import { NO_SAVED, parseSavedFilters, savedFiltersKey, savedOf } from './savedFilters';
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
});
