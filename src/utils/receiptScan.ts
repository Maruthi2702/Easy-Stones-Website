/**
 * Reading a receipt (Credit Card Receipts → Add receipt): what we ask Claude for,
 * how its answer is checked, and which form fields it may fill. Shared by the
 * server (src/services/receiptScan.ts, src/routes/cardReceiptScan.ts) and the
 * screen (ExpenseForm). Tested in receiptScan.test.ts.
 *
 * The reading only suggests: it fills fields that are still empty, the person
 * checks them before saving, and the card / person always come from who
 * uploaded it — never from a name or digits printed on the receipt.
 */
import { parseCents, centsText } from './cardReceipts.ts';

/** What Claude answers. Every field is required; "" means it isn't on the receipt or can't be read. */
export type RawScan = {
  isReceipt: boolean;
  date: string;
  merchant: string;
  total: string;
  subtotal: string;
  fees: string;
  tax: string;
  tip: string;
  category: string;
};

/** A checked reading: blank / null where nothing trustworthy was read. */
export type ReceiptScan = {
  isReceipt: boolean;
  date: string;
  merchant: string;
  totalCents: number | null;
  subtotalCents: number | null;
  feesCents: number | null;
  taxCents: number | null;
  tipCents: number | null;
  category: string;
};

export type ScanCategory = { name: string; label: string; active?: boolean };

/** The JSON schema for Claude's structured output (output_config.format). */
export function scanSchema(categories: ScanCategory[]) {
  const names = categories.filter((c) => c.active !== false).map((c) => c.name);
  const money = { type: 'string', description: 'Dollars with two decimals, e.g. "42.50"; "" if not printed or unreadable.' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['isReceipt', 'date', 'merchant', 'total', 'subtotal', 'fees', 'tax', 'tip', 'category'],
    properties: {
      isReceipt: { type: 'boolean', description: 'false if this is not a receipt, invoice or bill for a purchase.' },
      date: { type: 'string', description: 'The purchase date as YYYY-MM-DD; "" if not printed.' },
      merchant: { type: 'string', description: 'The business paid, as people know it (e.g. "Chevron", "Home Depot"); "" if unknown.' },
      total: money,
      subtotal: money,
      fees: { type: 'string', description: 'All fees added to the bill other than tax and tip, added together (delivery charge, service fee, booking fee); "" if none.' },
      tax: money,
      tip: money,
      category: { type: 'string', enum: [...names, ''], description: 'The best matching category name, or "" if none clearly fits.' }
    }
  };
}

/** The instruction sent with the receipt. Categories are listed by name and label. */
export function scanPrompt(categories: ScanCategory[], today: string): string {
  const list = categories.filter((c) => c.active !== false).map((c) => `- ${c.name}: ${c.label}`).join('\n');
  return [
    'Read this company credit-card receipt and fill in the fields.',
    `Today is ${today}. Dates on US receipts are month first (10/03/26 is 2026-10-03).`,
    'total = the final amount charged to the card. If a tip is written in, include it; if the tip line is blank (a bill before the tip), total is the amount due and tip is "".',
    'subtotal = the items before fees, tax and tip. fees = delivery charge + service fee + any other added fee, summed ("" when there are none); total should equal subtotal + fees + tax + tip.',
    'Use "" for anything that is not printed or that you cannot read with confidence. Never guess a number.',
    'Ignore card numbers, names and loyalty numbers printed on the receipt.',
    'category: choose from this list only when it clearly fits, else "":',
    list || '(no categories)'
  ].join('\n');
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const realDay = (s: string) => {
  const m = DAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/** A receipt older than this is still allowed on the form, but a reading that old is more likely misread. */
export const OLDEST_READ_DAYS = 400;

const money = (typed: unknown): number | null => {
  const cents = parseCents(typed);
  return cents != null && Number.isFinite(cents) && cents > 0 ? cents : null;
};

/**
 * Check Claude's answer. Anything malformed becomes blank rather than wrong:
 * a date that isn't a real day, is after today or over OLDEST_READ_DAYS back;
 * an amount that isn't money; a category not on the shown list.
 */
export function cleanScan(raw: unknown, { categories, today }: { categories: ScanCategory[]; today: string }): ReceiptScan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof RawScan, unknown>>;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const date = text(r.date);
  const dateOk = realDay(date) && daysBetween(date, today) >= 0 && daysBetween(date, today) <= OLDEST_READ_DAYS;
  const shown = new Set(categories.filter((c) => c.active !== false).map((c) => c.name));
  const category = text(r.category);
  const merchant = text(r.merchant).replace(/\s+/g, ' ').slice(0, 80);
  return {
    isReceipt: r.isReceipt !== false,
    date: dateOk ? date : '',
    merchant,
    totalCents: money(r.total),
    subtotalCents: money(r.subtotal),
    feesCents: money(r.fees),
    taxCents: money(r.tax),
    tipCents: money(r.tip),
    category: shown.has(category) ? category : ''
  };
}

/** True when the reading found nothing worth filling in. */
export const scanIsEmpty = (s: ReceiptScan) =>
  !s.date && !s.merchant && s.totalCents == null && s.subtotalCents == null && s.feesCents == null && s.taxCents == null && s.tipCents == null && !s.category;

export type ScanFillable = { date: string; merchant: string; total: string; subtotal: string; fees: string; tax: string; tip: string; category: string };
export type ScanField = keyof ScanFillable;

/**
 * The form values after a reading, and which fields it filled. Only empty
 * fields are filled — never one the person already typed — except the date,
 * which a new form starts on today: it is replaced while it still says
 * `startDate` (today) and nobody changed it.
 */
export function fillFromScan<V extends ScanFillable>(values: V, scan: ReceiptScan, { startDate }: { startDate: string }): { values: V; filled: ScanField[] } {
  const next = { ...values };
  const filled: ScanField[] = [];
  const put = (field: ScanField, value: string, empty: boolean) => {
    if (!value || !empty) return;
    (next as ScanFillable)[field] = value;
    filled.push(field);
  };
  put('date', scan.date, !values.date || (values.date === startDate && scan.date !== startDate));
  put('merchant', scan.merchant, !values.merchant.trim());
  put('total', centsText(scan.totalCents), !values.total.trim());
  put('subtotal', centsText(scan.subtotalCents), !values.subtotal.trim());
  put('fees', centsText(scan.feesCents), !values.fees.trim());
  put('tax', centsText(scan.taxCents), !values.tax.trim());
  put('tip', centsText(scan.tipCents), !values.tip.trim());
  put('category', scan.category, !values.category);
  return { values: next, filled };
}

const FIELD_WORDS: Record<ScanField, string> = { date: 'date', merchant: 'merchant', total: 'total', subtotal: 'subtotal', fees: 'fees', tax: 'tax', tip: 'tip', category: 'category' };

/** The line under the receipt after a reading, e.g. "Filled in the date, merchant and total from the receipt. Check them." */
export function scanLine(filled: ScanField[]): string {
  if (!filled.length) return '';
  const words = filled.map((f) => FIELD_WORDS[f]);
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `Filled in the ${list} from the receipt. Check ${filled.length === 1 ? 'it' : 'them'}.`;
}
