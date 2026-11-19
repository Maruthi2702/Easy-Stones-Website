import { spsKey } from './spsSheet.ts';

/**
 * The SPS report "Sales by Customer - Monthly" (2026-11-18): Customer, Code,
 * Customer Route, Primary / Secondary Sales Person, twelve month columns headed
 * "Jan 26" … "Dec 26", Total, 12 Months Avg., and a totals row with no name.
 * `readSalesSheet` turns the sheet's cells (rows of cells) into one entry per
 * customer, in cents, or says why it can't be trusted. Pure; tested in
 * customerSales.test.ts. Used by the server on what the screen posts.
 */
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export type SalesEntry = { name: string; key: string; primaryRep: string; secondaryRep: string; cents: (number | null)[] };
export type SalesSheet = { year: number; entries: SalesEntry[]; totalCents: number; problems: string[] };

const text = (v: unknown) => String(v ?? '').trim();
/** Dollars as written in the report → whole cents; null for a blank cell. */
const toCents = (v: unknown): number | null | 'bad' => {
  if (v == null || text(v) === '') return null;
  const n = typeof v === 'number' ? v : Number(text(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 'bad';
};

export function readSalesSheet(rows: unknown): SalesSheet {
  const empty = (problem: string): SalesSheet => ({ year: 0, entries: [], totalCents: 0, problems: [problem] });
  if (!Array.isArray(rows) || rows.length < 2) return empty('The file has no rows.');
  const head = (rows[0] as unknown[]).map(text);
  const nameCol = head.findIndex(h => h.toLowerCase() === 'customer');
  if (nameCol < 0) return empty('No "Customer" column was found. Use the report "Sales by Customer - Monthly".');
  const primaryCol = head.findIndex(h => h.toLowerCase() === 'primary sales person');
  const secondaryCol = head.findIndex(h => h.toLowerCase() === 'secondary sales person');

  // Twelve columns "Jan 26" … "Dec 26", all one year.
  const monthCols: number[] = [];
  let year = 0;
  for (let m = 0; m < 12; m++) {
    const col = head.findIndex(h => new RegExp(`^${MONTH_NAMES[m]}\\s+(\\d{2}|\\d{4})$`, 'i').test(h));
    if (col < 0) return empty(`The ${MONTH_NAMES[m]} column is missing. The report must be one year, January to December.`);
    const yy = Number(head[col].split(/\s+/)[1]);
    const y = yy < 100 ? 2000 + yy : yy;
    if (year && y !== year) return empty('The month columns are not all from the same year.');
    year = y;
    monthCols.push(col);
  }

  const problems: string[] = [];
  const entries: SalesEntry[] = [];
  const seen = new Map<string, number>();
  rows.slice(1).forEach((raw, i) => {
    const row = raw as unknown[];
    const name = text(row[nameCol]);
    const rowNumber = i + 2;
    if (!name) return; // the report's totals row
    const key = spsKey(name);
    if (seen.has(key)) { problems.push(`"${name}" appears on rows ${seen.get(key)} and ${rowNumber}.`); return; }
    seen.set(key, rowNumber);
    const cents = monthCols.map(c => toCents(row[c]));
    if (cents.includes('bad')) { problems.push(`Row ${rowNumber} ("${name}") has a month that isn't a number.`); return; }
    entries.push({
      name, key,
      primaryRep: primaryCol >= 0 ? text(row[primaryCol]) : '',
      secondaryRep: secondaryCol >= 0 ? text(row[secondaryCol]) : '',
      cents: cents as (number | null)[]
    });
  });
  if (!entries.length && !problems.length) problems.push('No customers were found in the file.');
  const totalCents = entries.reduce((s, e) => s + e.cents.reduce<number>((a, c) => a + (c ?? 0), 0), 0);
  return { year, entries, totalCents, problems };
}

/** A customer's twelve months for the screen: nulls stay blank; total and best month come from what's there. */
export function salesSummary(cents: (number | null)[]) {
  const total = cents.reduce<number>((a, c) => a + (c ?? 0), 0);
  const withSales = cents.filter((c): c is number => c != null);
  let best = -1;
  cents.forEach((c, i) => { if (c != null && (best < 0 || c > (cents[best] as number))) best = i; });
  return { total, monthsWithSales: withSales.length, bestMonth: best, average: withSales.length ? Math.round(total / withSales.length) : 0 };
}
