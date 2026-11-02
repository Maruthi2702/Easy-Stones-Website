import { matchesPayment, paymentTotals } from '../../utils/paymentsReceived';
import type { Payment } from './types';

export type PaymentFilters = { method: string; showVoided: boolean; search: string };
export const NO_FILTERS: PaymentFilters = { method: 'all', showVoided: false, search: '' };

/**
 * What the list shows: the method picked (or all), voided ones only when
 * asked, then the search. `base` is the list before the search, for "2 of 7";
 * `shown` is the total of what's listed — voided never counted — to check
 * against a deposit slip, card batch or cash count.
 */
export function visiblePayments(payments: readonly Payment[], f: PaymentFilters) {
  const base = payments
    .filter((p) => f.showVoided || !p.voided)
    .filter((p) => f.method === 'all' || p.method === f.method);
  const rows = base.filter((p) => matchesPayment(p, f.search));
  const shown = paymentTotals(rows);
  return { base, rows, shown };
}

/** "Fri, Oct 30" — the day under the title and in the lock note. */
export const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

/** "9:12 AM" — when it was entered. */
export const timeLabel = (at: string | null | undefined) => {
  if (!at) return '';
  const t = new Date(at);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

/** What a row's reference reads as: "•••• 4421", "Check 10233". */
export const referenceText = (p: Pick<Payment, 'method' | 'reference'>) => {
  if (!p.reference) return '';
  if (p.method === 'card') return `•••• ${p.reference}`;
  if (p.method === 'check') return `Check ${p.reference}`;
  return p.reference;
};
