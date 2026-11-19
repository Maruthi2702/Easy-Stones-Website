/**
 * Monthly sales per customer (Postgres only — it is new since the customer
 * cutover, so there is no MongoDB copy). Rows are keyed by the report's name and
 * matched to a customer when read: a link a person made (customer_sales_links),
 * else its SPS key, else its company name, both through spsKey.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { newId } from '../ids.ts';
import {
  customerSalesMonthly as monthly, customerSalesImports as imports, customerSalesLinks as links, customers
} from '../schema/customers.ts';
import { spsKey } from '../../utils/spsSheet.ts';
import { suggestCustomers, type SalesEntry } from '../../utils/customerSales.ts';

/** The year's twelve months for one customer, or null when no report row matches it. */
export async function salesForCustomer(customerId: string, year: number, db?: Db) {
  const d = db ?? await appDb();
  const [c] = await d.select({ company: customers.company, key: customers.spsKey }).from(customers).where(eq(customers.id, customerId));
  if (!c) return undefined;
  // The links table arrives with its own migration; until it's applied the tab still works without them.
  const linked = await d.select({ key: links.spsKey }).from(links).where(eq(links.customerId, customerId)).catch(() => []);
  const keys = [...new Set([c.key, spsKey(c.company), ...linked.map(l => l.key)].filter((k): k is string => !!k))];
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

/** Which report names find a customer now (a saved link, an SPS key or a company name)? */
async function knownKeys(d: Db, extra: Record<string, string> = {}) {
  const known = new Set<string>(Object.keys(extra));
  for (const n of await d.select({ company: customers.company, key: customers.spsKey }).from(customers)) {
    if (n.key) known.add(n.key);
    known.add(spsKey(n.company));
  }
  for (const l of await d.select({ key: links.spsKey }).from(links)) known.add(l.key);
  return known;
}

/** Nothing written: what the file holds, what the year already has, and the names that match nobody (with look-alikes). */
export async function previewYear(entries: SalesEntry[], year: number, db?: Db) {
  const d = db ?? await appDb();
  const known = await knownKeys(d);
  const people = (await d.select({ id: customers.id, company: customers.company, city: customers.city }).from(customers))
    .filter(c => c.company.trim());
  const unmatched = entries.filter(e => !known.has(e.key)).map(e => ({
    name: e.name, key: e.key, primaryRep: e.primaryRep,
    cents: e.cents.reduce<number>((a, c) => a + (c ?? 0), 0),
    suggestions: suggestCustomers(e.name, people).map(c => ({ id: c.id, company: c.company, city: c.city ?? '' }))
  }));
  const [last] = await d.select().from(imports).where(eq(imports.year, year)).orderBy(desc(imports.importedAt)).limit(1);
  return {
    customers: entries.length, matched: entries.length - unmatched.length, unmatched,
    earlier: last ? { importedAt: last.importedAt, customers: last.customers } : null
  };
}

/**
 * Replaces the year with the report's figures, in one transaction, saving the links a person made.
 * Answers what is still matched to nobody. A link to a customer that doesn't exist is refused.
 */
export async function replaceYear(
  input: { year: number; entries: SalesEntry[]; totalCents: number; fileName: string; exportedOn: string; by: string; links?: Record<string, string> },
  db?: Db
) {
  const d = db ?? await appDb();
  const importId = newId();
  const wanted = Object.entries(input.links ?? {}).filter(([k]) => input.entries.some(e => e.key === k));
  const ids = [...new Set(wanted.map(([, id]) => id))];
  const found = ids.length ? await d.select({ id: customers.id }).from(customers).where(inArray(customers.id, ids)) : [];
  const ok = new Set(found.map(f => f.id));
  const bad = wanted.filter(([, id]) => !ok.has(id));
  if (bad.length) throw new Error('A customer you picked no longer exists.');
  const made = Object.fromEntries(wanted);
  const known = await knownKeys(d, made);
  const unmatched = input.entries.filter(e => !known.has(e.key)).map(e => e.name);
  const rows = input.entries.flatMap(e => e.cents.flatMap((c, i) => c == null ? [] : [{
    year: input.year, month: i + 1, spsKey: e.key, customerName: e.name, cents: c,
    primaryRep: e.primaryRep, secondaryRep: e.secondaryRep, importId
  }]));
  await d.transaction(async tx => {
    for (const [key, customerId] of wanted) {
      const reportName = input.entries.find(e => e.key === key)?.name ?? '';
      await tx.insert(links).values({ spsKey: key, customerId, reportName, linkedBy: input.by })
        .onConflictDoUpdate({ target: links.spsKey, set: { customerId, reportName, linkedBy: input.by, linkedAt: new Date() } });
    }
    await tx.delete(monthly).where(eq(monthly.year, input.year));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(monthly).values(rows.slice(i, i + 500));
    await tx.insert(imports).values({
      id: importId, year: input.year, fileName: input.fileName, exportedOn: input.exportedOn,
      customers: input.entries.length, totalCents: input.totalCents, unmatched, importedBy: input.by
    });
  });
  return { importId, customers: input.entries.length, rows: rows.length, matched: input.entries.length - unmatched.length, unmatched, linked: wanted.length };
}
