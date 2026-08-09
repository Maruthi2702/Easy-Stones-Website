import { Lock, FileEdit, Minus, CircleDashed } from 'lucide-react';

/**
 * The vocabulary a summarised day is written in — shared by the month view and
 * the all-branches day so the two can't drift apart. Kept out of the component
 * file because a module that exports both components and constants loses fast
 * refresh.
 */

/** Table money: always two decimals, so the column aligns down the page. */
export const money = (v) => `$${Number(v || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})}`;

/** Headline money: cents only when there are cents — $7,800 reads faster. */
export const moneyShort = (v) => `$${Number(v || 0).toLocaleString('en-US', {
  minimumFractionDigits: Number(v || 0) % 1 ? 2 : 0,
  maximumFractionDigits: 2
})}`;

export const STATUS = {
  submitted: { label: 'Submitted', cls: 'ok', Icon: Lock },
  draft: { label: 'Draft', cls: 'warn', Icon: FileEdit },
  closed: { label: 'Closed', cls: 'off', Icon: Minus },
  // Nothing saved for that branch on that day — distinct from a draft, which
  // somebody has at least opened.
  none: { label: 'Not started', cls: 'idle', Icon: CircleDashed }
};

const ZERO_TOTALS = {
  visitors: 0, deliveries: 0, pickups: 0,
  transferSlabs: 0, containerSlabs: 0, payments: 0
};

export const sumRows = (rows) => rows.reduce((t, r) => ({
  visitors: t.visitors + (r.visitors || 0),
  deliveries: t.deliveries + (r.deliveries || 0),
  pickups: t.pickups + (r.pickups || 0),
  transferSlabs: t.transferSlabs + (r.transferSlabs || 0),
  containerSlabs: t.containerSlabs + (r.containerSlabs || 0),
  payments: t.payments + (r.payments || 0)
}), { ...ZERO_TOTALS });
