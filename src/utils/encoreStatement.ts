/**
 * Credit Card Receipts → the Encore check (2026-11-21): the second bank beside Amex. Accounting
 * uploads Encore's "Transactions" export (.xlsx, one sheet, one row per transaction) and every
 * charge is matched to a receipt exactly as Amex's are (rules in src/utils/amexStatement.ts, which
 * both banks share; the data layer is src/db/cardStatements/).
 *
 * The owner's calls (2026-11-21): Encore cards are **additional** to Amex (a person may hold one
 * of each, and there are new people too); a card is found by its **last 4 digits** (Encore masks
 * the rest), the Originating Account Name only suggests the holder; a receipt matches on the day
 * the purchase **Occurred**, within 2 days, exact amount.
 *
 * Differences from Amex's file this reader absorbs:
 *   - dates are Excel day numbers or "10/15/26" (two-digit year);
 *   - the card is "448462******3992" (the account the card belongs to is a different column);
 *   - Reference Number is not unique per row (a fee shares its charge's reference, a card-delivery
 *     fee on two cards shares one) and a few rows (annual fee, the auto payment) have none, so a
 *     line's key is built from the reference, the card, the amount and, with no reference, the day
 *     and merchant: uploading a file twice, or overlapping files, never adds a line twice;
 *   - the payment to Encore ("AUTO PAYMENT DEDUCTION") has no card: it is stored with no digits.
 */
import { amexDay, amexCents, type AmexLine, type AmexRead } from './amexStatement.ts';

export const ENCORE_KEY_PREFIX = 'ENC-';

const COLUMNS = {
  posted: 'posted', occurred: 'occurred', merchant: 'merchant name', city: 'merchant city', state: 'merchant state', zip: 'merchant zip code',
  country: 'merchant country', holder: 'originating account name', card: 'originating account number', mcc: 'mcc description',
  billed: 'billed amount', kind: 'debit credit', reference: 'reference number'
} as const;
const REQUIRED = ['occurred', 'merchant', 'card', 'billed', 'kind', 'reference'] as const;

const cell = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v)).trim();
const norm = (v: unknown) => cell(v).toLowerCase().replace(/\s+/g, ' ');

/** "10/15/26", "10/15/2026", an Excel day number or a Date → "2026-10-15"; '' when it isn't a real day. */
export function encoreDay(v: unknown): string {
  const t = cell(v);
  const m = typeof v === 'string' ? t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/) : null;
  if (m) return amexDay(`${m[1]}/${m[2]}/20${m[3]}`);
  return amexDay(typeof v === 'string' ? t : v);
}

/** "448462******3992" → "3992"; '' when there is no card (the payment row). */
export function encoreDigits(v: unknown): string {
  const m = cell(v).match(/(\d{4})$/);
  return m ? m[1]! : '';
}

/** A short, stable hash for a row with no reference (two 32-bit FNV-1a passes → 16 hex characters). */
export function shortHash(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** The key one Encore row is stored under (the primary key of card_statement_lines). */
export function encoreKey({ reference, digits, cents, date, description }: { reference: string; digits: string; cents: number; date: string; description: string }) {
  return reference
    ? `${ENCORE_KEY_PREFIX}${reference}-${digits || 'x'}-${cents}`
    : `${ENCORE_KEY_PREFIX}h-${shortHash(`${date}|${description}|${digits}|${cents}`)}`;
}

/** The "Transactions" sheet as rows of cells. A row that can't be read stops the import, with its row number. */
export function readEncoreActivity(rows: readonly (readonly unknown[])[]): AmexRead {
  const headerAt = rows.findIndex((r) => {
    const names = new Set((r || []).map(norm));
    return REQUIRED.every((k) => names.has(COLUMNS[k]));
  });
  if (headerAt < 0) {
    return { lines: [], problems: ['This isn’t Encore’s transactions export: no row has the columns Occurred, Merchant Name, Originating Account Number, Billed Amount, Debit Credit and Reference Number.'], period: null, skippedRows: 0 };
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
    const date = encoreDay(at(r, 'occurred')) || encoreDay(at(r, 'posted'));
    const flag = cell(at(r, 'kind')).toUpperCase();
    let cents = amexCents(at(r, 'billed'));
    const digits = encoreDigits(at(r, 'card'));
    const reference = cell(at(r, 'reference'));
    const description = cell(at(r, 'merchant')).replace(/\s+/g, ' ').slice(0, 200);
    if (cents != null && flag === 'C' && cents > 0) cents = -cents;
    const wrong = [!date && 'date', cents == null && 'Billed Amount', flag !== 'D' && flag !== 'C' && 'Debit Credit', !description && 'Merchant Name',
      // Only a payment or credit may have no card.
      !digits && (cents ?? 0) > 0 && 'card number'].filter(Boolean);
    if (wrong.length) { problems.push(`Row ${rowNo}: can’t read its ${wrong.join(', ')}.`); return; }
    const key = encoreKey({ reference, digits, cents: cents!, date, description });
    if (seen.has(key)) { problems.push(`Row ${rowNo}: is the same transaction as row ${seen.get(key)} (same reference, card and amount).`); return; }
    seen.set(key, rowNo);
    const city = cell(at(r, 'city')), state = cell(at(r, 'state'));
    lines.push({
      reference: key, date, cents: cents!, digits, description,
      cardMember: cell(at(r, 'holder')).replace(/\s+/g, ' ').slice(0, 120),
      extended: '', appearsAs: '', address: '',
      cityState: [city, state].filter(Boolean).join(', ').slice(0, 120),
      zip: cell(at(r, 'zip')).slice(0, 20), country: cell(at(r, 'country')).slice(0, 60),
      amexCategory: cell(at(r, 'mcc')).slice(0, 120)
    });
  });
  if (!lines.length && !problems.length) problems.push('The file has no transactions under its header row.');
  let period: AmexRead['period'] = null;
  if (lines.length) {
    const days = lines.map((l) => l.date).sort();
    period = { from: days[0]!, to: days.at(-1)! };
  }
  return { lines, problems, period, skippedRows };
}
