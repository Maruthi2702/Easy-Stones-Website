/**
 * Sales goals (src/utils/salesGoals.ts): the data layer. Postgres only.
 *
 * - `goalsFor` / `saveGoals`: one row per person per month that has a goal; saving a person's
 *   year replaces it in one transaction.
 * - `salesByRep`: a rep's sales for a year, by month — the SPS "Sales by Customer - Monthly"
 *   report (src/db/customerSales) added up over the customers that rep **owns**
 *   (`customers.sales_rep_id`), matched the way the customer's Sales Report tab matches them:
 *   a link a person made, else its SPS key, else its company name (spsKey). Customers nobody
 *   owns count for nobody. The rep an SPS import sets on a customer is the same field, so the
 *   report's own "Sales person" and this agree wherever the customer is connected.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { salesGoals } from '../schema/salesGoals.ts';
import { customers, customerSalesMonthly as monthly, customerSalesLinks as links, customerSalesImports as imports } from '../schema/customers.ts';
import { spsKey } from '../../utils/spsSheet.ts';
import type { GoalMonths } from '../../utils/salesGoals.ts';

const blank = (): GoalMonths => Array(12).fill(null);

/** Goals for a year: person id → twelve months (null = no goal). Only people with at least one month appear. */
export async function goalsFor(year: number, userIds?: string[], db?: Db): Promise<Map<string, GoalMonths>> {
  const d = db ?? await appDb();
  if (userIds && !userIds.length) return new Map();
  const rows = await d.select().from(salesGoals)
    .where(userIds ? and(eq(salesGoals.year, year), inArray(salesGoals.userId, userIds)) : eq(salesGoals.year, year));
  const out = new Map<string, GoalMonths>();
  for (const r of rows) {
    const months = out.get(r.userId) ?? blank();
    months[r.month - 1] = r.cents;
    out.set(r.userId, months);
  }
  return out;
}

/** Replaces one person's year of goals with these twelve months (null months are removed), in one transaction. */
export async function saveGoals(input: { userId: string; year: number; cents: GoalMonths; by: string }, db?: Db) {
  const d = db ?? await appDb();
  const rows = input.cents.flatMap((c, i) => (c == null ? [] : [{ userId: input.userId, year: input.year, month: i + 1, cents: c, setBy: input.by }]));
  await d.transaction(async (tx) => {
    await tx.delete(salesGoals).where(and(eq(salesGoals.userId, input.userId), eq(salesGoals.year, input.year)));
    if (rows.length) await tx.insert(salesGoals).values(rows);
  });
}

/** Rep id → sales by month for the year, in cents (null = nothing reported that month). Only reps with any sales appear. */
export async function salesByRep(year: number, db?: Db): Promise<Map<string, (number | null)[]>> {
  const d = db ?? await appDb();
  const rows = await d.select({ key: monthly.spsKey, month: monthly.month, cents: monthly.cents }).from(monthly).where(eq(monthly.year, year));
  if (!rows.length) return new Map();
  const people = await d.select({ id: customers.id, company: customers.company, key: customers.spsKey, rep: customers.salesRepId }).from(customers);
  const repById = new Map(people.map(c => [c.id, c.rep]));
  // Report name → the owning rep. Weakest first, so a link a person made wins over an SPS key, which wins over a name.
  const repOf = new Map<string, string | null>();
  for (const c of people) { const k = spsKey(c.company); if (k && !repOf.has(k)) repOf.set(k, c.rep); }
  for (const c of people) if (c.key) repOf.set(c.key, c.rep);
  for (const l of await d.select({ key: links.spsKey, customerId: links.customerId }).from(links)) repOf.set(l.key, repById.get(l.customerId) ?? null);
  const out = new Map<string, (number | null)[]>();
  for (const r of rows) {
    const rep = repOf.get(r.key);
    if (!rep) continue;
    const months = out.get(rep) ?? blank();
    months[r.month - 1] = (months[r.month - 1] ?? 0) + r.cents;
    out.set(rep, months);
  }
  return out;
}

/** Years worth showing: any year with a sales import or a goal, newest first (this year always included). */
export async function goalYears(thisYear: number, db?: Db): Promise<number[]> {
  const d = db ?? await appDb();
  const set = new Set<number>([thisYear]);
  for (const r of await d.selectDistinct({ year: imports.year }).from(imports)) set.add(r.year);
  for (const r of await d.selectDistinct({ year: salesGoals.year }).from(salesGoals)) set.add(r.year);
  return [...set].sort((a, b) => b - a);
}
