/**
 * Request counters for the limits that guard money (Credit Card Receipts' uploads and AI reading,
 * review S8, 2026-11-24). One row per person per limit, shared by every server instance — a count kept
 * in a process's memory is per instance, so on Lambda it would not cap anything. Postgres only.
 * `key` is "<limit name>:<person>"; the row restarts its count once `resets_at` has passed.
 */
import { pgTable, text, integer, index } from 'drizzle-orm/pg-core';
import { moment } from './columns.ts';

export const rateLimitHits = pgTable('rate_limit_hits', {
  key: text('key').primaryKey(),
  hits: integer('hits').notNull(),
  resetsAt: moment('resets_at').notNull()
}, t => [
  index('rate_limit_hits_resets_idx').on(t.resetsAt)
]);
