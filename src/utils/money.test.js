import { describe, it, expect } from 'vitest';
import { parseAmount, formatAmount, formatMoney, sanitizeAmountInput } from './money.js';

describe('parseAmount', () => {
  it('reads a plain number', () => {
    expect(parseAmount('400')).toBe(400);
    expect(parseAmount('400.50')).toBe(400.5);
    expect(parseAmount(400)).toBe(400);
  });

  // The whole reason this module exists: Number('1,400') is NaN, and the save
  // path's `Number(x) || 0` turned that into a freight charge of zero.
  it('reads a figure that has already been formatted', () => {
    expect(parseAmount('1,400')).toBe(1400);
    expect(parseAmount('$1,400.00')).toBe(1400);
    expect(parseAmount(' $ 12,345.67 ')).toBe(12345.67);
  });

  it('returns null for an unset amount rather than zero', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });

  it('rejects a typo instead of salvaging its leading digits', () => {
    expect(parseAmount('12abc')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('.')).toBeNull();
    expect(parseAmount('1.2.3')).toBeNull();
  });

  it('keeps zero distinct from unset', () => {
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount('0.00')).toBe(0);
  });
});

describe('formatAmount', () => {
  it('groups thousands and pins two decimals', () => {
    expect(formatAmount('400')).toBe('400.00');
    expect(formatAmount(1400)).toBe('1,400.00');
    expect(formatAmount('12345.678')).toBe('12,345.68');
  });

  it('leaves an empty field empty', () => {
    expect(formatAmount('')).toBe('');
    expect(formatAmount(null)).toBe('');
  });

  it('is idempotent, so re-formatting on every blur is safe', () => {
    expect(formatAmount(formatAmount('1400'))).toBe('1,400.00');
  });

  it('shows an entered zero', () => {
    expect(formatAmount(0)).toBe('0.00');
    expect(formatAmount('0')).toBe('0.00');
  });
});

describe('formatMoney', () => {
  it('adds the symbol for read-only display', () => {
    expect(formatMoney(1400)).toBe('$1,400.00');
    expect(formatMoney('')).toBe('');
  });
});

describe('sanitizeAmountInput', () => {
  it('lets a half-typed amount through', () => {
    expect(sanitizeAmountInput('1,')).toBe('1,');
    expect(sanitizeAmountInput('12.')).toBe('12.');
    expect(sanitizeAmountInput('')).toBe('');
  });

  it('drops characters that could never belong to an amount', () => {
    expect(sanitizeAmountInput('$1,400.00')).toBe('1,400.00');
    expect(sanitizeAmountInput('40a0')).toBe('400');
  });

  it('allows only one decimal point', () => {
    expect(sanitizeAmountInput('1.2.3')).toBe('1.23');
  });
});
