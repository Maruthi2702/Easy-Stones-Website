/**
 * The voice assistant's data (Postgres only; schema in src/db/schema/voiceAssistant.ts, rules in src/utils/voiceWords.ts).
 *
 *   voice words   list / add / edit / remove, and a one-time fill of an EMPTY table (`seedVoiceWords`)
 *   usage         `recordTurn` adds one turn to the person's day (counts, tokens, cost — never text); `usageForMonth` totals a month
 *
 * Every function takes an optional `db` so a test can pass its own (PGlite); the server uses the app's connection.
 */
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { appDb } from '../appDb.ts';
import { newId, isId } from '../ids.ts';
import { voiceWords, assistantUsage } from '../schema/voiceAssistant.ts';
import type { VoiceWord, VoiceWordInput, VoiceWordKind } from '../../utils/assistantContract.ts';

type Row = typeof voiceWords.$inferSelect;
const wordOf = (r: Row): VoiceWord => ({
  id: r.id, heard: r.heard, meant: r.meant, kind: r.kind as VoiceWordKind, active: r.active, note: r.note, updatedAt: r.updatedAt.toISOString()
});

/** A unique-index refusal, whatever the driver calls it. */
const isDuplicate = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
};

/** Every word, in the order it was made (the seed is written hardest first, so this is the hint priority). */
export async function listWords(db?: Db): Promise<VoiceWord[]> {
  const d = db ?? await appDb();
  return (await d.select().from(voiceWords).orderBy(asc(voiceWords.createdAt), asc(voiceWords.id))).map(wordOf);
}

export async function addWord(input: VoiceWordInput, db?: Db): Promise<{ word: VoiceWord } | { duplicate: true }> {
  const d = db ?? await appDb();
  try {
    const [row] = await d.insert(voiceWords).values({
      id: newId(), heard: input.heard, meant: input.meant, kind: input.kind, active: input.active ?? true, note: input.note ?? ''
    }).returning();
    return { word: wordOf(row) };
  } catch (e) {
    if (isDuplicate(e)) return { duplicate: true };
    throw e;
  }
}

/** null when there is no such word. */
export async function editWord(id: string, patch: Partial<VoiceWordInput>, db?: Db): Promise<{ word: VoiceWord } | { duplicate: true } | null> {
  if (!isId(id)) return null;
  const d = db ?? await appDb();
  try {
    const [row] = await d.update(voiceWords).set({ ...patch, updatedAt: new Date() }).where(eq(voiceWords.id, id)).returning();
    return row ? { word: wordOf(row) } : null;
  } catch (e) {
    if (isDuplicate(e)) return { duplicate: true };
    throw e;
  }
}

export async function removeWord(id: string, db?: Db): Promise<boolean> {
  if (!isId(id)) return false;
  const d = db ?? await appDb();
  return (await d.delete(voiceWords).where(eq(voiceWords.id, id)).returning({ id: voiceWords.id })).length > 0;
}

/**
 * Fills an EMPTY list once (like seedTypeLists). Rows get a created time one millisecond apart, so the list's order is the seed's.
 * Two servers starting together can't double it: the unique indexes turn the second's rows into no-ops. Returns how many were added.
 */
export async function seedVoiceWords(words: VoiceWordInput[], db?: Db): Promise<number> {
  const d = db ?? await appDb();
  const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(voiceWords);
  if (n > 0 || !words.length) return 0;
  const base = Date.now() - words.length;
  const rows = words.map((w, i) => ({
    id: newId(), heard: w.heard, meant: w.meant, kind: w.kind, active: w.active ?? true, note: w.note ?? '', createdAt: new Date(base + i), updatedAt: new Date(base + i)
  }));
  const inserted = await d.insert(voiceWords).values(rows).onConflictDoNothing().returning({ id: voiceWords.id });
  return inserted.length;
}

export type TurnRecord = { userId: string; day: string; ok: boolean; input: number; output: number; cacheRead: number; costUsd: number };

/** Adds one turn to the person's day. A turn that failed counts as a turn and as failed; its tokens (if any) still count. */
export async function recordTurn(t: TurnRecord, db?: Db): Promise<void> {
  const d = db ?? await appDb();
  await d.insert(assistantUsage).values({
    userId: t.userId, day: t.day, turns: 1, failed: t.ok ? 0 : 1,
    inputTokens: t.input, outputTokens: t.output, cacheReadTokens: t.cacheRead, costUsd: t.costUsd
  }).onConflictDoUpdate({
    target: [assistantUsage.userId, assistantUsage.day],
    set: {
      turns: sql`${assistantUsage.turns} + 1`,
      failed: sql`${assistantUsage.failed} + ${t.ok ? 0 : 1}`,
      inputTokens: sql`${assistantUsage.inputTokens} + ${t.input}`,
      outputTokens: sql`${assistantUsage.outputTokens} + ${t.output}`,
      cacheReadTokens: sql`${assistantUsage.cacheReadTokens} + ${t.cacheRead}`,
      costUsd: sql`${assistantUsage.costUsd} + ${t.costUsd}`
    }
  });
}

export type MonthUsage = {
  turns: number; failed: number; inputTokens: number; outputTokens: number; costUsd: number;
  people: { userId: string; turns: number; failed: number }[];
};

/** One calendar month ("2026-11") of usage, busiest person first. */
export async function usageForMonth(month: string, db?: Db): Promise<MonthUsage> {
  const d = db ?? await appDb();
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const rows = await d.select().from(assistantUsage).where(and(gte(assistantUsage.day, from), lt(assistantUsage.day, to)));
  const people = new Map<string, { userId: string; turns: number; failed: number }>();
  const total: MonthUsage = { turns: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, people: [] };
  for (const r of rows) {
    total.turns += r.turns; total.failed += r.failed; total.inputTokens += r.inputTokens; total.outputTokens += r.outputTokens; total.costUsd += r.costUsd;
    const p = people.get(r.userId) ?? { userId: r.userId, turns: 0, failed: 0 };
    p.turns += r.turns; p.failed += r.failed; people.set(r.userId, p);
  }
  total.costUsd = Math.round(total.costUsd * 1e6) / 1e6;
  total.people = [...people.values()].sort((a, b) => b.turns - a.turns || a.userId.localeCompare(b.userId));
  return total;
}
