import type { NextFunction, Request, RequestHandler, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { PostgresRateLimitStore } from '../services/rateLimitStore.ts';
import { staffDirectory, type Directory } from '../services/locationTracking.ts';
import type { VisitExtractor } from '../services/visitExtract.ts';
import * as store from '../db/voiceAssistant/index.ts';
import {
  MANAGE_VOICE_WORDS, TURNS_PER_DAY, TURNS_PER_MINUTE, TURN_TEXT_MAX, USE_VOICE_ASSISTANT,
  type TurnFailure, type TurnResponse, type UsageResponse, type VoiceWord, type WordsResponse
} from '../utils/assistantContract.ts';
import {
  cleanSpokenVisit, mergeSpokenVisit, spokenIsEmpty, type Question, type SpokenType, type SpokenVisit
} from '../utils/assistantVisit.ts';
import { activeTypes } from '../utils/typeLists.ts';
import { cleanVoiceWordInput, glossaryFrom, glossaryText, hintsFrom, monthOf, turnCostUsd, wordsVersion } from '../utils/voiceWords.ts';

/**
 * The voice assistant's server side (2026-11-28; docs/VOICE_ASSISTANT_PLAN.md, the contract is src/utils/assistantContract.ts).
 *
 *   POST   /api/assistant/turn              one spoken turn → the draft visit, or why not        needs use_voice_assistant
 *   GET    /api/assistant/words             { version, hints } for the phone's recognizer        needs use_voice_assistant
 *   GET    /api/assistant/voice-words       the list (Admin → Voice Words)                        needs manage_voice_words
 *   POST   /api/assistant/voice-words       add a word            PATCH /:id   edit    DELETE /:id   remove
 *   GET    /api/assistant/usage?month=      counts and estimated cost, never text                 needs manage_voice_words
 *
 *   app.use('/api/assistant', createAssistantRouter({ authenticate, extractor, visitTypes }));
 *
 * Stateless: the draft travels with each turn, so any server instance can answer. Claude only extracts; nothing is saved here (the
 * visit is saved by the ordinary visit route after the person taps Save). THE TRANSCRIPT AND THE DRAFT ARE NEVER STORED OR LOGGED:
 * one structured line per turn carries only ids, counts and times, and `assistant_usage` only counts and cost.
 */

type StaffRequest = Request & { user?: { permissions?: string[] }; userId?: string };
const has = (req: Request, perm: string) => Boolean((req as StaffRequest).user?.permissions?.includes(perm));
const personOf = (req: Request) => String((req as StaffRequest).userId || (req as StaffRequest).user?.id || 'anonymous');

const pacificDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayNumber = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;

/** The person's own day, if it is within a day of ours (a phone's clock can be wrong, or a person far from the server), else ours. */
export function todayFor(claimed: unknown, nowMs: number): string {
  if (typeof claimed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(claimed) && !Number.isNaN(dayNumber(claimed))) {
    if (Math.abs(dayNumber(claimed) - dayNumber(utcDay(nowMs))) <= 1) return claimed;
  }
  return pacificDay(nowMs);
}

const QUESTIONS: readonly Question[] = ['customer', 'type', 'notes', 'outcome', 'followUp'];
const MESSAGES: Record<TurnFailure, string> = {
  empty: 'Didn’t catch that. Try again, or type it instead.',
  refused: 'Couldn’t understand that. Try again, or type it instead.',
  unreadable: 'Couldn’t understand that. Try again, or type it instead.',
  failed: 'The assistant isn’t available right now. Type it instead.',
  busy: 'The assistant is busy. Try again in a moment, or type it instead.'
};

type Options = {
  authenticate: RequestHandler;
  /** null when ANTHROPIC_API_KEY isn't set: turns answer 503 and the screen offers typing. */
  extractor: VisitExtractor | null;
  /** The Add visit types (name, label, active, fields); the assistant offers only the shown ones. */
  visitTypes: () => Promise<SpokenType[]>;
  directory?: Directory;
  limits?: { perDay?: number; perMinute?: number };
  now?: () => number;
  /** The one line a turn writes. Never given text. */
  log?: (line: string) => void;
};

export default function createAssistantRouter({
  authenticate, extractor, visitTypes, directory = staffDirectory,
  limits = {}, now = Date.now, log = (line) => console.log(line)
}: Options) {
  const router = express.Router();
  const canUse = (req: Request, res: Response, next: NextFunction) => (has(req, USE_VOICE_ASSISTANT) ? next() : res.status(403).json({ message: 'The voice assistant isn’t switched on for you.' }));
  const canManage = (req: Request, res: Response, next: NextFunction) => (has(req, MANAGE_VOICE_WORDS) ? next() : res.status(403).json({ message: 'You can’t manage voice words.' }));
  const fail = (res: Response, what: string, err: unknown) => {
    console.error(`[assistant] ${what} failed:`, err instanceof Error ? err.name : 'error');
    res.status(500).json({ message: 'Something went wrong with the voice assistant.' });
  };

  // ── the word list, read once in a while rather than on every turn ───────────────────────────────────────────────
  type Snapshot = { at: number; version: string; hints: string[]; glossary: string };
  let snapshot: Snapshot | null = null;
  const SNAPSHOT_MS = 30_000;
  const loadSnapshot = async (): Promise<Snapshot> => {
    if (snapshot && now() - snapshot.at < SNAPSHOT_MS) return snapshot;
    const words = await store.listWords();
    snapshot = { at: now(), version: wordsVersion(words), hints: hintsFrom(words), glossary: glossaryText(glossaryFrom(words)) };
    return snapshot;
  };
  const forgetSnapshot = () => { snapshot = null; };

  // ── limits: a burst and a day, per person, counted in Postgres so every server instance shares them ──────────────────
  const retryAfter = (req: Request) => {
    const reset = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
    return reset ? Math.max(1, Math.ceil((reset.getTime() - now()) / 1000)) : undefined;
  };
  const limiter = (name: string, windowMs: number, limit: number, message: string) => rateLimit({
    windowMs, limit, keyGenerator: personOf, store: new PostgresRateLimitStore(name), passOnStoreError: true,
    standardHeaders: false, legacyHeaders: false, validate: false,
    handler: (req, res) => { res.status(429).json({ message, retryAfterSeconds: retryAfter(req) }); }
  });
  const perMinute = limiter('assistant-turn-minute', 60_000, limits.perMinute ?? TURNS_PER_MINUTE, 'Too many at once. Wait a moment, or type it instead.');
  const perDay = limiter('assistant-turn-day', 24 * 60 * 60 * 1000, limits.perDay ?? TURNS_PER_DAY, 'You’ve reached today’s limit for the voice assistant. Type it instead.');

  // ── POST /turn ───────────────────────────────────────────────────────────────────────────────────────────────────
  type Turn = { text: string; today: string; draft?: unknown; asking: Question | null };
  const checkBody: RequestHandler = (req, res, next) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ message: 'Send what was said.' });
    if (typeof b.text !== 'string') return res.status(400).json({ message: 'Send what was said.' });
    if (b.text.length > TURN_TEXT_MAX) return res.status(400).json({ message: `That is too long. Keep it under ${TURN_TEXT_MAX} characters.` });
    if (typeof b.today !== 'string') return res.status(400).json({ message: 'Send today’s date.' });
    if (b.draft !== undefined && b.draft !== null && (typeof b.draft !== 'object' || Array.isArray(b.draft))) return res.status(400).json({ message: 'The draft is not valid.' });
    if (b.asking !== undefined && b.asking !== null && !QUESTIONS.includes(b.asking)) return res.status(400).json({ message: 'The question is not valid.' });
    const text = b.text.replace(/\s+/g, ' ').trim();
    // Nothing to read: no need to ask Claude, or to count it against the day.
    if (!/[\p{L}\p{N}]/u.test(text)) return res.json({ ok: false, reason: 'empty', message: MESSAGES.empty } satisfies TurnResponse);
    res.locals.turn = { text, today: todayFor(b.today, now()), draft: b.draft ?? undefined, asking: b.asking ?? null } satisfies Turn;
    next();
  };

  router.post('/turn', authenticate, canUse, (req, res, next) => (extractor ? next() : res.status(503).json({ message: 'The voice assistant isn’t set up on the server.' })),
    checkBody, perMinute, perDay, async (req: Request, res: Response) => {
      const turn = res.locals.turn as Turn;
      const userId = personOf(req);
      const started = now();
      const finish = async (answer: TurnResponse, info: { model: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }; ms?: number }) => {
        const usage = info.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        const reason = answer.ok ? '' : answer.reason;
        const ms = info.ms ?? now() - started;
        // One line a turn: who, whether it worked, why not, how long, which model, how many tokens. No words.
        log(JSON.stringify({ evt: 'assistant-turn', userId, ok: answer.ok, reason, ms, model: info.model, inTokens: usage.input + usage.cacheWrite, outTokens: usage.output, cacheRead: usage.cacheRead }));
        // A turn that never reached Claude's answer (down, refused, unreadable) counts as failed; "didn't hear anything" is not the service failing.
        const failed = !answer.ok && reason !== 'empty';
        // Written before answering (a serverless instance may stop the moment it has answered); a failure here never costs the rep their turn.
        await store.recordTurn({
          userId, day: pacificDay(now()), ok: !failed, input: usage.input + usage.cacheWrite, output: usage.output, cacheRead: usage.cacheRead,
          costUsd: turnCostUsd({ input: usage.input + usage.cacheWrite, output: usage.output, cacheRead: usage.cacheRead })
        }).catch((err) => console.error('[assistant] usage not written:', err instanceof Error ? err.name : 'error'));
        res.json(answer);
      };
      try {
        const types = activeTypes(await visitTypes());
        // The glossary is a nicety: if the word list can't be read the turn still runs without it.
        const words = await loadSnapshot().catch((err) => { console.error('[assistant] words not read:', err instanceof Error ? err.name : 'error'); return null; });
        // A draft from a client is only text: re-check it like Claude's own answer before anything is merged into it.
        const prev: SpokenVisit | undefined = turn.draft === undefined ? undefined : cleanSpokenVisit(turn.draft, { types, today: turn.today });
        const result = await extractor!.extract(turn.text, { types, today: turn.today, asking: turn.asking, glossary: words?.glossary || '' });
        if (!result.ok) return await finish({ ok: false, reason: result.reason, message: MESSAGES[result.reason] }, { model: extractor!.model, usage: result.usage, ms: result.ms });
        const merged = mergeSpokenVisit(prev, result.visit, turn.asking);
        // First thing said and nothing in it: say so. (After a question, "nothing new" is a fine answer — "skip" — and keeps the draft.)
        if (!prev && !turn.asking && spokenIsEmpty(merged)) return await finish({ ok: false, reason: 'empty', message: MESSAGES.empty }, { model: result.model, usage: result.usage, ms: result.ms });
        return await finish({ ok: true, draft: merged }, { model: result.model, usage: result.usage, ms: result.ms });
      } catch (err) {
        console.error('[assistant] turn failed:', err instanceof Error ? err.name : 'error');
        return await finish({ ok: false, reason: 'failed', message: MESSAGES.failed }, { model: extractor?.model || '' });
      }
    });

  // ── GET /words ───────────────────────────────────────────────────────────────────────────────────────────────────
  router.get('/words', authenticate, canUse, async (_req, res) => {
    try {
      const { version, hints } = await loadSnapshot();
      res.json({ version, hints } satisfies WordsResponse);
    } catch (err) { fail(res, 'words', err); }
  });

  // ── Admin → Voice Words ──────────────────────────────────────────────────────────────────────────────────────────
  router.get('/voice-words', authenticate, canManage, async (_req, res) => {
    try { res.json({ words: await store.listWords() }); } catch (err) { fail(res, 'list', err); }
  });

  const duplicateMessage = 'That word is already on the list.';
  router.post('/voice-words', authenticate, canManage, async (req, res) => {
    const input = cleanVoiceWordInput(req.body);
    if (!input.ok) return res.status(400).json({ message: input.message });
    try {
      const saved = await store.addWord(input.value as Required<Pick<VoiceWord, 'heard' | 'meant' | 'kind'>> & { active?: boolean; note?: string });
      if ('duplicate' in saved) return res.status(409).json({ message: duplicateMessage });
      forgetSnapshot();
      res.status(201).json(saved.word);
    } catch (err) { fail(res, 'add', err); }
  });

  router.patch('/voice-words/:id', authenticate, canManage, async (req, res) => {
    const input = cleanVoiceWordInput(req.body, { partial: true });
    if (!input.ok) return res.status(400).json({ message: input.message });
    try {
      // The same-text check needs the word's other half when only one side is sent.
      const current = (await store.listWords()).find((w) => w.id === String(req.params.id));
      if (!current) return res.status(404).json({ message: 'That word isn’t on the list.' });
      const heard = input.value.heard ?? current.heard, meant = input.value.meant ?? current.meant;
      if (heard && heard.toLowerCase() === meant.toLowerCase()) return res.status(400).json({ message: 'What it is heard as and what it means are the same.' });
      const saved = await store.editWord(current.id, input.value);
      if (!saved) return res.status(404).json({ message: 'That word isn’t on the list.' });
      if ('duplicate' in saved) return res.status(409).json({ message: duplicateMessage });
      forgetSnapshot();
      res.json(saved.word);
    } catch (err) { fail(res, 'edit', err); }
  });

  router.delete('/voice-words/:id', authenticate, canManage, async (req, res) => {
    try {
      if (!(await store.removeWord(String(req.params.id)))) return res.status(404).json({ message: 'That word isn’t on the list.' });
      forgetSnapshot();
      res.json({ ok: true });
    } catch (err) { fail(res, 'remove', err); }
  });

  // ── GET /usage ───────────────────────────────────────────────────────────────────────────────────────────────────
  router.get('/usage', authenticate, canManage, async (req, res) => {
    const asked = req.query.month;
    const month = asked === undefined ? pacificDay(now()).slice(0, 7) : monthOf(asked);
    if (!month) return res.status(400).json({ message: 'Month must look like 2026-11.' });
    try {
      const usage = await store.usageForMonth(month);
      const names = new Map((await directory.staff().catch(() => [])).map((s) => [s.id, s.name]));
      res.json({
        month, turns: usage.turns, failed: usage.failed, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd,
        people: usage.people.map((p) => ({ ...p, name: names.get(p.userId) || 'Unknown' }))
      } satisfies UsageResponse);
    } catch (err) { fail(res, 'usage', err); }
  });

  return router;
}
