/**
 * The voice assistant (2026-11-28, docs/VOICE_ASSISTANT_PLAN.md). Postgres only — new since the cutover, no MongoDB copy.
 *
 * `voice_words`: what the recognizer tends to write (`heard`, '' for a plain word that is only a hint) and what it should be
 * (`meant`). Edited by admins (Users & Roles → Voice assistant → `manage_voice_words`); seeded once into an empty table.
 *
 * `assistant_usage`: one row per person per day — counts, tokens and an estimated cost. NEVER text: a transcript or a draft is
 * not stored anywhere.
 */
import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, integer, doublePrecision, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { moment, day, idFormat, oneOf, objectId } from './columns.ts';

export const VOICE_WORD_KINDS = ['stone', 'brand', 'branch', 'business', 'slang', 'customer', 'other'] as const;

export const voiceWords = pgTable('voice_words', {
  id: objectId('id').primaryKey(),
  /** What the recognizer writes ("cala cotta gold"). '' = a plain word that is only a hint. */
  heard: text('heard').notNull().default(''),
  /** What it should be ("Calacatta Gold"). */
  meant: text('meant').notNull(),
  kind: text('kind').notNull().default('other'),
  active: boolean('active').notNull().default(true),
  note: text('note').notNull().default(''),
  createdAt: moment('created_at').notNull().defaultNow(),
  updatedAt: moment('updated_at').notNull().defaultNow()
}, t => [
  idFormat('voice_words'),
  oneOf('voice_words', 'kind', VOICE_WORD_KINDS),
  uniqueIndex('voice_words_heard_uq').on(sql`lower(${t.heard})`).where(sql`${t.heard} <> ''`),
  uniqueIndex('voice_words_plain_uq').on(sql`lower(${t.meant})`).where(sql`${t.heard} = ''`)
]);

export const assistantUsage = pgTable('assistant_usage', {
  userId: text('user_id').notNull(),
  day: day('day').notNull(),
  turns: integer('turns').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  /** Estimated from the model's list price (src/utils/voiceWords.ts `turnCostUsd`). */
  costUsd: doublePrecision('cost_usd').notNull().default(0)
}, t => [
  primaryKey({ columns: [t.userId, t.day] }),
  index('assistant_usage_day_idx').on(t.day)
]);
