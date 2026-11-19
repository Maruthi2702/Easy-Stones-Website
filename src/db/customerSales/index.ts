/**
 * Monthly sales per customer (Postgres only — it is new since the customer
 * cutover, so there is no MongoDB copy). Rows are keyed by the report's name and
 * matched to a customer when read: its SPS key, else its company name, both
 * trimmed and lowercased (spsKey).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { newId } from '../ids.ts';
import { customerSalesMonthly as monthly, customerSalesImports as imports, customers } from '../schema/customers.ts';
import { spsKey } from '../../utils/spsSheet.ts';
import type { SalesEntry } from '../../utils/customerSales.ts';

/** The year's twelve months for one customer, or null when no report row matches it. */
export async function salesForCustomer(customerId: string, year: number, db?: Db) {
  const d = db ?? await appDb();
  const [c] = await d.select({ company: customers.company, key: customers.spsKey }).from(customers).where(eq(customers.id, customerId));
  if (!c) return undefined;
  const keys = [...new Set([c.key, spsKey(c.company)].filter((k): k is string => !!k))];
  const rows = keys.length
    ? await d.select().from(monthly).where(and(eq(monthly.year, year), inArray(monthly.spsKey, keys)))
    : [];
  const cents: (number | null)[] = Array(12).fill(null);
  for (const r of rows) cents[r.month - 1] = (cents[r.month - 1] ?? 0) + r.cents;
  const [last] = await d.select().from(imports).where(eq(imports.year, year)).orderBy(desc(imports.importedAt)).limit(1);
  const years = (await d.selectDistinct({ year: imports.year }).from(imports)).map(r => r.year).sort((a, b) => b - a);
  return {
    year, years, matched: rows.length > 0, cents,
    primaryRep: rows[0]?.primaryRep ?? '', secondaryRep: rows[0]?.secondaryRep ?? '',
    importedAt: last?.importedAt ?? null, exportedOn: last?.exportedOn ?? ''
  };
}

/** Replaces the year with the report's figures, in one transaction. Answers what matched no customer. */
export async function replaceYear(
  input: { year: number; entries: SalesEntry[]; totalCents: number; fileName: string; exportedOn: string; by: string },
  db?: Db
) {
  const d = db ?? await appDb();
  const importId = newId();
  const names = await d.select({ company: customers.company, key: customers.spsKey }).from(customers);
  const known = new Set<string>();
  for (const n of names) { if (n.key) known.add(n.key); known.add(spsKey(n.company)); }
  const unmatched = input.entries.filter(e => !known.has(e.key)).map(e => e.name);
  const rows = input.entries.flatMap(e => e.cents.flatMap((c, i) => c == null ? [] : [{
    year: input.year, month: i + 1, spsKey: e.key, customerName: e.name, cents: c,
    primaryRep: e.primaryRep, secondaryRep: e.secondaryRep, importId
  }]));
  await d.transaction(async tx => {
    await tx.delete(monthly).where(eq(monthly.year, input.year));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(monthly).values(rows.slice(i, i + 500));
    await tx.insert(imports).values({
      id: importId, year: input.year, fileName: input.fileName, exportedOn: input.exportedOn,
      customers: input.entries.length, totalCents: input.totalCents, unmatched, importedBy: input.by
    });
  });
  return { importId, customers: input.entries.length, rows: rows.length, matched: input.entries.length - unmatched.length, unmatched };
}
