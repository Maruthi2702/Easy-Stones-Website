import { Lock, FileEdit, Minus, CircleDashed } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SummaryRow, SummaryTotals } from './types';

/**
 * The vocabulary a summarised day is written in — shared by the month view and
 * the all-branches day so the two can't drift apart. Kept out of the component
 * file because a module that exports both components and constants loses fast
 * refresh.
 */

/** Table money: always two decimals, so the column aligns down the page. */
export const money = (v: number | null | undefined): string => `$${Number(v || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})}`;

/** Headline money: cents only when there are cents — $7,800 reads faster. */
export const moneyShort = (v: number | null | undefined): string => `$${Number(v || 0).toLocaleString('en-US', {
  minimumFractionDigits: Number(v || 0) % 1 ? 2 : 0,
  maximumFractionDigits: 2
})}`;

export const STATUS: Record<string, { label: string; cls: string; Icon: LucideIcon }> = {
  submitted: { label: 'Submitted', cls: 'ok', Icon: Lock },
  draft: { label: 'Draft', cls: 'warn', Icon: FileEdit },
  closed: { label: 'Closed', cls: 'off', Icon: Minus },
  // Nothing saved for that branch on that day — distinct from a draft, which
  // somebody has at least opened.
  none: { label: 'Not started', cls: 'idle', Icon: CircleDashed }
};

const ZERO_TOTALS: SummaryTotals = {
  visitors: 0, deliveries: 0, pickups: 0,
  transferCount: 0, transferSlabs: 0,
  transferCountIn: 0, transferSlabsIn: 0,
  containerCount: 0, containerSlabs: 0,
  payments: 0
};

export const sumRows = (rows: SummaryRow[]): SummaryTotals => rows.reduce((t, r) => ({
  visitors: t.visitors + (r.visitors || 0),
  deliveries: t.deliveries + (r.deliveries || 0),
  pickups: t.pickups + (r.pickups || 0),
  transferCount: t.transferCount + (r.transferCount || 0),
  transferSlabs: t.transferSlabs + (r.transferSlabs || 0),
  transferCountIn: t.transferCountIn + (r.transferCountIn || 0),
  transferSlabsIn: t.transferSlabsIn + (r.transferSlabsIn || 0),
  containerCount: t.containerCount + (r.containerCount || 0),
  containerSlabs: t.containerSlabs + (r.containerSlabs || 0),
  payments: t.payments + (r.payments || 0)
}), { ...ZERO_TOTALS });
