/**
 * The Daily Work Report's payment methods, in the order the sheet, the PDF
 * and the CSV list them. Shared by the tab, the server's save and summaries,
 * and the PDF — adding a method is one line here plus the model's field.
 *
 * ACH was added 2026-10-15. Reports saved before then have no `ach` at all,
 * which reads as unsaid (null), never as a zero.
 */
export const PAYMENT_METHODS = [
  { key: 'ach', label: 'ACH' },
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Credit Card (CC)' },
  { key: 'check', label: 'Check' }
];

const orNull = (v) => (v === undefined || v === '' ? null : v);

/** Every method present, as { count, amount } — missing ones (older reports) null. */
export const withAllPaymentMethods = (payments) => Object.fromEntries(
  PAYMENT_METHODS.map(({ key }) => [key, {
    count: orNull(payments?.[key]?.count ?? null),
    amount: orNull(payments?.[key]?.amount ?? null)
  }])
);

const sumOf = (payments, field) =>
  PAYMENT_METHODS.reduce((s, { key }) => s + (Number(payments?.[key]?.[field]) || 0), 0);

export const paymentCount = (payments) => sumOf(payments, 'count');
export const paymentAmount = (payments) => sumOf(payments, 'amount');

/** Somebody entered a figure — a 0 included ("nothing taken" is an answer). */
export const paymentsSaid = (payments) => PAYMENT_METHODS.some(({ key }) =>
  ['count', 'amount'].some(f => orNull(payments?.[key]?.[f] ?? null) !== null));

/** "Nothing taken today": every method 0. */
export const noPayments = () => Object.fromEntries(
  PAYMENT_METHODS.map(({ key }) => [key, { count: 0, amount: 0 }])
);
