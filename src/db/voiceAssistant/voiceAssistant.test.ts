// The voice assistant's data layer on an in-memory Postgres: the word list (unique heard words, one-time seed) and the usage rows.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { addWord, editWord, listWords, recordTurn, removeWord, seedVoiceWords, usageForMonth } from './index.ts';
import { STARTING_VOICE_WORDS } from '../../utils/voiceWordsSeed.ts';
import { assistantUsage, voiceWords } from '../schema/voiceAssistant.ts';

describe('voice assistant data layer', () => {
  let client: PGlite, db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('adds, edits and removes a word', async () => {
    const added = await addWord({ heard: 'Smitty', meant: 'Smith Granite', kind: 'customer' }, db);
    expect('word' in added && added.word).toMatchObject({ heard: 'Smitty', meant: 'Smith Granite', kind: 'customer', active: true, note: '' });
    const id = 'word' in added ? added.word.id : '';
    const edited = await editWord(id, { active: false, note: 'nickname' }, db);
    expect('word' in (edited || {}) && (edited as { word: { active: boolean; note: string } }).word).toMatchObject({ active: false, note: 'nickname' });
    expect(await editWord('0'.repeat(24), { note: 'x' }, db)).toBeNull();
    expect(await editWord('nope', { note: 'x' }, db)).toBeNull();
    expect(await removeWord(id, db)).toBe(true);
    expect(await removeWord(id, db)).toBe(false);
  });

  it('refuses the same heard text twice (any case) and the same plain word twice', async () => {
    expect('word' in await addWord({ heard: 'Cala Cotta', meant: 'Calacatta', kind: 'stone' }, db)).toBe(true);
    expect(await addWord({ heard: 'cala cotta', meant: 'Something else', kind: 'stone' }, db)).toEqual({ duplicate: true });
    expect('word' in await addWord({ heard: '', meant: 'Honed', kind: 'stone' }, db)).toBe(true);
    expect(await addWord({ heard: '', meant: 'honed', kind: 'stone' }, db)).toEqual({ duplicate: true });
    // the same meaning can be heard several ways
    expect('word' in await addWord({ heard: 'calla cotta', meant: 'Calacatta', kind: 'stone' }, db)).toBe(true);
  });

  it('refuses an edit that makes a word a duplicate, and keeps it as it was', async () => {
    const a = await addWord({ heard: 'edit one', meant: 'One', kind: 'other' }, db) as { word: { id: string } };
    await addWord({ heard: 'edit two', meant: 'Two', kind: 'other' }, db);
    expect(await editWord(a.word.id, { heard: 'EDIT TWO' }, db)).toEqual({ duplicate: true });
    expect((await listWords(db)).find((w) => w.id === a.word.id)?.heard).toBe('edit one');
  });

  it('seeds an empty list once, in the seed order, and never again', async () => {
    await db.delete(voiceWords);
    const added = await seedVoiceWords(STARTING_VOICE_WORDS, db);
    expect(added).toBe(STARTING_VOICE_WORDS.length);
    const words = await listWords(db);
    expect(words.map((w) => `${w.heard}|${w.meant}`)).toEqual(STARTING_VOICE_WORDS.map((w) => `${w.heard}|${w.meant}`));
    expect(await seedVoiceWords(STARTING_VOICE_WORDS, db)).toBe(0);
    expect((await listWords(db)).length).toBe(STARTING_VOICE_WORDS.length);
  });

  it('adds a turn to the person\'s day, failed ones counted, and totals a month', async () => {
    await db.delete(assistantUsage);
    await recordTurn({ userId: 'u1', day: '2026-11-03', ok: true, input: 1000, output: 100, cacheRead: 500, costUsd: 0.001 }, db);
    await recordTurn({ userId: 'u1', day: '2026-11-03', ok: false, input: 0, output: 0, cacheRead: 0, costUsd: 0 }, db);
    await recordTurn({ userId: 'u1', day: '2026-11-30', ok: true, input: 10, output: 5, cacheRead: 0, costUsd: 0.0001 }, db);
    await recordTurn({ userId: 'u2', day: '2026-11-10', ok: true, input: 20, output: 10, cacheRead: 0, costUsd: 0.0002 }, db);
    await recordTurn({ userId: 'u1', day: '2026-12-01', ok: true, input: 99, output: 99, cacheRead: 0, costUsd: 1 }, db);
    await recordTurn({ userId: 'u1', day: '2026-10-31', ok: true, input: 99, output: 99, cacheRead: 0, costUsd: 1 }, db);
    const nov = await usageForMonth('2026-11', db);
    expect(nov).toMatchObject({ turns: 4, failed: 1, inputTokens: 1030, outputTokens: 115 });
    expect(nov.costUsd).toBeCloseTo(0.0013, 6);
    expect(nov.people).toEqual([{ userId: 'u1', turns: 3, failed: 1 }, { userId: 'u2', turns: 1, failed: 0 }]);
    expect((await usageForMonth('2026-12', db)).turns).toBe(1);
    expect((await usageForMonth('2027-01', db)).turns).toBe(0);
  });

  it('stores counts and cost only: the usage table has no text column', () => {
    const columns = Object.keys((assistantUsage as unknown as Record<string, unknown>)).filter((k) => !k.startsWith('_') && k !== 'enableRLS');
    expect(columns.sort()).toEqual(['cacheReadTokens', 'costUsd', 'day', 'failed', 'inputTokens', 'outputTokens', 'turns', 'userId'].sort());
  });
});
