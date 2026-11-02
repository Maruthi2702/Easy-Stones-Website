/**
 * Payments received at a branch, one entry per payment (2026-11-02, owner's
 * request: a page instead of typing totals into the Daily Report). Design:
 * the claude.ai artifact **Payments page prototype**
 * (https://claude.ai/artifact/4zkVgFWTfDFdtLdfVJjjQh).
 *
 * Shared by the server (src/routes/paymentsReceived.ts) and the screen
 * (src/features/payments/). The owner's rules:
 *   - Company, date, method and amount are required.
 *   - Return is a method, and whatever is typed is saved negative
 *     (1000 or -1000 → −$1,000.00). A minus on any other method is refused.
 *   - A day whose Daily Report is submitted is locked here too.
 *   - A payment is voided with a reason, never deleted.
 *
 * Amounts are whole cents. Until the owner confirms the switch-over the
 * Daily Report keeps its own typed grid; this page only feeds a comparison
 * line on it.
 */
import { PAYMENT_METHODS } from './dailyReportPayments.ts';

export const RETURN_METHOD = 'return';
export type MethodKey = 'ach' | 'cash' | 'card' | 'check' | 'return';

/** The report's four methods, in its order, then Return. */
export const RECEIVED_METHODS: readonly { key: string; label: string; short: string; reference: string; hint: string }[] = [
  ...PAYMENT_METHODS.map(({ key, label }) => ({
    key,
    label,
    short: key === 'card' ? 'Credit Card' : label,
    reference: ({ ach: 'ACH reference', cash: 'Receipt #', card: 'Card last 4', check: 'Check #' } as Record<string, string>)[key] || 'Reference',
    hint: ({ ach: 'Bank transfer', cash: 'At the desk', card: 'Last 4 digits', check: 'Check number' } as Record<string, string>)[key] || ''
  })),
  { key: RETURN_METHOD, label: 'Return', short: 'Return', reference: 'Return ticket #', hint: 'Saved as negative' }
];

export const METHOD_KEYS = RECEIVED_METHODS.map(m => m.key);
export const isMethod = (key: unknown): key is MethodKey => typeof key === 'string' && METHOD_KEYS.includes(key);
export const methodOf = (key: string) => RECEIVED_METHODS.find(m => m.key === key);

export const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export type AmountResult = { cents: number; error?: undefined } | { cents?: undefined; error: 'amount' | 'negative' };

/**
 * What an amount as typed is worth, in cents. Return is always negative,
 * whatever sign was typed; any other method must be above 0 and has no minus.
 * Accepts "1,250.50", "$640", "-1000" (and the typographic minus).
 */
export function amountCents(typed: unknown, method: string): AmountResult {
  const text = String(typed ?? '').trim();
  const negative = /^[-−–]/.test(text);
  const digits = text.replace(/^[-−–]\s*/, '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(digits)) return { error: 'amount' };
  const cents = Math.round(Number(digits) * 100);
  if (!cents || cents > 100_000_000_00) return { error: 'amount' };
  if (method === RETURN_METHOD) return { cents: -cents };
  if (negative) return { error: 'negative' };
  return { cents };
}

/** Cents as the screen and the export show them: $1,250.50, −$1,000.00. */
export const formatMoney = (cents: number) => {
  const text = (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '−' : ''}$${text}`;
};

/** A card reference keeps its last 4 digits only — never a full card number. */
export const cleanReference = (method: string, value: unknown) => {
  const text = String(value ?? '').trim().slice(0, 60);
  if (method !== 'card') return text;
  const digits = text.replace(/\D/g, '');
  return digits.slice(-4);
};

type PaymentLike = { method: string; cents: number; voided?: unknown };
const live = <T extends PaymentLike>(list: readonly T[]) => list.filter(p => !p.voided);

/** Per method { count, cents }, the count of entries, money taken, returned and the net. Voided ones never count. */
export function paymentTotals(list: readonly PaymentLike[]) {
  const byMethod = Object.fromEntries(METHOD_KEYS.map(k => [k, { count: 0, cents: 0 }])) as Record<string, { count: number; cents: number }>;
  let taken = 0;
  let returned = 0;
  const counted = live(list);
  for (const p of counted) {
    const slot = byMethod[p.method];
    if (slot) { slot.count += 1; slot.cents += p.cents; }
    if (p.cents < 0) returned += p.cents; else taken += p.cents;
  }
  return { byMethod, count: counted.length, taken, returned, net: taken + returned };
}

/**
 * The day's totals the way the Daily Report's Payments grid holds them
 * (count + amount in dollars per method), for the comparison line and,
 * after the switch-over, the report itself.
 */
export function reportGridFrom(list: readonly PaymentLike[]) {
  const { byMethod } = paymentTotals(list);
  return Object.fromEntries(METHOD_KEYS.map(k => [k, { count: byMethod[k].count, amount: byMethod[k].cents / 100 }]));
}

export type PaymentInput = {
  date?: unknown; customerId?: unknown; customerName?: unknown; method?: unknown; amount?: unknown;
  invoice?: unknown; reference?: unknown; note?: unknown;
};

export type CleanPayment = {
  date: string; customerId: string; customerName: string; method: MethodKey; cents: number;
  invoice: string; reference: string; note: string;
};

/** Field → what's wrong, in the form's words. Empty when it can be saved. */
export type PaymentProblems = Partial<Record<'date' | 'customer' | 'method' | 'amount', string>>;

/**
 * A save body checked and tidied, or the problems with it. `today` is the
 * branch's own calendar day: a payment can't be dated after it.
 */
export function cleanPayment(input: PaymentInput, today: string): { value?: CleanPayment; problems: PaymentProblems } {
  const problems: PaymentProblems = {};
  const date = String(input.date ?? '').trim();
  if (!isDay(date)) problems.date = 'Pick a day';
  else if (date > today) problems.date = 'Can’t be after today';

  const customerId = String(input.customerId ?? '').trim();
  const customerName = String(input.customerName ?? '').trim().slice(0, 200);
  if (!customerId || !customerName) problems.customer = 'Choose a company';

  const method = String(input.method ?? '');
  if (!isMethod(method)) problems.method = 'Choose a method';

  const amount = amountCents(input.amount, isMethod(method) ? method : 'cash');
  if (amount.error === 'amount') problems.amount = 'Enter an amount above 0';
  if (amount.error === 'negative') problems.amount = 'Use Return for money going back';

  if (Object.keys(problems).length) return { problems };
  return {
    problems,
    value: {
      date, customerId, customerName, method: method as MethodKey, cents: amount.cents as number,
      invoice: String(input.invoice ?? '').trim().slice(0, 60),
      reference: cleanReference(method, input.reference),
      note: String(input.note ?? '').trim().slice(0, 500)
    }
  };
}

/** What an edit changed, in words for the history ("amount $1,200.00 → $1,250.00"). */
export function changeSummary(before: CleanPayment, after: CleanPayment): string[] {
  const out: string[] = [];
  if (before.date !== after.date) out.push(`date ${before.date} → ${after.date}`);
  if (before.customerId !== after.customerId) out.push(`company ${before.customerName} → ${after.customerName}`);
  if (before.method !== after.method) out.push(`method ${methodOf(before.method)?.short} → ${methodOf(after.method)?.short}`);
  if (before.cents !== after.cents) out.push(`amount ${formatMoney(before.cents)} → ${formatMoney(after.cents)}`);
  if (before.invoice !== after.invoice) out.push('invoice');
  if (before.reference !== after.reference) out.push('reference');
  if (before.note !== after.note) out.push('note');
  return out;
}

/** Search across what a row shows. */
export const matchesPayment = (p: { customerName?: string; invoice?: string; reference?: string; note?: string }, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.customerName, p.invoice, p.reference, p.note].some(v => String(v || '').toLowerCase().includes(q));
};

/** Payments permissions (Users & Roles → Payments card). */
export const PAYMENTS = Object.freeze({
  VIEW: 'view_payments',
  ADD: 'add_payments',
  EDIT: 'edit_payments',
  VOID: 'void_payments'
});

/** Every role that can edit the Daily Report gets them once (server.ts ACTION_MIGRATIONS). */
export const PAYMENTS_MIGRATION = Object.freeze([
  { from: 'edit_daily_report', grant: [PAYMENTS.VIEW, PAYMENTS.ADD, PAYMENTS.EDIT, PAYMENTS.VOID] },
  { from: 'view_daily_report', grant: [PAYMENTS.VIEW] }
]);
