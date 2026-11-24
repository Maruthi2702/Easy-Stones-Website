/**
 * Credit Card Receipts → the weekly Amex check (2026-11-20). Accounting uploads
 * Amex's activity export ("Transaction Details", .xlsx) and every charge is
 * matched to a receipt someone uploaded in our app; a charge with none becomes
 * a **Missing receipt** row for its cardholder. Shared by the server
 * (src/routes/cardReceiptStatements.ts, src/db/cardStatements/) and the screen
 * (src/features/cardReceipts/statements/).
 *
 * The owner's calls (2026-11-20):
 *   - A charge's card is found by the account's last 5 digits (Amex's
 *     "Account #", e.g. "-92069" = the card ID MARU92069), never by the name.
 *   - Amex's Reference names one charge: uploading a week twice, or weeks that
 *     overlap, never adds a line twice.
 *   - Match = the same card, the **exact** amount, dates at most 2 days apart,
 *     automatically. The cardholder enters the total with the tip.
 *   - Credits, payments and refunds, and interest and fees, need no receipt.
 *     Everything else does (freight and subscriptions included).
 *   - Only charges from `MISSING_FROM` on become Missing receipt rows; earlier
 *     ones are listed and matched but never count as missing.
 *   - Amex's "Receipt" column (`*` = an e-receipt the merchant sent Amex) is
 *     ignored: staff don't attach receipts in the Amex app.
 */

/** The first day a charge with no upload becomes a Missing receipt row (owner, 2026-11-20). */
export const MISSING_FROM = '2026-11-01';
/** How many days a receipt's date may be from Amex's (owner, 2026-11-20). */
export const MATCH_DAYS = 2;

export type AmexLine = {
  reference: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  cardMember: string;
  /** The account's last 5 digits, e.g. '92069'. */
  digits: string;
  /** Charges positive, credits and payments negative. */
  cents: number;
  extended: string;
  appearsAs: string;
  address: string;
  cityState: string;
  zip: string;
  country: string;
  amexCategory: string;
};

export type AmexRead = {
  lines: AmexLine[];
  /** Anything wrong with the file. One problem stops the import. */
  problems: string[];
  /** The period the export says it covers, else its first and last days. */
  period: { from: string; to: string } | null;
  skippedRows: number;
};

const COLUMNS = {
  date: 'date', description: 'description', cardMember: 'card member', account: 'account #', amount: 'amount',
  reference: 'reference', extended: 'extended details', appearsAs: 'appears on your statement as', address: 'address',
  cityState: 'city/state', zip: 'zip code', country: 'country', category: 'category'
} as const;
const REQUIRED = ['date', 'description', 'cardMember', 'account', 'amount', 'reference'] as const;

const cell = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v)).trim();
const norm = (v: unknown) => cell(v).toLowerCase().replace(/\s+/g, ' ');
const pad = (n: number) => String(n).padStart(2, '0');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "10/29/2026", an Excel day number or a Date → "2026-10-29"; '' when it isn't a real day. */
export function amexDay(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return amexDay(d);
  }
  const m = cell(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return '';
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** 4.99, "4.99", "$1,234.56", "-40521.63", "(12.00)" → cents; null when it isn't an amount. */
export function amexCents(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  let t = cell(v).replace(/[$,\s]/g, '');
  let sign = 1;
  if (/^\(.*\)$/.test(t)) { sign = -1; t = t.slice(1, -1); }
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return sign * Math.round(Number(t) * 100);
}

/** "-92069" → "92069"; '' when it doesn't end in 4 or 5 digits. */
export function amexDigits(v: unknown): string {
  const d = cell(v).replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-5) : '';
}

/** "Business Platinum Card® / Sep 29, 2026 to Oct 29, 2026" → the two days. */
export function periodOf(title: unknown): { from: string; to: string } | null {
  const m = cell(title).match(/([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4}) to ([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/);
  if (!m) return null;
  const day = (mon: string, d: string, y: string) => {
    const i = MONTHS.indexOf(mon.toLowerCase());
    return i < 0 ? '' : amexDay(`${i + 1}/${d}/${y}`);
  };
  const from = day(m[1]!, m[2]!, m[3]!), to = day(m[4]!, m[5]!, m[6]!);
  return from && to ? { from, to } : null;
}

/**
 * The "Transaction Details" sheet, as rows of cells (header row found by its
 * column names, so a row more or less above it doesn't matter). Any row that
 * can't be read stops the import, with its row number.
 */
export function readAmexActivity(rows: readonly (readonly unknown[])[]): AmexRead {
  const headerAt = rows.findIndex((r) => {
    const names = new Set((r || []).map(norm));
    return REQUIRED.every((k) => names.has(COLUMNS[k]));
  });
  if (headerAt < 0) {
    return { lines: [], problems: ['This isn’t Amex’s activity export: no row has the columns Date, Description, Card Member, Account #, Amount and Reference.'], period: null, skippedRows: 0 };
  }
  const header = rows[headerAt]!.map(norm);
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, name]) => [k, header.indexOf(name)])) as Record<keyof typeof COLUMNS, number>;
  const at = (r: readonly unknown[], k: keyof typeof COLUMNS) => (col[k] >= 0 ? r[col[k]] : '');
  const problems: string[] = [];
  const lines: AmexLine[] = [];
  const seen = new Map<string, number>();
  let skippedRows = 0;
  rows.slice(headerAt + 1).forEach((r, i) => {
    const rowNo = headerAt + i + 2;
    if (!r || r.every((v) => cell(v) === '')) { skippedRows += 1; return; }
    const date = amexDay(at(r, 'date'));
    const cents = amexCents(at(r, 'amount'));
    const digits = amexDigits(at(r, 'account'));
    const reference = cell(at(r, 'reference')).replace(/^'/, '');
    const wrong = [!date && 'date', cents == null && 'amount', !digits && 'Account #', !reference && 'Reference'].filter(Boolean);
    if (wrong.length) { problems.push(`Row ${rowNo}: can’t read its ${wrong.join(', ')}.`); return; }
    if (seen.has(reference)) { problems.push(`Row ${rowNo}: Reference ${reference} is also on row ${seen.get(reference)}.`); return; }
    seen.set(reference, rowNo);
    lines.push({
      reference, date, cents: cents!, digits,
      description: cell(at(r, 'description')).replace(/\s+/g, ' ').slice(0, 200),
      cardMember: cell(at(r, 'cardMember')).replace(/\s+/g, ' ').slice(0, 120),
      extended: cell(at(r, 'extended')).slice(0, 1000),
      appearsAs: cell(at(r, 'appearsAs')).replace(/\s+/g, ' ').slice(0, 200),
      address: cell(at(r, 'address')).slice(0, 200),
      cityState: cell(at(r, 'cityState')).slice(0, 120),
      zip: cell(at(r, 'zip')).slice(0, 20),
      country: cell(at(r, 'country')).slice(0, 60),
      amexCategory: cell(at(r, 'category')).slice(0, 120)
    });
  });
  if (!lines.length && !problems.length) problems.push('The file has no transactions under its header row.');
  // The title sits in the first rows' cells: "Business Platinum Card® / Sep 29, 2026 to Oct 29, 2026".
  let period: AmexRead['period'] = null;
  for (const r of rows.slice(0, headerAt)) for (const v of r || []) period ||= periodOf(v);
  if (!period && lines.length) {
    const days = lines.map((l) => l.date).sort();
    period = { from: days[0]!, to: days.at(-1)! };
  }
  return { lines, problems, period, skippedRows };
}

// ── What each line needs ────────────────────────────────────────────────────

export type LineKind = 'charge' | 'credit' | 'fee';

/** Credits / payments / refunds (zero or less), interest and fees (no receipt), else a charge. */
export function kindOf(line: Pick<AmexLine, 'cents' | 'description' | 'amexCategory'>): LineKind {
  if (line.cents <= 0) return 'credit';
  if (/^fees\s*&\s*adjustments/i.test(line.amexCategory)) return 'fee';
  // A card processor's or portal's own fee: "JPMC FEE", "TN SERV FEE", "TEXAS.GOV*SERVICEFEE", "CONVENIENCE FEE".
  // Any other FEE is a purchase (a permit, recording or filing fee) and needs its receipt (owner, 2026-11-24).
  if (/^JPMC FEE\b|\b(SERV|SERVICE|CONVENIENCE|PROCESSING|ANNUAL|LATE|FOREIGN TRANSACTION|CARD DELIVERY)\s*FEE\b|SERVICEFEE/i.test(line.description)) return 'fee';
  return 'charge';
}

export const LINE_STATUSES = [
  { key: 'missing', label: 'Missing receipt' },
  { key: 'matched', label: 'Receipt uploaded' },
  /** An Admin's charge with no upload: it waits for Accounting, who fills in the category and approves it (2026-11-23). */
  { key: 'awaiting', label: 'Waiting for Accounting' },
  { key: 'no_card', label: 'Card not set up' },
  { key: 'unassigned', label: 'Waiting for a login' },
  { key: 'before_start', label: 'Before the check started' },
  { key: 'no_receipt', label: 'No receipt needed' }
] as const;
export type LineStatus = typeof LINE_STATUSES[number]['key'];
export const lineStatusLabel = (key: string) => LINE_STATUSES.find((s) => s.key === key)?.label || key;

/** Where a line stands, from what it's linked to. */
export function lineStatus(l: { kind: LineKind; date: string; cardId: string | null; expenseStatus: string | null; expenseVoided?: boolean;
  /** The card exists but nobody holds it yet: no one to ask for the receipt. */ unassigned?: boolean;
  /** The linked expense has a receipt or a lost-receipt reason (default true: older callers don't say). */ hasReceipt?: boolean },
  missingFrom = MISSING_FROM): LineStatus {
  if (l.kind !== 'charge') return 'no_receipt';
  if (l.expenseStatus && !l.expenseVoided) {
    if (l.expenseStatus === 'missing') return 'missing';
    return l.expenseStatus === 'waiting' && l.hasReceipt === false ? 'awaiting' : 'matched';
  }
  if (l.date < missingFrom) return 'before_start';
  if (!l.cardId) return 'no_card';
  if (l.unassigned) return 'unassigned';
  return 'missing';
}

export function statusCounts(list: readonly { status: LineStatus; cents: number }[]) {
  const by = Object.fromEntries(LINE_STATUSES.map((s) => [s.key, { count: 0, cents: 0 }])) as Record<LineStatus, { count: number; cents: number }>;
  for (const l of list) { by[l.status].count += 1; by[l.status].cents += l.cents; }
  return by;
}

// ── Cards ───────────────────────────────────────────────────────────────────

/** The banks whose statements are checked. Encore joined Amex on 2026-11-21 (src/utils/encoreStatement.ts). */
export type Issuer = 'amex' | 'encore';
export const issuerLabel = (issuer: string) => (issuer === 'encore' ? 'Encore' : 'Amex');

type CardLike = { id: string; lastDigits: string; active: boolean; issuer?: string };

/**
 * The card a line's digits name: an exact 5-digit card first, else one saved
 * with its last 4; an active card before a deactivated one. Two that fit
 * equally → none (someone must sort the cards out). An Encore line only fits
 * an Encore card (last 4 digits), and an Amex line never fits one — the same
 * four digits on two banks are two different cards.
 */
export function cardForDigits<C extends CardLike>(cards: readonly C[], digits: string, issuer: Issuer = 'amex'): C | null {
  const sameBank = (c: C) => (issuer === 'encore' ? c.issuer === 'encore' : c.issuer !== 'encore');
  const fits = (c: C) => sameBank(c) && digits.length >= 4 && c.lastDigits.length >= 4 && digits.endsWith(c.lastDigits);
  const rank = (c: C) => (c.lastDigits.length === 5 ? 0 : 2) + (c.active ? 0 : 1);
  const found = cards.filter(fits).sort((a, b) => rank(a) - rank(b));
  if (!found.length) return null;
  if (found.length > 1 && rank(found[0]!) === rank(found[1]!)) return null;
  return found[0]!;
}

/** The staff person whose name has every word of Amex's Card Member name, when exactly one does. */
export function suggestHolder<P extends { id: string; name: string; active: boolean }>(people: readonly P[], cardMember: string): P | null {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  const want = words(cardMember);
  if (!want.length) return null;
  const first = want[0]!, last = want.at(-1)!;
  const hits = people.filter((p) => p.active && (() => { const w = words(p.name); return w.includes(first) && w.includes(last); })());
  return hits.length === 1 ? hits[0]! : null;
}

/** The unknown cards in a set of lines that have a charge: one row per digits, the name Amex prints most, its charges. */
export function unknownCards(lines: readonly { digits: string; cardMember: string; cents: number; kind: LineKind; date: string; cardId: string | null; issuer?: string }[]) {
  const by = new Map<string, { issuer: Issuer; digits: string; names: Map<string, number>; charges: number; cents: number; first: string; last: string }>();
  for (const l of lines) {
    if (l.cardId) continue;
    const issuer: Issuer = l.issuer === 'encore' ? 'encore' : 'amex';
    const key = `${issuer}:${l.digits}`;
    const row = by.get(key) || { issuer, digits: l.digits, names: new Map(), charges: 0, cents: 0, first: l.date, last: l.date };
    row.names.set(l.cardMember, (row.names.get(l.cardMember) || 0) + 1);
    if (l.kind === 'charge') { row.charges += 1; row.cents += l.cents; }
    if (l.date < row.first) row.first = l.date;
    if (l.date > row.last) row.last = l.date;
    by.set(key, row);
  }
  // A card with only payments, credits or fees on it needs nobody's receipt, so nobody needs to set it up.
  return [...by.values()].filter((r) => r.charges > 0).map((r) => ({
    issuer: r.issuer, digits: r.digits, cardMember: [...r.names.entries()].sort((a, b) => b[1] - a[1])[0]![0], charges: r.charges, cents: r.cents, first: r.first, last: r.last
  })).sort((a, b) => a.cardMember.localeCompare(b.cardMember));
}

// ── Matching ────────────────────────────────────────────────────────────────

export const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;

export type MatchLine = { reference: string; date: string; cents: number; kind: LineKind; cardId: string | null; expenseId: string | null };
export type MatchExpense = { id: string; cardId: string; date: string; cents: number; status: string; voided: boolean; createdAt?: string | Date };
export type MatchPlan = {
  /** Lines to point at an upload (or away from a voided one: expenseId null). */
  link: { reference: string; expenseId: string | null }[];
  /** Missing receipt rows to make, one per line. */
  create: string[];
  /** Missing receipt rows an upload now covers: void them (the line points at the upload). */
  retire: { expenseId: string; reference: string; by: string }[];
};

/**
 * What to change so every charge points at its upload: the same card, the
 * exact amount, at most `MATCH_DAYS` apart, nearest day first (then the
 * earliest saved). An upload answers one charge. A charge keeps the upload it
 * has; a Missing receipt row is swapped for a real upload when one appears.
 * A charge from `missingFrom` on with no upload gets a Missing receipt row.
 */
export function planMatches({ lines, expenses, missingFrom = MISSING_FROM }: {
  lines: readonly MatchLine[]; expenses: readonly MatchExpense[]; missingFrom?: string;
}): MatchPlan {
  const plan: MatchPlan = { link: [], create: [], retire: [] };
  const byId = new Map(expenses.map((e) => [e.id, e]));
  const taken = new Set<string>();
  for (const l of lines) {
    const e = l.expenseId ? byId.get(l.expenseId) : undefined;
    if (e && !e.voided) taken.add(e.id);
  }
  const at = (e: MatchExpense) => (e.createdAt ? new Date(e.createdAt).getTime() : 0);
  const ordered = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  for (const l of ordered) {
    if (l.kind !== 'charge' || !l.cardId) continue;
    const current = l.expenseId ? byId.get(l.expenseId) : undefined;
    if (current && !current.voided && current.status !== 'missing') continue;
    const candidate = expenses
      .filter((e) => !e.voided && e.status !== 'missing' && !taken.has(e.id) && e.cardId === l.cardId
        && e.cents === l.cents && daysApart(e.date, l.date) <= MATCH_DAYS)
      .sort((a, b) => daysApart(a.date, l.date) - daysApart(b.date, l.date) || at(a) - at(b) || a.id.localeCompare(b.id))[0];
    if (candidate) {
      taken.add(candidate.id);
      plan.link.push({ reference: l.reference, expenseId: candidate.id });
      if (current && !current.voided) plan.retire.push({ expenseId: current.id, reference: l.reference, by: candidate.id });
      continue;
    }
    if (current && !current.voided) continue; // its Missing receipt row stays
    if (current) plan.link.push({ reference: l.reference, expenseId: null });
    if (l.date >= missingFrom) plan.create.push(l.reference);
  }
  return plan;
}

/**
 * Near matches (2026-11-24, review B2): the automatic match stays exact (owner, 2026-11-20), but a charge
 * with a Missing receipt row offers the holder their own receipts that are *close* — a tip changed, a total
 * mistyped, a hotel that posted days later — so they pick "This is my receipt" instead of uploading the
 * same receipt a second time (which put one purchase in the Excel twice).
 * Close = at most `NEAR_DAYS` apart and the amounts within `NEAR_CENTS` or `NEAR_SHARE` of the charge,
 * whichever is wider. Never automatic: a person confirms each one.
 */
export const NEAR_DAYS = 7;
export const NEAR_CENTS = 500;
export const NEAR_SHARE = 0.1;

export const isNearMatch = (charge: { date: string; cents: number }, receipt: { date: string; cents: number }) =>
  daysApart(charge.date, receipt.date) <= NEAR_DAYS
  && Math.abs(charge.cents - receipt.cents) <= Math.max(NEAR_CENTS, Math.round(Math.abs(charge.cents) * NEAR_SHARE));

/** The receipts close to a charge, closest first: the amount nearest, then the day nearest. */
export function nearMatches<T extends { id: string; date: string; cents: number }>(charge: { date: string; cents: number }, receipts: readonly T[]): T[] {
  return receipts.filter((r) => isNearMatch(charge, r))
    .sort((a, b) => Math.abs(a.cents - charge.cents) - Math.abs(b.cents - charge.cents)
      || daysApart(a.date, charge.date) - daysApart(b.date, charge.date) || a.id.localeCompare(b.id));
}

/** "AMAZON PRIME*UC99N4EAMZN.COM/BILL       WA" → one-spaced, at most 80 characters (an expense's merchant). */
export const merchantOf = (description: string, bank = 'Amex') => description.replace(/\s+/g, ' ').trim().slice(0, 80) || `${bank} charge`;
