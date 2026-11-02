import type { PaymentKey, PaymentsLike } from '../types/dailyReport.ts';
/**
 * The Daily Work Report's payment methods, in the order the sheet, the PDF
 * and the CSV list them. Shared by the tab, the server's save and summaries,
 * and the PDF — adding a method is one line here plus the model's field.
 *
 * ACH was added 2026-10-15. Reports saved before then have no `ach` at all,
 * which reads as unsaid (null), never as a zero. Return was added 2026-11-02
 * with the Payments page: its amount is negative, so the total is the net.
 */
export const PAYMENT_METHODS: { key: PaymentKey; label: string }[] = [
  { key: 'ach', label: 'ACH' },
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Credit Card (CC)' },
  { key: 'check', label: 'Check' },
  { key: 'return', label: 'Return' }
];

/**
 * From this day (each branch's own calendar day) the report's Payments come
 * from the Payments page (src/utils/paymentsReceived.ts) and can't be typed;
 * days before it keep what was typed. Owner's go-ahead 2026-11-02.
 */
export const PAYMENTS_FROM_PAGE_SINCE = '2026-11-02';
export const paymentsFromPage = (date: string | null | undefined) => Boolean(date) && String(date) >= PAYMENTS_FROM_PAGE_SINCE;

const orNull = <V,>(v: V | undefined | ''): V | null => (v === undefined || v === '' ? null : v);

/** Every method present, as { count, amount } — missing ones (older reports) null. */
export const withAllPaymentMethods = (payments: PaymentsLike | null | undefined) => Object.fromEntries(
  PAYMENT_METHODS.map(({ key }) => [key, {
    count: orNull(payments?.[key]?.count ?? null),
    amount: orNull(payments?.[key]?.amount ?? null)
  }])
);

const sumOf = (payments: PaymentsLike | null | undefined, field: 'count' | 'amount') =>
  PAYMENT_METHODS.reduce((s, { key }) => s + (Number(payments?.[key]?.[field]) || 0), 0);

export const paymentCount = (payments: PaymentsLike | null | undefined) => sumOf(payments, 'count');
export const paymentAmount = (payments: PaymentsLike | null | undefined) => sumOf(payments, 'amount');

/** Somebody entered a figure — a 0 included ("nothing taken" is an answer). */
export const paymentsSaid = (payments: PaymentsLike | null | undefined) => PAYMENT_METHODS.some(({ key }) =>
  (['count', 'amount'] as const).some(f => orNull(payments?.[key]?.[f] ?? null) !== null));

/** "Nothing taken today": every method 0. */
export const noPayments = () => Object.fromEntries(
  PAYMENT_METHODS.map(({ key }) => [key, { count: 0, amount: 0 }])
);
