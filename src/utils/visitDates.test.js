import { describe, it, expect } from 'vitest';
import { normalizeVisitDate, normalizeOptionalDate } from './visitDates.js';

describe('normalizeVisitDate', () => {
  it('accepts a real YYYY-MM-DD date', () => {
    expect(normalizeVisitDate('2026-10-02')).toBe('2026-10-02');
    expect(normalizeVisitDate(' 2026-10-02 ')).toBe('2026-10-02');
  });

  it('reads an ISO timestamp as the date written in it', () => {
    expect(normalizeVisitDate('2026-10-02T00:00:00.000Z')).toBe('2026-10-02');
    expect(normalizeVisitDate('2026-10-02T14:30')).toBe('2026-10-02');
    expect(normalizeVisitDate('2026-10-02T14:30:00-07:00')).toBe('2026-10-02');
  });

  it('rejects days that do not exist', () => {
    expect(normalizeVisitDate('2026-02-30')).toBeNull();
    expect(normalizeVisitDate('2026-13-01')).toBeNull();
  });

  it('rejects anything else, including regex-shaped text', () => {
    expect(normalizeVisitDate('(a+)+$T')).toBeNull();
    expect(normalizeVisitDate('2026-10-02T.*')).toBeNull();
    expect(normalizeVisitDate('2026-10-02Tanything')).toBeNull();
    expect(normalizeVisitDate('10/02/2026')).toBeNull();
    expect(normalizeVisitDate('')).toBeNull();
    expect(normalizeVisitDate(null)).toBeNull();
    expect(normalizeVisitDate({ $gt: '' })).toBeNull();
  });

  it('turns a Date object into its local day', () => {
    expect(normalizeVisitDate(new Date(2026, 9, 2, 15, 0))).toBe('2026-10-02');
    expect(normalizeVisitDate(new Date('nope'))).toBeNull();
  });
});

describe('normalizeOptionalDate', () => {
  it('treats empty as no date, and still rejects bad input', () => {
    expect(normalizeOptionalDate('')).toBe('');
    expect(normalizeOptionalDate(null)).toBe('');
    expect(normalizeOptionalDate(undefined)).toBe('');
    expect(normalizeOptionalDate('2026-10-05')).toBe('2026-10-05');
    expect(normalizeOptionalDate('soon')).toBeNull();
  });
});
