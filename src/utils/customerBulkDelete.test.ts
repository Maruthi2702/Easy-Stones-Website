import { describe, it, expect } from 'vitest';
import {
  MAX_BULK_DELETE, TYPE_TO_CONFIRM_ABOVE, bulkDeleteIds, needsTypedCount, typedCountMatches,
  deleteTitle, namesToShow, deletedMessage, restoredMessage
} from './customerBulkDelete.ts';

const id = (n: number) => n.toString(16).padStart(24, '0');

describe('bulkDeleteIds', () => {
  it('keeps valid ids, repeats dropped', () => {
    expect(bulkDeleteIds([id(1), id(2), id(1)])).toEqual({ ids: [id(1), id(2)] });
  });
  it('refuses an empty or missing list', () => {
    expect(bulkDeleteIds([]).error).toBeTruthy();
    expect(bulkDeleteIds(undefined).error).toBeTruthy();
  });
  it('refuses anything that isn’t a record id', () => {
    expect(bulkDeleteIds([id(1), 'abc']).error).toBeTruthy();
    expect(bulkDeleteIds([{ $ne: null }]).error).toBeTruthy();
  });
  it('refuses more than the cap', () => {
    expect(bulkDeleteIds(Array.from({ length: MAX_BULK_DELETE }, (_, i) => id(i + 1))).ids).toHaveLength(MAX_BULK_DELETE);
    expect(bulkDeleteIds(Array.from({ length: MAX_BULK_DELETE + 1 }, (_, i) => id(i + 1))).error).toMatch(/at most/);
  });
});

describe('the confirmation', () => {
  it('asks for the number to be typed above 10', () => {
    expect(TYPE_TO_CONFIRM_ABOVE).toBe(10);
    expect(needsTypedCount(10)).toBe(false);
    expect(needsTypedCount(11)).toBe(true);
  });
  it('matches the typed count exactly, spaces ignored', () => {
    expect(typedCountMatches(' 25 ', 25)).toBe(true);
    expect(typedCountMatches('2', 25)).toBe(false);
    expect(typedCountMatches('', 25)).toBe(false);
  });
  it('names the count in the title', () => {
    expect(deleteTitle(1)).toBe('Delete 1 customer?');
    expect(deleteTitle(2)).toBe('Delete 2 customers?');
  });
  it('lists the first five names, then how many more', () => {
    expect(namesToShow(['A', 'B'])).toEqual({ names: ['A', 'B'], more: 0 });
    expect(namesToShow(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toEqual({ names: ['A', 'B', 'C', 'D', 'E'], more: 2 });
    expect(namesToShow(['', null])).toEqual({ names: ['Unnamed customer', 'Unnamed customer'], more: 0 });
  });
});

describe('messages', () => {
  it('says how many were deleted', () => {
    expect(deletedMessage(1)).toBe('1 customer deleted');
    expect(deletedMessage(3)).toBe('3 customers deleted');
  });
  it('says how many came back, and names any that couldn’t', () => {
    expect(restoredMessage({ restored: 2 })).toBe('2 customers restored');
    expect(restoredMessage({ restored: 1, failed: [{ id: 'x', company: 'Acme' }] }))
      .toBe('1 customer restored; 1 customer couldn’t be — Acme');
  });
});
