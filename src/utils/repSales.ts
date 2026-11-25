import { repNameKey } from './salesGoals.ts';

/**
 * The SPS report "Sales by Primary Sales Rep - Monthly" (2026-11-25): one row per sales person
 * ("Sales Person", twelve month columns headed "Jan 26" … "Dec 26", Total), one year, tax not
 * included. It is what the goals compare against, uploaded as often as the owner likes (each
 * upload replaces its year). A row with no name is sales SPS credits to no sales person; the
 * report's last row, also nameless, is the grand total and is left out when it matches the
 * columns above it. `readRepSalesSheet` turns the sheet's cells into one entry per sales person,
 * in whole cents, or says why it can't be trusted. Pure; tested in repSales.test.ts.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export type RepSalesEntry = { name: string; key: string; cents: (number | null)[] };
export type RepSalesSheet = {
  year: number;
  entries: RepSalesEntry[];
  /** Sales on rows with no sales person (not the totals row). */
  noRepCents: number;
  /** Everything the file credits: the entries plus the no-sales-person rows. */
  totalCents: number;
  problems: string[];
};

const text = (v: unknown) => String(v ?? '').trim();
const toCents = (v: unknown): number | null | 'bad' => {
  if (v == null || text(v) === '') return null;
  const n = typeof v === 'number' ? v : Number(text(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 'bad';
};
const sum = (list: ReadonlyArray<number | null>) => list.reduce<number>((a, c) => a + (c ?? 0), 0);

export function readRepSalesSheet(rows: unknown): RepSalesSheet {
  const empty = (problem: string): RepSalesSheet => ({ year: 0, entries: [], noRepCents: 0, totalCents: 0, problems: [problem] });
  if (!Array.isArray(rows) || rows.length < 2) return empty('The file has no rows.');
  const head = (rows[0] as unknown[]).map(text);
  const nameCol = head.findIndex((h) => h.toLowerCase() === 'sales person');
  if (nameCol < 0) return empty('No "Sales Person" column was found. Use the report "Sales by Primary Sales Rep - Monthly".');
  const totalCol = head.findIndex((h) => h.toLowerCase() === 'total');

  const monthCols: number[] = [];
  let year = 0;
  for (let m = 0; m < 12; m++) {
    const col = head.findIndex((h) => new RegExp(`^${MONTHS[m]}\\s+(\\d{2}|\\d{4})$`, 'i').test(h));
    if (col < 0) return empty(`The ${MONTHS[m]} column is missing. The report must be one year, January to December.`);
    const yy = Number(head[col].split(/\s+/)[1]);
    const y = yy < 100 ? 2000 + yy : yy;
    if (year && y !== year) return empty('The month columns are not all from the same year.');
    year = y;
    monthCols.push(col);
  }

  const problems: string[] = [];
  type Line = { name: string; rowNumber: number; cents: (number | null)[] };
  const lines: Line[] = [];
  rows.slice(1).forEach((raw, i) => {
    const row = raw as unknown[];
    const rowNumber = i + 2;
    const cents = monthCols.map((c) => toCents(row[c]));
    const allBlank = cents.every((c) => c == null) && text(row[nameCol]) === '';
    if (allBlank) return;
    if (cents.includes('bad')) { problems.push(`Row ${rowNumber} ("${text(row[nameCol])}") has a month that isn't a number.`); return; }
    if (totalCol >= 0) {
      const total = toCents(row[totalCol]);
      if (total === 'bad') { problems.push(`Row ${rowNumber} ("${text(row[nameCol])}") has a Total that isn't a number.`); return; }
      if (total != null && Math.abs(total - sum(cents as (number | null)[])) > 100) {
        problems.push(`Row ${rowNumber} ("${text(row[nameCol])}"): the months don't add up to its Total. A month column may be missing or moved.`);
        return;
      }
    }
    lines.push({ name: text(row[nameCol]), rowNumber, cents: cents as (number | null)[] });
  });

  // The last nameless row is the grand total — but only when it really is the columns' sum.
  const last = lines[lines.length - 1];
  if (last && last.name === '') {
    const others = lines.slice(0, -1);
    const matches = monthCols.every((_, m) => Math.abs(sum(others.map((l) => l.cents[m])) - (last.cents[m] ?? 0)) <= 100);
    if (matches) lines.pop();
  }

  const entries: RepSalesEntry[] = [];
  const seen = new Map<string, number>();
  let noRepCents = 0;
  for (const l of lines) {
    if (!l.name) { noRepCents += sum(l.cents); continue; }
    const key = repNameKey(l.name);
    if (seen.has(key)) { problems.push(`"${l.name}" appears on rows ${seen.get(key)} and ${l.rowNumber}.`); continue; }
    seen.set(key, l.rowNumber);
    entries.push({ name: l.name, key, cents: l.cents });
  }
  if (!entries.length && !problems.length) problems.push('No sales people were found in the file.');
  const totalCents = noRepCents + entries.reduce((s, e) => s + sum(e.cents), 0);
  return { year, entries, noRepCents, totalCents, problems };
}
