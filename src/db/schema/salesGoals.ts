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
import { pgTable, text, smallint, doublePrecision, primaryKey, index, check } from 'drizzle-orm/pg-core';
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
