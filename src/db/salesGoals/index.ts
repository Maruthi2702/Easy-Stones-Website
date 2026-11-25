/**
 * Sales goals (src/utils/salesGoals.ts): the data layer. Postgres only.
 *
 * - `goalsFor` / `saveGoals`: one row per person per month that has a goal; saving a person's
 *   year replaces it in one transaction.
 * - `salesByReportRep`: a sales person's sales for a year by month, from the SPS report "Sales by Primary
 *   Sales Rep - Monthly" (`replaceRepYear`, uploaded as often as wanted; each upload replaces its year), or
 *   until a year has one, the Primary Sales Person on each row of the per-customer report — NOT the
 *   customer's owning rep in the app, which changes often and would carry a customer's whole history to its
 *   new rep (owner, 2026-11-25). The route maps the report's names to staff (matchReportReps + repLinks).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { newId } from '../ids.ts';
import { salesGoals, repSalesMonthly, repSalesImports, repSalesLinks } from '../schema/salesGoals.ts';
import { customerSalesMonthly as monthly, customerSalesImports as imports } from '../schema/customers.ts';
import { repNameKey } from '../../utils/salesGoals.ts';
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

/**
 * Sales by sales person: name key (repNameKey) → the name as the report spells it and the year's sales
 * by month in cents (null = nothing that month). The source is the **rep file** ("Sales by Primary Sales
 * Rep - Monthly", rep_sales_monthly) when the year has been imported; until then the Primary Sales Person
 * on each row of the per-customer report stands in. Never the customer's owning rep in the app. A row with
 * no sales person counts for nobody.
 */
export async function salesByReportRep(year: number, db?: Db): Promise<Map<string, { name: string; months: (number | null)[] }>> {
  const d = db ?? await appDb();
  const out = new Map<string, { name: string; months: (number | null)[] }>();
  const add = (rep: string, month: number, cents: number) => {
    const key = repNameKey(rep);
    if (!key) return;
    const bucket = out.get(key) ?? { name: rep.trim(), months: blank() };
    bucket.months[month - 1] = (bucket.months[month - 1] ?? 0) + cents;
    out.set(key, bucket);
  };
  const own = await d.select({ rep: repSalesMonthly.repName, month: repSalesMonthly.month, cents: repSalesMonthly.cents })
    .from(repSalesMonthly).where(eq(repSalesMonthly.year, year));
  if (own.length) {
    for (const r of own) add(r.rep, r.month, r.cents);
    return out;
  }
  const rows = await d.select({ rep: monthly.primaryRep, month: monthly.month, cents: monthly.cents }).from(monthly).where(eq(monthly.year, year));
  for (const r of rows) add(r.rep, r.month, r.cents);
  return out;
}

/** Report name key → staff id, for the names a person matched by hand. */
export async function repLinks(db?: Db): Promise<Map<string, string>> {
  const d = db ?? await appDb();
  const rows = await d.select({ key: repSalesLinks.repKey, userId: repSalesLinks.userId }).from(repSalesLinks);
  return new Map(rows.map((r) => [r.key, r.userId]));
}

/** The latest rep-sales import of a year, for "this year was imported before" and the screen's "as of". */
export async function lastRepImport(year: number, db?: Db) {
  const d = db ?? await appDb();
  const [row] = await d.select().from(repSalesImports).where(eq(repSalesImports.year, year)).orderBy(desc(repSalesImports.importedAt)).limit(1);
  return row ?? null;
}

/**
 * Replaces the year with the file's figures, in one transaction, saving the links a person made
 * (report name → staff id) and a line in the import log. Months with no figure are not stored.
 */
export async function replaceRepYear(
  input: { year: number; entries: { name: string; key: string; cents: (number | null)[] }[]; totalCents: number; noRepCents: number; fileName: string; exportedOn: string; by: string; links?: Record<string, string> },
  db?: Db
) {
  const d = db ?? await appDb();
  const importId = newId();
  const rows = input.entries.flatMap((e) => e.cents.flatMap((c, i) => (c == null ? [] : [{ year: input.year, month: i + 1, repKey: e.key, repName: e.name, cents: c, importId }])));
  const links = Object.entries(input.links ?? {}).filter(([key]) => input.entries.some((e) => e.key === key));
  await d.transaction(async (tx) => {
    for (const [key, userId] of links) {
      const repName = input.entries.find((e) => e.key === key)?.name ?? '';
      await tx.insert(repSalesLinks).values({ repKey: key, userId, repName, linkedBy: input.by })
        .onConflictDoUpdate({ target: repSalesLinks.repKey, set: { userId, repName, linkedBy: input.by, linkedAt: new Date() } });
    }
    await tx.delete(repSalesMonthly).where(eq(repSalesMonthly.year, input.year));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(repSalesMonthly).values(rows.slice(i, i + 500));
    await tx.insert(repSalesImports).values({
      id: importId, year: input.year, fileName: input.fileName, exportedOn: input.exportedOn,
      reps: input.entries.length, totalCents: input.totalCents, noRepCents: input.noRepCents, importedBy: input.by
    });
  });
  return { importId, reps: input.entries.length, rows: rows.length, linked: links.length };
}

/** Years worth showing: any year with a sales import or a goal, newest first (this year always included). */
export async function goalYears(thisYear: number, db?: Db): Promise<number[]> {
  const d = db ?? await appDb();
  const set = new Set<number>([thisYear]);
  for (const r of await d.selectDistinct({ year: imports.year }).from(imports)) set.add(r.year);
  for (const r of await d.selectDistinct({ year: repSalesImports.year }).from(repSalesImports)) set.add(r.year);
  for (const r of await d.selectDistinct({ year: salesGoals.year }).from(salesGoals)) set.add(r.year);
  return [...set].sort((a, b) => b - a);
}
