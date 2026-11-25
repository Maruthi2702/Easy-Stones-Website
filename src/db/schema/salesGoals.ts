/**
 * Sales goals (2026-11-25, src/utils/salesGoals.ts): what a rep is aiming to sell each month.
 * One row per person per month that has a goal — a month with no row has no goal, which is not
 * a zero goal. Postgres only (new since the customer cutover, no MongoDB copy). Saving a
 * person's year replaces its rows in one transaction.
 *
 * `user_id` is a staff account's id, kept as plain text with no foreign key: staff are still
 * read from their own area, and a goal outliving a deleted account harms nothing.
 */
import { sql } from 'drizzle-orm';
import { pgTable, text, smallint, integer, doublePrecision, primaryKey, index, check } from 'drizzle-orm/pg-core';
import { moment, objectId } from './columns.ts';

export const salesGoals = pgTable('sales_goals', {
  userId: objectId('user_id').notNull(),
  year: smallint('year').notNull(),
  month: smallint('month').notNull(),
  /** Whole cents. */
  cents: doublePrecision('cents').notNull(),
  setBy: text('set_by').notNull().default(''),
  setAt: moment('set_at').notNull().defaultNow()
}, t => [
  primaryKey({ columns: [t.userId, t.year, t.month] }),
  index('sales_goals_year_idx').on(t.year),
  check('sales_goals_month', sql`${t.month} between 1 and 12`),
  check('sales_goals_cents', sql`${t.cents} >= 0`)
]);

/**
 * The SPS report "Sales by Primary Sales Rep - Monthly" (src/utils/repSales.ts): one row per sales
 * person per month that has a figure, keyed by the person's name key (repNameKey). An import replaces
 * its whole year. This is what the goals compare against; until a year has one, the Primary Sales
 * Person on the per-customer report stands in (src/db/salesGoals).
 */
export const repSalesMonthly = pgTable('rep_sales_monthly', {
  year: smallint('year').notNull(),
  month: smallint('month').notNull(),
  repKey: text('rep_key').notNull(),
  repName: text('rep_name').notNull(),
  /** Whole cents; a return makes it negative. */
  cents: doublePrecision('cents').notNull(),
  importId: text('import_id').notNull()
}, t => [
  primaryKey({ columns: [t.year, t.month, t.repKey] }),
  index('rep_sales_monthly_year_idx').on(t.year),
  check('rep_sales_monthly_month', sql`${t.month} between 1 and 12`)
]);

/** One line per rep-sales import: who, when, what the file held, and the sales it credited to no sales person. */
export const repSalesImports = pgTable('rep_sales_imports', {
  id: text('id').primaryKey(),
  year: smallint('year').notNull(),
  fileName: text('file_name').notNull().default(''),
  exportedOn: text('exported_on').notNull().default(''),
  reps: integer('reps').notNull(),
  totalCents: doublePrecision('total_cents').notNull(),
  noRepCents: doublePrecision('no_rep_cents').notNull().default(0),
  importedBy: text('imported_by').notNull().default(''),
  importedAt: moment('imported_at').notNull().defaultNow()
});

/**
 * A report sales person a person matched to a staff member by hand (Import sales → Match names), for a
 * name that isn't anyone's Display Name. Remembered, so the next file's same name needs no answer.
 */
export const repSalesLinks = pgTable('rep_sales_links', {
  repKey: text('rep_key').primaryKey(),
  userId: objectId('user_id').notNull(),
  repName: text('rep_name').notNull().default(''),
  linkedBy: text('linked_by').notNull().default(''),
  linkedAt: moment('linked_at').notNull().defaultNow()
});
