/**
 * Amounts a person types, and amounts a person reads.
 *
 * A currency box has to accept what people actually type — "1,400", "$1,400",
 * "1400.5", a pasted "$ 1,400.00" — and still hand the server a plain Number.
 * `Number("1,400")` is NaN, and the delivery modal's save reads
 * `Number(freightFee) || 0`, so every one of those spellings would have been
 * stored as a freight charge of zero without a word to anyone.
 *
 * Kept pure and separate so it can be tested without a DOM — see money.test.js.
 */

/**
 * Everything that is decoration rather than value: the currency symbol, the
 * thousands separators, and any stray whitespace around a pasted figure.
 */
const DECORATION = /[$,\s]/g;

/**
 * A typed amount -> a number, or null when there is nothing usable.
 *
 * null rather than 0 on purpose: an empty box means "nobody has entered a
 * freight charge", which is not the same fact as "the freight charge is
 * $0.00", and only the caller knows which of the two its field should store.
 */
export const parseAmount = (input) => {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;

  const cleaned = String(input).replace(DECORATION, '');
  if (!cleaned) return null;

  // Reject anything that is not a plain decimal figure rather than letting
  // parseFloat salvage a prefix — "12abc" is a typo, not twelve dollars.
  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '.' || cleaned === '-') return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/**
 * A number -> what the field shows when it is not being typed in:
 * grouped thousands, always two decimal places.
 *
 * Returns '' for an unset amount so an empty box stays empty rather than
 * filling itself in with "0.00" the moment it is tabbed past.
 */
export const formatAmount = (value) => {
  const n = parseAmount(value);
  if (n === null) return '';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * The same figure with its currency symbol, for read-only display.
 */
export const formatMoney = (value) => {
  const formatted = formatAmount(value);
  return formatted ? `$${formatted}` : '';
};

/**
 * What the field is allowed to hold *while someone is still typing in it*.
 *
 * Deliberately more permissive than parseAmount: a half-typed "1," or "12." is
 * not yet a valid amount but is on its way to one, and a field that refuses
 * the keystroke leaves the caret stuck. Only characters that could never
 * belong to an amount are dropped, plus any second decimal point.
 */
export const sanitizeAmountInput = (raw) => {
  const kept = String(raw ?? '').replace(/[^\d.,]/g, '');
  const firstDot = kept.indexOf('.');
  if (firstDot === -1) return kept;
  // Keep the first decimal point, drop the rest.
  return kept.slice(0, firstDot + 1) + kept.slice(firstDot + 1).replace(/\./g, '');
};
