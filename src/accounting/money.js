/**
 * Money in Accounting is whole cents (integers), never dollars as decimals:
 * 0.1 + 0.2 is 0.30000000000000004 in JavaScript, and a ledger can't drift a
 * cent. Every amount is converted at the edge (a form, the schedule's
 * freightFee) and stays in cents everywhere after that.
 */

const MAX_CENTS = 100_000_000_00; // $100M — far beyond any freight bill; catches typos

/**
 * "$1,234.5", "1234.50", 1234.5 → 123450. '' / null → null (no amount yet).
 * Anything that isn't a plain amount with at most two decimals → undefined,
 * so a caller can tell "left blank" from "not a number".
 */
export function toCents(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    value = value.toFixed(2);
  }
  const s = String(value).trim().replace(/[$,\s]/g, '');
  if (s === '') return null;
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return undefined;
  const cents = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return undefined;
  return m[1] ? -cents : cents;
}

/** 123450 → "$1,234.50"; null → "—". */
export function formatCents(cents, { blank = '—' } = {}) {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return blank;
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** 123450 → "1234.50" (for exports and inputs). */
export const centsToPlain = (cents) => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2));

/** Sum of amounts, ignoring blanks. */
export const sumCents = (list) => (list || []).reduce((s, c) => s + (Number.isSafeInteger(c) ? c : 0), 0);

export const isValidAmount = (cents) => Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_CENTS;
