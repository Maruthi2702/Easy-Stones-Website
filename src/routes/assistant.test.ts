// The voice assistant's routes on an in-memory Postgres: who may use and manage it, the limits, the 503, bad bodies, how a turn merges
// into the draft, a failing Claude, the usage rows, and — above all — that what a rep said never reaches a log or a table.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema/index.ts';
import { migrateDb } from '../db/client.ts';
import { useAppDbForTests } from '../db/appDb.ts';
import type { Db } from '../db/copy/plan.ts';
import { seedVoiceWords, listWords } from '../db/voiceAssistant/index.ts';
import { STARTING_VOICE_WORDS } from '../utils/voiceWordsSeed.ts';
import { assistantUsage, voiceWords } from '../db/schema/voiceAssistant.ts';
import { rateLimitHits } from '../db/schema/rateLimits.ts';
import createAssistantRouter, { todayFor } from './assistant.ts';
import type { VisitExtractor, ExtractResult } from '../services/visitExtract.ts';
import { EMPTY_SPOKEN_VISIT, type SpokenType, type SpokenVisit } from '../utils/assistantVisit.ts';
import { HINTS_MAX } from '../utils/assistantContract.ts';

const NOW = Date.parse('2026-11-27T20:00:00Z'); // a Friday, 12:00 in Seattle
const types: SpokenType[] = [
  { name: 'Quick Note', label: 'Quick note', active: true, order: 1, fields: { notes: true, outcome: false, followUp: 'none' } },
  { name: 'Formal Presentation', label: 'Formal presentation', active: true, order: 2, fields: { notes: true, outcome: true, followUp: 'optional' } },
  { name: 'Old Type', label: 'Old', active: false, order: 3 }
];
const visit = (o: Partial<SpokenVisit> = {}): SpokenVisit => ({ ...EMPTY_SPOKEN_VISIT, ...o });
const OK = (v: Partial<SpokenVisit>): ExtractResult => ({ ok: true, visit: visit(v), usage: { input: 100, output: 40, cacheRead: 900, cacheWrite: 0 }, model: 'claude-haiku-5-5', ms: 321 });

let db: Db; let client: PGlite;
let user = { id: 'u1', permissions: ['use_voice_assistant'] as string[] };
const extract = vi.fn<VisitExtractor['extract']>();
let extractor: VisitExtractor | null;

const app = (opts: Partial<Parameters<typeof createAssistantRouter>[0]> = {}) => {
  const a = express();
  a.use(express.json());
  const authenticate = (req: Request, _res: Response, next: NextFunction) => { (req as Request & { user: unknown; userId: string }).user = { ...user }; (req as Request & { userId: string }).userId = user.id; next(); };
  a.use('/api/assistant', createAssistantRouter({
    authenticate, extractor, visitTypes: async () => types, now: () => NOW,
    directory: { staff: async () => [{ id: 'u1', username: 'maria', name: 'Maria Lopez', role: 'sales_rep', branch: 'Seattle', active: true, location: 'Seattle', assignedLocations: ['Seattle'] }] } as never,
    ...opts
  }));
  return a;
};
const turn = (a: express.Express, body: unknown) => request(a).post('/api/assistant/turn').send(body as object);

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  useAppDbForTests(db);
}, 60_000);
afterAll(async () => { useAppDbForTests(null); await client?.close(); });
beforeEach(async () => {
  user = { id: 'u1', permissions: ['use_voice_assistant'] };
  extract.mockReset();
  extractor = { model: 'claude-haiku-5-5', extract };
  await db.delete(rateLimitHits); await db.delete(assistantUsage); await db.delete(voiceWords);
  await seedVoiceWords(STARTING_VOICE_WORDS, db);
});

describe('who may use it', () => {
  it('needs the switch for a turn and for the words', async () => {
    user = { id: 'u1', permissions: ['manage_voice_words'] };
    expect((await turn(app(), { text: 'hi', today: '2026-11-27' })).status).toBe(403);
    expect((await request(app()).get('/api/assistant/words')).status).toBe(403);
    expect(extract).not.toHaveBeenCalled();
  });
  it('answers 503 when the server has no Claude key, after checking the switch', async () => {
    extractor = null;
    expect((await turn(app(), { text: 'hi', today: '2026-11-27' })).status).toBe(503);
    user = { id: 'u1', permissions: [] };
    expect((await turn(app(), { text: 'hi', today: '2026-11-27' })).status).toBe(403);
  });
});

describe('a bad request', () => {
  it.each([
    ['no text', { today: '2026-11-27' }],
    ['text not a string', { text: 5, today: '2026-11-27' }],
    ['no today', { text: 'hello' }],
    ['a draft that is a list', { text: 'hello', today: '2026-11-27', draft: [] }],
    ['a question that does not exist', { text: 'hello', today: '2026-11-27', asking: 'password' }],
    ['text over the cap', { text: 'a'.repeat(2001), today: '2026-11-27' }]
  ])('%s is a 400 and never reaches Claude', async (_name, body) => {
    expect((await turn(app(), body)).status).toBe(400);
    expect(extract).not.toHaveBeenCalled();
  });
  it('does not count a bad request, or a silent one, against the limit', async () => {
    const a = app({ limits: { perMinute: 1, perDay: 1 } });
    for (let i = 0; i < 3; i++) await turn(a, { today: '2026-11-27' });
    const silent = await turn(a, { text: '  ...  ', today: '2026-11-27' });
    expect(silent.body).toMatchObject({ ok: false, reason: 'empty' });
    extract.mockResolvedValue(OK({ customerQuery: 'Smith' }));
    expect((await turn(a, { text: 'smith', today: '2026-11-27' })).status).toBe(200);
  });
  it('takes text at exactly the cap', async () => {
    extract.mockResolvedValue(OK({ notes: 'x' }));
    expect((await turn(app(), { text: 'a'.repeat(2000), today: '2026-11-27' })).status).toBe(200);
  });
});

describe('a turn', () => {
  it('answers the draft Claude found, with the company words and the shown visit types', async () => {
    extract.mockResolvedValue(OK({ customerQuery: 'Smith Granite', visitType: 'Quick Note', notes: 'Dropped samples' }));
    const res = await turn(app(), { text: 'dropped samples at smith granite', today: '2026-11-27' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, draft: visit({ customerQuery: 'Smith Granite', visitType: 'Quick Note', notes: 'Dropped samples' }) });
    const [said, opts] = extract.mock.calls[0];
    expect(said).toBe('dropped samples at smith granite');
    expect(opts.types.map((t) => t.name)).toEqual(['Quick Note', 'Formal Presentation']);
    expect(opts.today).toBe('2026-11-27');
    expect(opts.glossary).toContain('"cala cotta" → Calacatta');
  });
  it('merges an answer into the draft: only the asked field is replaced', async () => {
    extract.mockResolvedValue(OK({ notes: 'They want a quote', customerQuery: 'Someone Else', outcome: 'Wants a quote' }));
    const draft = visit({ customerQuery: 'Smith Granite', visitType: 'Formal Presentation', notes: 'old notes' });
    const res = await turn(app(), { text: 'they want a quote', today: '2026-11-27', draft, asking: 'notes' });
    expect(res.body.draft).toEqual({ ...draft, notes: 'They want a quote', outcome: 'Wants a quote' });
    expect(extract.mock.calls[0][1].asking).toBe('notes');
  });
  it('re-checks a draft sent by the client like Claude\'s own answer', async () => {
    extract.mockResolvedValue(OK({}));
    const res = await turn(app(), { text: 'skip', today: '2026-11-27', asking: 'outcome', draft: { customerQuery: 'Smith', visitType: 'Made Up', visitDate: '1999-01-01', followUpDate: 'tomorrow', notes: 7, evil: 'x' } });
    expect(res.body).toEqual({ ok: true, draft: visit({ customerQuery: 'Smith' }) });
  });
  it('after a question, an answer with nothing new keeps the draft', async () => {
    extract.mockResolvedValue(OK({}));
    const draft = visit({ customerQuery: 'Smith' });
    expect((await turn(app(), { text: 'none', today: '2026-11-27', draft, asking: 'outcome' })).body).toEqual({ ok: true, draft });
  });
  it('says so when the first thing said held nothing', async () => {
    extract.mockResolvedValue(OK({}));
    expect((await turn(app(), { text: 'um well', today: '2026-11-27' })).body).toMatchObject({ ok: false, reason: 'empty' });
  });
  it('uses its own day when the phone\'s is more than a day off', async () => {
    extract.mockResolvedValue(OK({ notes: 'x' }));
    await turn(app(), { text: 'hello there', today: '2030-01-01' });
    await turn(app(), { text: 'hello there', today: '2026-11-28' });
    expect(extract.mock.calls.map((c) => c[1].today)).toEqual(['2026-11-27', '2026-11-28']);
    expect(todayFor('nonsense', NOW)).toBe('2026-11-27');
    expect(todayFor('2026-11-26', NOW)).toBe('2026-11-26');
    expect(todayFor('2026-11-29', NOW)).toBe('2026-11-27');
  });
  it('still answers when the word list can\'t be read', async () => {
    extract.mockResolvedValue(OK({ notes: 'x' }));
    const a = app();
    useAppDbForTests(null); // no database at all: no glossary, no limits, no usage — but the turn still works
    const saved = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
    const res = await turn(a, { text: 'hello there', today: '2026-11-27' });
    if (saved) process.env.DATABASE_URL = saved;
    useAppDbForTests(db);
    expect(res.body).toMatchObject({ ok: true });
    expect(extract.mock.calls[0][1].glossary).toBe('');
  });
});

describe('Claude failing', () => {
  it.each(['failed', 'refused', 'unreadable'] as const)('turns %s into a message and a failed turn in the usage', async (reason) => {
    extract.mockResolvedValue({ ok: false, reason, message: 'internal wording', ms: 8000 });
    const res = await turn(app(), { text: 'hello there', today: '2026-11-27' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason });
    expect(res.body.message).not.toBe('internal wording');
    const [row] = await db.select().from(assistantUsage);
    expect(row).toMatchObject({ userId: 'u1', turns: 1, failed: 1 });
  });
  it('turns an extractor that throws into failed', async () => {
    extract.mockRejectedValue(new Error('socket hang up'));
    expect((await turn(app(), { text: 'hello there', today: '2026-11-27' })).body).toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('usage', () => {
  it('writes one row a day per person: turns, tokens and an estimated cost', async () => {
    extract.mockResolvedValue(OK({ notes: 'x' }));
    await turn(app(), { text: 'hello there', today: '2026-11-27' });
    await turn(app(), { text: 'hello again', today: '2026-11-27' });
    const [row] = await db.select().from(assistantUsage);
    expect(row).toMatchObject({ userId: 'u1', day: '2026-11-27', turns: 2, failed: 0, inputTokens: 200, outputTokens: 80, cacheReadTokens: 1800 });
    // 200 in at $0.10/M + 1800 cached at a tenth of that + 80 out at $0.50/M
    expect(row.costUsd).toBeCloseTo((200 * 0.1 + 1800 * 0.01 + 80 * 0.5) / 1e6, 8);
  });
  it('is readable by month, with names, only with the manage switch', async () => {
    extract.mockResolvedValue(OK({ notes: 'x' }));
    await turn(app(), { text: 'hello there', today: '2026-11-27' });
    expect((await request(app()).get('/api/assistant/usage')).status).toBe(403);
    user = { id: 'adm', permissions: ['manage_voice_words'] };
    const res = await request(app()).get('/api/assistant/usage?month=2026-11');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ month: '2026-11', turns: 1, failed: 0, people: [{ userId: 'u1', name: 'Maria Lopez', turns: 1, failed: 0 }] });
    expect((await request(app()).get('/api/assistant/usage')).body.month).toBe('2026-11');
    expect((await request(app()).get('/api/assistant/usage?month=Nov')).status).toBe(400);
    expect((await request(app()).get('/api/assistant/usage?month=2026-12')).body.turns).toBe(0);
  });
});

describe('the limits', () => {
  it('stops a burst with 429 and how long to wait, per person', async () => {
    extract.mockResolvedValue(OK({ notes: 'x' }));
    const a = app({ limits: { perMinute: 2 } });
    expect((await turn(a, { text: 'hello one', today: '2026-11-27' })).status).toBe(200);
    expect((await turn(a, { text: 'hello two', today: '2026-11-27' })).status).toBe(200);
    const third = await turn(a, { text: 'hello three', today: '2026-11-27' });
    expect(third.status).toBe(429);
    expect(third.body.message).toBeTruthy();
    expect(third.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(extract).toHaveBeenCalledTimes(2);
    user = { id: 'u2', permissions: ['use_voice_assistant'] };
    expect((await turn(a, { text: 'hello other', today: '2026-11-27' })).status).toBe(200);
  });
  it('stops a day\'s worth', async () => {
    extract.mockResolvedValue(OK({ notes: 'x' }));
    const a = app({ limits: { perDay: 3 } });
    for (let i = 0; i < 3; i++) expect((await turn(a, { text: `hello ${i}`, today: '2026-11-27' })).status).toBe(200);
    expect((await turn(a, { text: 'hello 4', today: '2026-11-27' })).status).toBe(429);
  });
  it('defaults to the contract\'s numbers', async () => {
    const { TURNS_PER_DAY, TURNS_PER_MINUTE } = await import('../utils/assistantContract.ts');
    expect([TURNS_PER_DAY, TURNS_PER_MINUTE]).toEqual([40, 10]);
  });
});

describe('what a rep says is never kept', () => {
  const SECRET = 'ZEBRA-PHRASE-9931 sold quartzite to Mrs Quimby';
  it('is in no log line, no console output and no table — on a good turn or a failed one', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const lines: string[] = [];
    try {
      const a = app({ log: (l) => lines.push(l) });
      extract.mockResolvedValue(OK({ customerQuery: 'Quimby', notes: 'quartzite' }));
      await turn(a, { text: SECRET, today: '2026-11-27', draft: visit({ notes: 'ZEBRA-DRAFT-777' }), asking: 'notes' });
      extract.mockRejectedValue(new Error(`boom ${SECRET}`));
      await turn(a, { text: SECRET, today: '2026-11-27' });
      extract.mockResolvedValue({ ok: false, reason: 'failed', message: 'x', ms: 1 });
      await turn(a, { text: SECRET, today: '2026-11-27' });
      const printed = JSON.stringify(spies.flatMap((s) => s.mock.calls)) + lines.join('\n');
      expect(printed).not.toMatch(/ZEBRA|Quimby|quartzite/i);
      expect(lines).toHaveLength(3);
    } finally { spies.forEach((s) => s.mockRestore()); }
    for (const l of lines) expect(Object.keys(JSON.parse(l)).sort()).toEqual(['cacheRead', 'evt', 'inTokens', 'model', 'ms', 'ok', 'outTokens', 'reason', 'userId']);
    const tables = JSON.stringify([await db.select().from(assistantUsage), await db.select().from(rateLimitHits), await listWords(db)]);
    expect(tables).not.toMatch(/ZEBRA|Quimby/i);
  });
  it('writes one structured line per turn with ids, counts and times', async () => {
    extract.mockResolvedValue(OK({ notes: 'x' }));
    const lines: string[] = [];
    await turn(app({ log: (l) => lines.push(l) }), { text: 'hello there', today: '2026-11-27' });
    expect(JSON.parse(lines[0])).toEqual({ evt: 'assistant-turn', userId: 'u1', ok: true, reason: '', ms: 321, model: 'claude-haiku-5-5', inTokens: 100, outTokens: 40, cacheRead: 900 });
  });
});

describe('GET /words', () => {
  it('gives the hints (at most 100, the mis-heard ones first, never Demo) and a version that follows the list', async () => {
    const first = (await request(app()).get('/api/assistant/words')).body;
    expect(first.hints.length).toBeLessThanOrEqual(HINTS_MAX);
    expect(first.hints.slice(0, 3)).toEqual(['Calacatta', 'Statuario', 'Arabesco']);
    expect(first.hints).not.toContain('Demo');
    expect(first.version).toMatch(/^[0-9a-z]+-[0-9a-f]+$/);
    user = { id: 'adm', permissions: ['use_voice_assistant', 'manage_voice_words'] };
    const a = app();
    const created = await request(a).post('/api/assistant/voice-words').send({ heard: 'smitty', meant: 'Smith Granite', kind: 'customer' });
    expect(created.status).toBe(201);
    const second = (await request(a).get('/api/assistant/words')).body;
    expect(second.version).not.toBe(first.version);
    expect(second.hints).toContain('Smith Granite');
    await request(a).patch(`/api/assistant/voice-words/${created.body.id}`).send({ active: false });
    const third = (await request(a).get('/api/assistant/words')).body;
    expect(third.hints).not.toContain('Smith Granite');
    expect(third.version).toBe(first.version);
  });
});

describe('Admin → Voice Words', () => {
  beforeEach(() => { user = { id: 'adm', permissions: ['manage_voice_words'] }; });
  const api = (path = '') => `/api/assistant/voice-words${path}`;

  it('needs the manage switch (the use switch is not enough)', async () => {
    user = { id: 'u1', permissions: ['use_voice_assistant'] };
    expect((await request(app()).get(api())).status).toBe(403);
    expect((await request(app()).post(api()).send({ meant: 'x', kind: 'other' })).status).toBe(403);
    expect((await request(app()).patch(api('/' + '0'.repeat(24))).send({ note: 'x' })).status).toBe(403);
    expect((await request(app()).delete(api('/' + '0'.repeat(24)))).status).toBe(403);
  });
  it('lists, adds, edits and removes', async () => {
    const a = app();
    const list = (await request(a).get(api())).body.words;
    expect(list.length).toBe(STARTING_VOICE_WORDS.length);
    const made = await request(a).post(api()).send({ heard: ' Smitty ', meant: 'Smith  Granite', kind: 'customer', note: 'nickname' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ heard: 'Smitty', meant: 'Smith Granite', kind: 'customer', active: true, note: 'nickname' });
    expect(typeof made.body.updatedAt).toBe('string');
    const edited = await request(a).patch(api('/' + made.body.id)).send({ meant: 'Smith Granite LLC', active: false });
    expect(edited.body).toMatchObject({ meant: 'Smith Granite LLC', heard: 'Smitty', active: false });
    expect((await request(a).delete(api('/' + made.body.id))).body).toEqual({ ok: true });
    expect((await request(a).delete(api('/' + made.body.id))).status).toBe(404);
    expect((await request(a).patch(api('/' + made.body.id)).send({ note: 'x' })).status).toBe(404);
  });
  it('refuses a duplicate heard (any case) with 409, and bad input with 400', async () => {
    const a = app();
    expect((await request(a).post(api()).send({ heard: 'CALA COTTA', meant: 'Other', kind: 'stone' })).status).toBe(409);
    const b = await request(a).post(api()).send({ heard: 'unique one', meant: 'Unique', kind: 'stone' });
    expect((await request(a).patch(api('/' + b.body.id)).send({ heard: 'Cala Cotta' })).status).toBe(409);
    for (const bad of [{ kind: 'stone' }, { meant: '', kind: 'stone' }, { meant: 'x', kind: 'nope' }, { meant: 'x'.repeat(81), kind: 'stone' }, { heard: 'same', meant: 'SAME', kind: 'stone' }, 'text', { meant: 'x', kind: 'stone', active: 'yes' }]) {
      expect((await request(a).post(api()).send(bad as never)).status).toBe(400);
    }
    expect((await request(a).patch(api('/' + b.body.id)).send({})).status).toBe(400);
    expect((await request(a).patch(api('/' + b.body.id)).send({ heard: 'unique' , meant: 'Unique' })).status).toBe(400);
  });
});
