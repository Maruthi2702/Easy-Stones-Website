/**
 * Credit Card Receipts → the Amex check (2026-11-20, src/utils/amexStatement.ts): every line of
 * Amex's activity exports and the upload each charge is matched to. Postgres only — new since the
 * Credit Card Receipts cutover (locked 2026-11-14), no MongoDB copy, and no foreign key into a
 * copied table, so a copy never touches these.
 *
 * A line's id is Amex's own Reference, so uploading a week twice, or weeks that overlap, never
 * adds it twice. What Amex says is refreshed by each upload; `card_id` and `expense_id` (the match)
 * are ours and an upload never clears them.
 */
import { pgTable, text, integer, bigint, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { moment, day, oneOf } from './columns.ts';

export const CARD_STATEMENT_LINE_KINDS = ['charge', 'credit', 'fee'] as const;

export const cardStatementLines = pgTable('card_statement_lines', {
  /** Amex's Reference. */
  reference: text('reference').primaryKey(),
  day: day('day').notNull(),
  description: text('description').notNull().default(''),
  cardMember: text('card_member').notNull().default(''),
  /** The account's last 5 digits (Amex's "Account #" without its dash). */
  digits: text('digits').notNull(),
  /** Charges positive, credits and payments negative. */
  cents: integer('cents').notNull(),
  /** charge (needs a receipt) · credit (payments, refunds, credits) · fee (interest and fees). */
  kind: text('kind').notNull(),
  amexCategory: text('amex_category').notNull().default(''),
  extended: text('extended').notNull().default(''),
  appearsAs: text('appears_as').notNull().default(''),
  address: text('address').notNull().default(''),
  cityState: text('city_state').notNull().default(''),
  zip: text('zip').notNull().default(''),
  country: text('country').notNull().default(''),
  /** The company card these digits name (company_cards.id), once one is set up. */
  cardId: text('card_id'),
  /** The expense that answers this charge (card_expenses.id): an upload, or the Missing receipt row made for it. */
  expenseId: text('expense_id'),
  firstImportId: text('first_import_id').notNull(),
  lastImportId: text('last_import_id').notNull(),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  index('card_statement_lines_day_idx').on(t.day),
  index('card_statement_lines_digits_idx').on(t.digits),
  index('card_statement_lines_card_idx').on(t.cardId, t.day),
  uniqueIndex('card_statement_lines_expense_key').on(t.expenseId).where(sql`expense_id is not null`),
  oneOf('card_statement_lines', 'kind', CARD_STATEMENT_LINE_KINDS)
]);

/** One row per upload: who, when, the file, and what it found. */
export const cardStatementImports = pgTable('card_statement_imports', {
  id: text('id').primaryKey(),
  fileName: text('file_name').notNull().default(''),
  periodFrom: day('period_from'),
  periodTo: day('period_to'),
  lines: integer('lines').notNull(),
  /** Lines this file was the first to bring. */
  added: integer('added').notNull(),
  chargesCents: bigint('charges_cents', { mode: 'number' }).notNull().default(0),
  /** What the check found right after it (counts per line status, cards set up, Missing rows made). */
  summary: jsonb('summary').notNull().default(sql`'{}'::jsonb`),
  byId: text('by_id').notNull().default(''),
  byName: text('by_name').notNull().default(''),
  at: moment('at').notNull().defaultNow()
}, t => [index('card_statement_imports_at_idx').on(t.at)]);
