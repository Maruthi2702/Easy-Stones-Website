import { describe, it, expect } from 'vitest';
import { toCents, formatCents, centsToPlain, sumCents, isValidAmount } from './money.js';

describe('toCents', () => {
  it('reads amounts as typed, without floating-point drift', () => {
    expect(toCents('$1,234.50')).toBe(123450);
    expect(toCents('1234.5')).toBe(123450);
    expect(toCents(1234.5)).toBe(123450);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents('19.99')).toBe(1999);
    expect(toCents(' 7 ')).toBe(700);
  });
  it('tells blank from nonsense', () => {
    expect(toCents('')).toBeNull();
    expect(toCents(null)).toBeNull();
    expect(toCents('12.345')).toBeUndefined();
    expect(toCents('abc')).toBeUndefined();
    expect(toCents(NaN)).toBeUndefined();
    expect(toCents('99999999999')).toBeUndefined();
  });
});

describe('formatting and sums', () => {
  it('formats and sums cents', () => {
    expect(formatCents(123450)).toBe('$1,234.50');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(-2500)).toBe('-$25.00');
    expect(formatCents(null)).toBe('—');
    expect(centsToPlain(123450)).toBe('1234.50');
    expect(sumCents([100, null, 250])).toBe(350);
  });
  it('only positive whole cents are valid amounts', () => {
    expect(isValidAmount(1)).toBe(true);
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount(10.5)).toBe(false);
    expect(isValidAmount(null)).toBe(false);
  });
});
