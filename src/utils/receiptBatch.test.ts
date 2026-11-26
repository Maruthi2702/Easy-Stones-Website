import { describe, it, expect } from 'vitest';
import { MAX_BATCH, batchLeftOut, batchNote, batchRoom, batchSummary, isBatchMarker, rowReadiness } from './receiptBatch.ts';

describe('Add several receipts: the rules', () => {
  it('holds up to 25 and says how many were left out', () => {
    expect(MAX_BATCH).toBe(25);
    expect(batchRoom(0)).toBe(25);
    expect(batchRoom(24)).toBe(1);
    expect(batchRoom(30)).toBe(0);
    expect(batchLeftOut(0, 25)).toBe('');
    expect(batchLeftOut(20, 8)).toMatch(/3 files were left out/);
    expect(batchLeftOut(24, 2)).toMatch(/1 file was left out/);
  });
  it('accepts only a sensible “3 of 5”', () => {
    expect(isBatchMarker({ n: 1, of: 1 })).toBe(true);
    expect(isBatchMarker({ n: 25, of: 25 })).toBe(true);
    expect(isBatchMarker({ n: 3, of: 2 })).toBe(false);
    expect(isBatchMarker({ n: 0, of: 2 })).toBe(false);
    expect(isBatchMarker({ n: 1, of: 26 })).toBe(false);
    expect(isBatchMarker({ n: 1.5, of: 2 })).toBe(false);
    expect(isBatchMarker('1 of 2')).toBe(false);
    expect(isBatchMarker(null)).toBe(false);
    expect(batchNote({ n: 3, of: 5 })).toBe('added in a batch (3 of 5)');
  });
  it('tells ready, incomplete and blocked rows apart', () => {
    expect(rowReadiness({ value: {}, missing: {} })).toBe('ready');
    expect(rowReadiness({ value: {}, missing: { category: 'Choose a category' } })).toBe('incomplete');
    expect(rowReadiness({ missing: {} })).toBe('blocked');
  });
  it('sums up a finished batch', () => {
    expect(batchSummary([{ status: 'waiting', matchedMissing: true }, { status: 'waiting', matchedMissing: false }, { status: 'waiting', matchedMissing: false, merged: true }], 0))
      .toBe('2 sent for approval · 1 updated a saved receipt · 1 replaced a report row');
    expect(batchSummary([{ status: 'waiting', matchedMissing: false }], 1)).toBe('1 sent for approval · 1 didn’t save');
    expect(batchSummary([], 2)).toBe('2 didn’t save');
  });
});
