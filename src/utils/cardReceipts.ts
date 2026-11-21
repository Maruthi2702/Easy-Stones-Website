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
  /** Everyone on the caller's team, by the rep's branch (src/utils/teamScope.ts), like Visits → View branch. */
  VIEW_BRANCH: 'view_branch_card_receipts',
  APPROVE: 'approve_card_receipts',
  EXPORT: 'export_card_receipts',
  MANAGE_CARDS: 'manage_company_cards',
  /** Upload Amex's activity export and see every charge matched to a receipt (src/utils/amexStatement.ts). */
  STATEMENTS: 'check_amex_statements',
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
  CARD_RECEIPTS.USE, CARD_RECEIPTS.VIEW_ALL, CARD_RECEIPTS.VIEW_BRANCH, CARD_RECEIPTS.APPROVE, CARD_RECEIPTS.MANAGE_CARDS, CARD_RECEIPTS.STATEMENTS
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
/**
 * A type under a category (owner, 2026-11-20): Gas → Car / Truck / Van / Forklift, Food → Travel Lunch / Customer
 * Lunch / Office Team Lunch. Managers add, rename, hide and reorder them in Admin; `name` is what expenses store and
 * never changes; one shown type is the default (the form pre-selects it); a type may ask for more than its category.
 */
export type SubcategoryLike = { name: string; label: string; active?: boolean; isDefault?: boolean; fields?: Partial<CategoryFields> | null };
export type CategoryLike = {
  name: string; label: string; active?: boolean; fields?: Partial<CategoryFields> | null; subcategories?: readonly SubcategoryLike[] | null;
};
export const NO_FIELDS: CategoryFields = { customer: false, attendees: false, purpose: false, recurring: false };
/** What a receipt under this category — and its type, when it has one — asks for: the category's asks plus the type's. */
export const fieldsOf = (category: CategoryLike | null | undefined, subcategory = ''): CategoryFields => {
  const base = { ...NO_FIELDS, ...(category?.fields || {}) };
  const sub = subcategory ? (category?.subcategories || []).find((s) => s.name === subcategory)?.fields : null;
  return sub
    ? { customer: base.customer || sub.customer === true, attendees: base.attendees || sub.attendees === true, purpose: base.purpose || sub.purpose === true, recurring: base.recurring || sub.recurring === true }
    : base;
};
/** The types a new receipt may pick (hidden ones stay valid on the receipts that have them). */
export const shownSubs = (category: CategoryLike | null | undefined): readonly SubcategoryLike[] => (category?.subcategories || []).filter((s) => s.active !== false);
/** The type the form starts on: the one marked default, else the first shown. */
export const defaultSubOf = (category: CategoryLike | null | undefined): SubcategoryLike | undefined => {
  const shown = shownSubs(category);
  return shown.find((s) => s.isDefault) || shown[0];
};
export const subLabel = (category: CategoryLike | null | undefined, name: string) =>
  name ? (category?.subcategories || []).find((s) => s.name === name)?.label || name.replace(/_/g, ' ') : '';

export type StartingCategory = { label: string; fields?: Partial<CategoryFields>; subcategories?: readonly { label: string; fields?: Partial<CategoryFields> }[] };
/** Seeded once into an empty list (owner's examples, plus the sample receipts' Fuel / Parking / Software). Types are added in Admin. */
export const STARTING_CATEGORIES: readonly StartingCategory[] = [
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

/** A starting category as the stored record's types: the first is the default. */
export const startingSubcategories = (c: StartingCategory) => (c.subcategories || []).map((s, i) => ({
  name: categoryKey(s.label), label: s.label, active: true, isDefault: i === 0, fields: { ...NO_FIELDS, ...(s.fields || {}) }
}));

const MAX_SUBCATEGORIES = 20;
/**
 * The types a manager sent for one category, cleaned. An existing type keeps its stored `name` (only a name already on
 * `current` is believed); a new one gets a key from its label. Labels are unique within the category; one shown type is
 * the default (the one flagged, else the first). Never deleted, only hidden: receipts keep their type.
 */
export function cleanSubcategories(raw: unknown, current: readonly SubcategoryLike[] = []) {
  const problems: Record<string, string> = {};
  const list = Array.isArray(raw) ? raw.slice(0, MAX_SUBCATEGORIES) : [];
  const known = new Set(current.map((s) => s.name));
  const used = new Set<string>();
  const labels = new Set<string>();
  const out: { name: string; label: string; active: boolean; isDefault: boolean; fields: CategoryFields }[] = [];
  for (const item of list) {
    const r = (item || {}) as Record<string, unknown>;
    const label = String(r.label ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!label) { problems.subcategories = 'Every type needs a name'; continue; }
    if (labels.has(label.toLowerCase())) { problems.subcategories = `"${label}" is on the list twice`; continue; }
    labels.add(label.toLowerCase());
    let name = typeof r.name === 'string' && known.has(r.name) && !used.has(r.name) ? r.name : '';
    if (!name) {
      const key = categoryKey(label) || 'type';
      name = key;
      for (let n = 2; used.has(name) || known.has(name); n += 1) name = `${key}_${n}`;
    }
    used.add(name);
    const f = (r.fields || {}) as Record<string, unknown>;
    out.push({
      name, label, active: r.active !== false, isDefault: r.isDefault === true,
      fields: { customer: f.customer === true, attendees: f.attendees === true, purpose: f.purpose === true, recurring: f.recurring === true }
    });
  }
  const chosen = out.filter((s) => s.active).find((s) => s.isDefault) || out.find((s) => s.active);
  for (const s of out) s.isDefault = s === chosen;
  return { value: out, problems };
}

export function cleanCategory(body: Record<string, unknown>, others: readonly { label: string; _id?: unknown }[], id?: string, current: readonly SubcategoryLike[] = []) {
  const label = String(body.label ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const problems: Record<string, string> = {};
  if (!label) problems.label = 'Enter a name';
  else if (others.some((o) => String(o._id) !== String(id) && o.label.toLowerCase() === label.toLowerCase())) problems.label = 'That name is already on the list';
  const f = (body.fields || {}) as Record<string, unknown>;
  const fields: CategoryFields = { customer: f.customer === true, attendees: f.attendees === true, purpose: f.purpose === true, recurring: f.recurring === true };
  // Types not sent (a hide / show toggle) stay as they are.
  const subs = body.subcategories === undefined
    ? { value: current.map((s) => ({ name: s.name, label: s.label, active: s.active !== false, isDefault: s.isDefault === true, fields: { ...NO_FIELDS, ...(s.fields || {}) } })), problems: {} as Record<string, string> }
    : cleanSubcategories(body.subcategories, current);
  Object.assign(problems, subs.problems);
  return Object.keys(problems).length ? { problems } : { value: { label, fields, subcategories: subs.value }, problems };
}

// ── Money and dates ─────────────────────────────────────────────────────────

/** "$1,250.50", "14.32", "" → cents (null when blank, NaN when not a sum of money). Never negative. */
export function parseCents(typed: unknown): number | null {
  const raw = String(typed ?? '').trim();
  if (!raw) return null;
  // Whole format first: one optional leading $, then digits (grouped by commas in threes, or none), then up to 2 decimals.
  // "12,34", "1 2.34" and "1$2.34" are refused rather than read as a different amount.
  if (!/^\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d{0,2})?$/.test(raw)) return Number.NaN;
  const text = raw.replace(/[$,\s]/g, '');
  const cents = Math.round(Number(text) * 100);
  return cents > 10_000_000 ? Number.NaN : cents;
}
/** A receipt over this (strictly more than $150.00) is marked gold so approvers see it. */
export const BIG_RECEIPT_CENTS = 15_000;
export const isBigReceipt = (cents: number | null | undefined) => (cents ?? 0) > BIG_RECEIPT_CENTS;
/** Over the limit a receipt needs two steps (owner, 2026-11-19): the usual approver, then one of these roles, per receipt. Limits per role come later. */
export const SAME_PERSON_BOTH_STEPS = false; // my default — owner unanswered
export const BIG_RECEIPT_APPROVER_ROLES: readonly string[] = ['accounting', 'director', 'admin'];
export const isBigReceiptApprover = (role: unknown) => BIG_RECEIPT_APPROVER_ROLES.includes(roleKey(role));
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

/** `allowUnassigned`: a card with no holder yet (set up from the Amex check) may be saved without one, e.g. to deactivate it. */
export function cleanCard(body: Record<string, unknown>, { allowUnassigned = false }: { allowUnassigned?: boolean } = {}) {
  const problems: Record<string, string> = {};
  const userId = String(body.userId ?? '').trim();
  const issuer = body.issuer === 'other' ? 'other' : 'amex';
  const lastDigits = String(body.lastDigits ?? '').replace(/\D/g, '');
  const label = String(body.label ?? '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 20);
  // The name as Amex prints it, upper case and single-spaced; blank is fine.
  const amexName = String(body.amexName ?? '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 120);
  const location = String(body.location ?? '').trim().slice(0, 80);
  if (!userId && !allowUnassigned) problems.userId = 'Choose the cardholder';
  if (!/^\d{4,5}$/.test(lastDigits)) problems.lastDigits = 'Enter the last 4 or 5 digits';
  if (!/^[A-Z0-9-]{3,20}$/.test(label)) problems.label = 'Enter the card ID, e.g. MARU92069';
  return Object.keys(problems).length ? { problems } : { value: { userId, issuer, lastDigits, label, amexName, location }, problems };
}

// ── Expenses ────────────────────────────────────────────────────────────────

export type ExpenseInput = {
  date: string; merchant: string; total: string; subtotal?: string; tax?: string; tip?: string;
  category: string; subcategory?: string; customerId?: string; customerName?: string; attendees?: string[]; purpose?: string;
  note?: string; recurring?: boolean; receiptUrl?: string; lostReason?: string;
};
export type CleanExpense = {
  date: string; merchant: string; cents: number; subtotalCents: number | null; taxCents: number | null; tipCents: number | null;
  category: string; subcategory: string; customerId: string; customerName: string; attendees: string[]; purpose: string; note: string;
  recurring: boolean; receiptUrl: string; lostReason: string;
};
export type ExpenseProblems = Partial<Record<'date' | 'merchant' | 'total' | 'subtotal' | 'tax' | 'tip' | 'category' | 'subcategory' | 'customer' | 'attendees' | 'purpose' | 'receipt' | 'lostReason', string>>;

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const isReceiptUrl = (v: string) => /^https:\/\//.test(v) || v.startsWith('/uploads/') || Boolean(privateReceiptNameOf(v));

/**
 * What a save may write, and what's wrong with it. A draft may leave the
 * category's extra fields, and the receipt, for later; only date, merchant
 * and total are needed to save at all. `complete` says whether it can go to
 * the approver.
 */
export function cleanExpense(body: Partial<ExpenseInput> & Record<string, unknown>, { today, categories, currentSubcategory = '' }: {
  today: string; categories: readonly CategoryLike[]; currentCategory?: string; currentSubcategory?: string;
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
  // The type under it: one of the category's own; a hidden one only where the expense already has it.
  const subName = text(body.subcategory, 60);
  let subcategory = '';
  if (category && subName && (category.subcategories || []).length) {
    const found = (category.subcategories || []).find((s) => s.name === subName);
    if (!found || (found.active === false && subName !== currentSubcategory)) problems.subcategory = 'That type is no longer on the list';
    else subcategory = found.name;
  }

  const receiptUrl = text(body.receiptUrl, 500);
  if (receiptUrl && !isReceiptUrl(receiptUrl)) problems.receipt = 'Upload the receipt again';
  const lostReason = receiptUrl ? '' : text(body.lostReason, 500);
  const attendees = (Array.isArray(body.attendees) ? body.attendees : [])
    .map((a) => text(a, 80)).filter(Boolean).slice(0, 30);
  const fields = fieldsOf(category, subcategory);
  const value: CleanExpense = {
    date, merchant, cents: Number(cents), subtotalCents, taxCents, tipCents,
    category: category ? category.name : '', subcategory,
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
export function missingFor(e: Pick<CleanExpense, 'receiptUrl' | 'lostReason' | 'category' | 'customerId' | 'attendees' | 'purpose'> & { subcategory?: string }, category: CategoryLike | null | undefined): ExpenseProblems {
  const out: ExpenseProblems = {};
  if (!e.receiptUrl && !e.lostReason) out.receipt = 'Upload the receipt, or say why it’s lost';
  if (!e.category || !category) out.category = 'Choose a category';
  // A category with types needs one picked.
  else if (shownSubs(category).length && !e.subcategory) out.subcategory = 'Choose the type';
  const f = fieldsOf(category, e.subcategory || '');
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
  if (missing.subcategory) parts.push('pick the type');
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

/**
 * An expense that answers an Amex charge keeps Amex's day and amount (owner, 2026-11-20): what the
 * holder may still change is the category, customer, attendees, purpose, note and receipt.
 */
export const matchedChangeProblem = (before: { date: string; cents: number }, after: { date: string; cents: number }) =>
  before.date !== after.date || before.cents !== after.cents
    ? 'This is matched to a charge on the Amex statement, so its date and total can’t be changed.'
    : '';

/**
 * A receipt kept privately (2026-11-20): the file sits in S3 under `private/CardReceipts/`, which the CDN doesn't
 * serve, and the expense stores this app address instead of a public link. Opening it asks the server
 * (GET /api/card-receipts/files/:name), which checks who is asking.
 */
export const PRIVATE_RECEIPT_ROUTE = '/api/card-receipts/files/';
export const PRIVATE_RECEIPT_KEY_PREFIX = 'private/CardReceipts/';
const PRIVATE_NAME = /^(?:img|pdf)_\d{10,14}_[0-9a-f]{24}\.[a-z0-9]{3,4}$/;
export const isPrivateReceiptName = (name: unknown): name is string => typeof name === 'string' && PRIVATE_NAME.test(name);
/** The file name inside a private receipt address, or '' when it isn't one. */
export const privateReceiptNameOf = (url: unknown): string => {
  if (typeof url !== 'string' || !url.startsWith(PRIVATE_RECEIPT_ROUTE)) return '';
  const name = url.slice(PRIVATE_RECEIPT_ROUTE.length);
  return isPrivateReceiptName(name) ? name : '';
};
/** The address saved on an expense for a private file stored at `key` (private/CardReceipts/<name>), or ''. */
export const privateReceiptUrlOfKey = (key: string): string => {
  if (!key.startsWith(PRIVATE_RECEIPT_KEY_PREFIX)) return '';
  const name = key.slice(PRIVATE_RECEIPT_KEY_PREFIX.length);
  return isPrivateReceiptName(name) ? `${PRIVATE_RECEIPT_ROUTE}${name}` : '';
};

/** A receipt's own file: stored by this app in the CardReceipts folder (never any other link or file). */
export const isReceiptFolderUrl = (url: unknown): boolean =>
  Boolean(privateReceiptNameOf(url)) || (typeof url === 'string' && /\/CardReceipts\/[^/?#]+$/.test(url.split('?')[0] || ''));

/** The card holder may change it while it isn't approved or voided. */
export const holderMayEdit = (e: { status: string; voided?: unknown }) => !e.voided && e.status !== 'approved';

/** Fields that differ, in words, for the history line. */
export function changeSummary(before: Partial<CleanExpense>, after: CleanExpense) {
  const names: [keyof CleanExpense, string][] = [
    ['date', 'date'], ['merchant', 'merchant'], ['cents', 'total'], ['subtotalCents', 'subtotal'], ['taxCents', 'tax'],
    ['tipCents', 'tip'], ['category', 'category'], ['subcategory', 'type'], ['customerId', 'customer'], ['attendees', 'who attended'],
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
export function canApprove({ approver, approverRoles, holder, cents, step1By }: {
  approver: { id: string; role?: string | null; permissions?: readonly string[] | null } | null | undefined;
  approverRoles: readonly string[] | null | undefined;
  holder: { id: string; role?: string | null } | null | undefined;
  /** The receipt's total (over $150 it needs a second, Accounting step). */
  cents?: number | null;
  /** Who gave step 1 of a receipt over $150 (its `approval.by`); blank while step 1 is still to do. */
  step1By?: string | null;
}) {
  if (!approver || !holder) return false;
  if (!can(approver, CARD_RECEIPTS.APPROVE)) return false;
  if (String(approver.id) === String(holder.id)) return false;
  if (isBigReceipt(cents) && step1By) {
    // Step 2: Accounting / Director / Admin, any holder or branch, and not the person who gave step 1.
    return isBigReceiptApprover(approver.role) && (SAME_PERSON_BOTH_STEPS || String(approver.id) !== String(step1By));
  }
  // Step 1 (and the only step up to $150): the holder's role is on the approver role's list.
  return cleanApproverRoles(approverRoles).includes(roleKey(holder.role));
}

/** Which approval a waiting receipt needs next: 1 (the usual approver), 2 (Accounting, over $150 after step 1), or 0. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- takes a stored record or a view row alike
export const approvalStep = (e: Record<string, any>): 0 | 1 | 2 =>
  e.status !== 'waiting' || e.voided ? 0 : isBigReceipt(e.cents) && e.approval?.by ? 2 : 1;

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
  category: string; subcategory?: string; customerName?: string; attendees?: string[]; purpose?: string; receiptUrl?: string; lostReason?: string;
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
    'Sub-category': subLabel(categories.find((c) => c.name === e.category), e.subcategory || ''),
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
