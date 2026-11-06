/**
 * Credit Card Receipts (Accounting, 2026-11-05): company-card expenses, one
 * per receipt, uploaded by the cardholder right after paying. Design and the
 * owner's calls: the claude.ai artifacts **Credit Card Receipts Architecture**
 * (https://claude.ai/artifact/64fQdQpmprHrsVuMbnBYDh) and **Credit Card
 * Receipts UX** (https://claude.ai/artifact/CjnEH4QoPTtBwKt7hWYEvC).
 *
 * Shared by the server (src/routes/cardReceipts.ts) and the screens
 * (src/features/cardReceipts/). The owner's rules:
 *   - One card per person. An expense belongs to the person who uploads it and
 *     their card — never to a name or digits printed on the receipt.
 *   - Every expense needs a receipt (or a lost-receipt reason) and a category;
 *     a category may also ask for the customer, who attended, a purpose.
 *   - Someone above the cardholder approves: each role lists the roles whose
 *     receipts it approves (Roles & Permissions), from any branch. Nobody
 *     approves their own. A lost receipt needs the approver's comment.
 *   - The branch is the cardholder's home location, saved on the expense.
 *   - Amounts are whole cents. An expense is voided with a reason, never deleted.
 */
import { isDay } from './paymentsReceived.ts';

export const CARD_RECEIPTS = Object.freeze({
  /** Upload your own receipts and see your own expenses. */
  USE: 'use_card_receipts',
  VIEW_ALL: 'view_all_card_receipts',
  APPROVE: 'approve_card_receipts',
  EXPORT: 'export_card_receipts',
  MANAGE_CARDS: 'manage_company_cards',
  CATEGORY_ADD: 'add_receipt_categories',
  CATEGORY_EDIT: 'edit_receipt_categories',
  CATEGORY_REORDER: 'reorder_receipt_categories',
  CATEGORY_DELETE: 'delete_receipt_categories'
});
export const ALL_CARD_RECEIPT_PERMISSIONS = Object.freeze(Object.values(CARD_RECEIPTS));
export const CATEGORY_PERMISSIONS = Object.freeze([
  CARD_RECEIPTS.CATEGORY_ADD, CARD_RECEIPTS.CATEGORY_EDIT, CARD_RECEIPTS.CATEGORY_REORDER, CARD_RECEIPTS.CATEGORY_DELETE
]);
/** What opens the Credit Card Receipts page. */
export const PAGE_PERMISSIONS = Object.freeze([
  CARD_RECEIPTS.USE, CARD_RECEIPTS.VIEW_ALL, CARD_RECEIPTS.APPROVE, CARD_RECEIPTS.MANAGE_CARDS
]);

type PermUser = { permissions?: readonly string[] | null } | null | undefined;
export const can = (user: PermUser, perm: string) => Boolean(user?.permissions?.includes(perm));
export const canOpenReceipts = (user: PermUser) => PAGE_PERMISSIONS.some((p) => can(user, p));
export const canOpenCategories = (user: PermUser) => CATEGORY_PERMISSIONS.some((p) => can(user, p));

// ── Statuses ────────────────────────────────────────────────────────────────

export const STATUSES = Object.freeze([
  { key: 'missing', label: 'Missing receipt', colour: 'miss' },
  { key: 'draft', label: 'Draft', colour: 'draft' },
  { key: 'waiting', label: 'Waiting for approval', colour: 'wait' },
  { key: 'sent_back', label: 'Sent back', colour: 'back' },
  { key: 'approved', label: 'Approved', colour: 'ok' }
] as const);
export type StatusKey = typeof STATUSES[number]['key'];
export const statusOf = (key: string) => STATUSES.find((s) => s.key === key);
export const STATUS_KEYS: readonly string[] = STATUSES.map((s) => s.key);

// ── Categories ──────────────────────────────────────────────────────────────

export type CategoryFields = { customer: boolean; attendees: boolean; purpose: boolean; recurring: boolean };
export type CategoryLike = { name: string; label: string; active?: boolean; fields?: Partial<CategoryFields> | null };
export const NO_FIELDS: CategoryFields = { customer: false, attendees: false, purpose: false, recurring: false };
export const fieldsOf = (category: CategoryLike | null | undefined): CategoryFields => ({ ...NO_FIELDS, ...(category?.fields || {}) });

/** Seeded once into an empty list (owner's examples, plus the sample receipts' Fuel / Parking / Software). */
export const STARTING_CATEGORIES: readonly { label: string; fields?: Partial<CategoryFields> }[] = [
  { label: 'Travel Lunch' },
  { label: 'Customer Lunch', fields: { customer: true, attendees: true } },
  { label: 'Office Supplies' },
  { label: 'Fuel' },
  { label: 'Parking' },
  { label: 'Software & Subscriptions', fields: { recurring: true } }
];

/** The stored key of a new category: its label, lower case, words joined by "_". Never changes after. */
export const categoryKey = (label: string) =>
  String(label || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

export function cleanCategory(body: Record<string, unknown>, others: readonly { label: string; _id?: unknown }[], id?: string) {
  const label = String(body.label ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const problems: Record<string, string> = {};
  if (!label) problems.label = 'Enter a name';
  else if (others.some((o) => String(o._id) !== String(id) && o.label.toLowerCase() === label.toLowerCase())) problems.label = 'That name is already on the list';
  const f = (body.fields || {}) as Record<string, unknown>;
  const fields: CategoryFields = { customer: f.customer === true, attendees: f.attendees === true, purpose: f.purpose === true, recurring: f.recurring === true };
  return Object.keys(problems).length ? { problems } : { value: { label, fields }, problems };
}

// ── Money and dates ─────────────────────────────────────────────────────────

/** "$1,250.50", "14.32", "" → cents (null when blank, NaN when not a sum of money). Never negative. */
export function parseCents(typed: unknown): number | null {
  const text = String(typed ?? '').trim().replace(/[$,\s]/g, '');
  if (!text) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return Number.NaN;
  const cents = Math.round(Number(text) * 100);
  return cents > 10_000_000 ? Number.NaN : cents;
}
export const centsText = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));
export const formatMoney = (cents: number) =>
  `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const isMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
export const monthOf = (day: string) => day.slice(0, 7);
export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
export const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
/** 2026-10-03 → 10-03-2026, the card log's format. */
export const usDate = (day: string) => (isDay(day) ? `${day.slice(5, 7)}-${day.slice(8, 10)}-${day.slice(0, 4)}` : day);

// ── Cards ───────────────────────────────────────────────────────────────────

export const ISSUERS = Object.freeze([{ key: 'amex', label: 'American Express' }, { key: 'other', label: 'Other card' }]);
/** The card ID accounting already uses: first 4 letters of the name + the last 5 digits (MARU92069). */
export const suggestCardLabel = (name: string, digits: string) =>
  `${String(name || '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4)}${String(digits || '').replace(/\D/g, '').slice(-5)}`;

export function cleanCard(body: Record<string, unknown>) {
  const problems: Record<string, string> = {};
  const userId = String(body.userId ?? '').trim();
  const issuer = body.issuer === 'other' ? 'other' : 'amex';
  const lastDigits = String(body.lastDigits ?? '').replace(/\D/g, '');
  const label = String(body.label ?? '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 20);
  if (!userId) problems.userId = 'Choose the cardholder';
  if (!/^\d{4,5}$/.test(lastDigits)) problems.lastDigits = 'Enter the last 4 or 5 digits';
  if (!/^[A-Z0-9-]{3,20}$/.test(label)) problems.label = 'Enter the card ID, e.g. MARU92069';
  return Object.keys(problems).length ? { problems } : { value: { userId, issuer, lastDigits, label }, problems };
}

// ── Expenses ────────────────────────────────────────────────────────────────

export type ExpenseInput = {
  date: string; merchant: string; total: string; subtotal?: string; tax?: string; tip?: string;
  category: string; customerId?: string; customerName?: string; attendees?: string[]; purpose?: string;
  note?: string; recurring?: boolean; receiptUrl?: string; lostReason?: string;
};
export type CleanExpense = {
  date: string; merchant: string; cents: number; subtotalCents: number | null; taxCents: number | null; tipCents: number | null;
  category: string; customerId: string; customerName: string; attendees: string[]; purpose: string; note: string;
  recurring: boolean; receiptUrl: string; lostReason: string;
};
export type ExpenseProblems = Partial<Record<'date' | 'merchant' | 'total' | 'subtotal' | 'tax' | 'tip' | 'category' | 'customer' | 'attendees' | 'purpose' | 'receipt' | 'lostReason', string>>;

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const isReceiptUrl = (v: string) => /^https:\/\//.test(v) || v.startsWith('/uploads/');

/**
 * What a save may write, and what's wrong with it. A draft may leave the
 * category's extra fields, and the receipt, for later; only date, merchant
 * and total are needed to save at all. `complete` says whether it can go to
 * the approver.
 */
export function cleanExpense(body: Partial<ExpenseInput> & Record<string, unknown>, { today, categories }: {
  today: string; categories: readonly CategoryLike[]; currentCategory?: string;
}): { value?: CleanExpense; problems: ExpenseProblems; missing: ExpenseProblems } {
  const problems: ExpenseProblems = {};
  const date = text(body.date, 10);
  if (!isDay(date)) problems.date = 'Choose the day you paid';
  else if (date > nextDay(today)) problems.date = 'That day hasn’t happened yet';
  const merchant = text(body.merchant, 80);
  if (!merchant) problems.merchant = 'Enter where you paid';
  const cents = parseCents(body.total);
  if (cents == null) problems.total = 'Enter the total';
  else if (!Number.isFinite(cents) || cents <= 0) problems.total = 'Enter an amount like 14.32';
  const optional = (key: 'subtotal' | 'tax' | 'tip') => {
    const c = parseCents(body[key]);
    if (c != null && !Number.isFinite(c)) problems[key] = 'Enter an amount like 1.35';
    return c != null && Number.isFinite(c) ? c : null;
  };
  const subtotalCents = optional('subtotal');
  const taxCents = optional('tax');
  const tipCents = optional('tip');

  const categoryName = text(body.category, 60);
  const category = categories.find((c) => c.name === categoryName);
  if (categoryName && !category) problems.category = 'That category is no longer on the list';

  const receiptUrl = text(body.receiptUrl, 500);
  if (receiptUrl && !isReceiptUrl(receiptUrl)) problems.receipt = 'Upload the receipt again';
  const lostReason = receiptUrl ? '' : text(body.lostReason, 500);
  const attendees = (Array.isArray(body.attendees) ? body.attendees : [])
    .map((a) => text(a, 80)).filter(Boolean).slice(0, 30);
  const fields = fieldsOf(category);
  const value: CleanExpense = {
    date, merchant, cents: Number(cents), subtotalCents, taxCents, tipCents,
    category: category ? category.name : '',
    customerId: fields.customer ? text(body.customerId, 40) : '',
    customerName: fields.customer ? text(body.customerName, 120) : '',
    attendees: fields.attendees ? attendees : [],
    purpose: text(body.purpose, 500),
    note: text(body.note, 500),
    recurring: fields.recurring ? body.recurring === true : false,
    receiptUrl, lostReason
  };
  const missing = missingFor(value, category);
  return Object.keys(problems).length ? { problems, missing } : { value, problems, missing };
}

const nextDay = (day: string) => {
  if (!isDay(day)) return day;
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** What still stops an expense going to the approver. Empty = complete. */
export function missingFor(e: Pick<CleanExpense, 'receiptUrl' | 'lostReason' | 'category' | 'customerId' | 'attendees' | 'purpose'>, category: CategoryLike | null | undefined): ExpenseProblems {
  const out: ExpenseProblems = {};
  if (!e.receiptUrl && !e.lostReason) out.receipt = 'Upload the receipt, or say why it’s lost';
  if (!e.category || !category) out.category = 'Choose a category';
  const f = fieldsOf(category);
  if (f.customer && !e.customerId) out.customer = 'Choose the customer';
  if (f.attendees && !(e.attendees || []).length) out.attendees = 'Add who attended';
  if (f.purpose && !e.purpose) out.purpose = 'Say what it was for';
  return out;
}

/** One plain line for the list and the reminder: what the cardholder still has to do. */
export const missingLine = (missing: ExpenseProblems) => {
  const parts: string[] = [];
  if (missing.receipt) parts.push('upload the receipt');
  if (missing.category) parts.push('pick a category');
  if (missing.customer) parts.push('add the customer');
  if (missing.attendees) parts.push(missing.customer ? 'who attended' : 'add who attended');
  if (missing.purpose) parts.push('say what it was for');
  if (!parts.length) return '';
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]!;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
};

/** A save's status: complete → waiting for approval, else a draft (a sent-back one stays sent back until it's complete again). */
export const statusAfterSave = (complete: boolean, before?: string): StatusKey => {
  if (complete) return 'waiting';
  return before === 'sent_back' ? 'sent_back' : 'draft';
};

/** The card holder may change it while it isn't approved or voided. */
export const holderMayEdit = (e: { status: string; voided?: unknown }) => !e.voided && e.status !== 'approved';

/** Fields that differ, in words, for the history line. */
export function changeSummary(before: Partial<CleanExpense>, after: CleanExpense) {
  const names: [keyof CleanExpense, string][] = [
    ['date', 'date'], ['merchant', 'merchant'], ['cents', 'total'], ['subtotalCents', 'subtotal'], ['taxCents', 'tax'],
    ['tipCents', 'tip'], ['category', 'category'], ['customerId', 'customer'], ['attendees', 'who attended'],
    ['purpose', 'purpose'], ['note', 'note'], ['recurring', 'recurring'], ['receiptUrl', 'receipt'], ['lostReason', 'lost-receipt reason']
  ];
  return names.filter(([k]) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).map(([, n]) => n);
}

// ── Possible repeats ────────────────────────────────────────────────────────

/**
 * The same receipt saved twice: same cardholder, same day, same total. The
 * merchant isn't compared — it reads differently from photo to photo. The
 * cardholder can still save it ("Save anyway") when it really is a second
 * purchase.
 */
export function possibleRepeat<T extends { id?: string; _id?: unknown; userId: string; date: string; cents: number; voided?: unknown }>(
  list: readonly T[], next: { id?: string; userId: string; date: string; cents: number }
) {
  return list.find((e) => !e.voided && String(e.id ?? e._id) !== String(next.id)
    && e.userId === next.userId && e.date === next.date && e.cents === next.cents) || null;
}

// ── Approval ────────────────────────────────────────────────────────────────

const roleKey = (r: unknown) => String(r ?? '').trim().toLowerCase();

/** A role's saved list of the roles whose receipts it approves. */
export const cleanApproverRoles = (value: unknown) =>
  Array.isArray(value) ? [...new Set(value.map(roleKey).filter(Boolean))] : [];

/**
 * Whether `approver` may approve or send back `holder`'s expense: the Approve
 * switch, the holder's role on the approver role's list, never their own.
 */
export function canApprove({ approver, approverRoles, holder }: {
  approver: { id: string; permissions?: readonly string[] | null } | null | undefined;
  approverRoles: readonly string[] | null | undefined;
  holder: { id: string; role?: string | null } | null | undefined;
}) {
  if (!approver || !holder) return false;
  if (!can(approver, CARD_RECEIPTS.APPROVE)) return false;
  if (String(approver.id) === String(holder.id)) return false;
  return cleanApproverRoles(approverRoles).includes(roleKey(holder.role));
}

/** Approve: only a waiting one; a lost receipt needs a comment. Send back: always a comment. */
export function decisionProblem(action: 'approve' | 'send_back', e: { status: string; lostReason?: string; voided?: unknown }, comment: string) {
  if (e.voided) return 'This expense was voided.';
  if (e.status !== 'waiting') return e.status === 'approved' ? 'It’s already approved.' : 'It isn’t waiting for approval.';
  if (action === 'send_back' && !comment.trim()) return 'Say what needs fixing.';
  if (action === 'approve' && e.lostReason && !comment.trim()) return 'A lost receipt needs your comment to approve it.';
  return '';
}

// ── Totals and the list ─────────────────────────────────────────────────────

type Countable = { status: string; cents: number; voided?: unknown; userId?: string };
export function statusTotals(list: readonly Countable[]) {
  const live = list.filter((e) => !e.voided);
  const by = Object.fromEntries(STATUS_KEYS.map((k) => [k, { count: 0, cents: 0 }])) as Record<string, { count: number; cents: number }>;
  for (const e of live) {
    const t = by[e.status];
    if (t) { t.count += 1; t.cents += e.cents; }
  }
  return {
    byStatus: by,
    count: live.length,
    cents: live.reduce((s, e) => s + e.cents, 0),
    holders: new Set(live.map((e) => e.userId).filter(Boolean)).size,
    open: live.filter((e) => e.status !== 'approved').length
  };
}

// ── Excel ───────────────────────────────────────────────────────────────────

export type ExportExpense = {
  date: string; location: string; holderName: string; cardLabel: string; merchant: string; cents: number;
  category: string; customerName?: string; attendees?: string[]; purpose?: string; receiptUrl?: string; lostReason?: string;
  status: string; approval?: { byName?: string; at?: string | Date; comment?: string } | null; note?: string; recurring?: boolean;
  voided?: unknown;
};

/**
 * The export's rows. The first six columns are the card log accounting
 * keeps today, in its order and format (owner's sample, 2026-11-05); the new
 * information comes after them.
 */
export function exportRows(list: readonly ExportExpense[], categories: readonly CategoryLike[]) {
  const label = (name: string) => categories.find((c) => c.name === name)?.label || name;
  return list.filter((e) => !e.voided).map((e) => ({
    'Transaction Date': usDate(e.date),
    Location: (e.location || '').toUpperCase(),
    'C C Holder Name': (e.holderName || '').toUpperCase(),
    'Credit Card Number': e.cardLabel || '',
    Description: (e.merchant || '').toUpperCase(),
    'Spent Amount': e.cents / 100,
    Category: label(e.category),
    Customer: e.customerName || '',
    Attendees: (e.attendees || []).join(', '),
    'Business purpose': e.purpose || '',
    Note: e.note || '',
    Receipt: e.receiptUrl ? 'Yes' : e.lostReason ? `Lost: ${e.lostReason}` : 'No',
    Recurring: e.recurring ? 'Yes' : '',
    Status: statusOf(e.status)?.label || e.status,
    'Approved by': e.approval?.byName || '',
    'Approved on': e.approval?.at ? new Date(e.approval.at).toISOString().slice(0, 10) : '',
    'Approver comment': e.approval?.comment || '',
    'Receipt link': e.receiptUrl || ''
  }));
}
