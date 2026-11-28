/**
 * The voice assistant's CONTRACT: what the website, the phone app and the server agree on. Pure types and constants — no logic, no imports
 * from the screens or the server — so each side can be built and tested on its own. Plan: docs/VOICE_ASSISTANT_PLAN.md. Additive changes only:
 * if a side needs something different, change it here first and say so in the commit.
 */
import type { Question, SpokenVisit } from './assistantVisit.ts';

export type { Question, SpokenVisit };

/** Users & Roles switches (own section "Voice assistant"). Admin holds both; director and manager are given `use_voice_assistant` once. */
export const USE_VOICE_ASSISTANT = 'use_voice_assistant';
export const MANAGE_VOICE_WORDS = 'manage_voice_words';

export const TURN_TEXT_MAX = 2000;
/** Per person. The day is a rolling 24 h (Postgres rate-limit store); the minute guards a stuck button. */
export const TURNS_PER_DAY = 40;
export const TURNS_PER_MINUTE = 10;
/** Apple's limit on the phrases handed to the recognizer. */
export const HINTS_MAX = 100;

// ─── POST /api/assistant/turn ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * One spoken turn. The first turn has no `draft`. A later turn answers a question: it carries the `draft` so far and `asking` (the question
 * that was put). The server merges — only the asked field is replaced; other fields are filled only when they were empty (`mergeSpokenVisit`).
 * `today` is the person's local day (YYYY-MM-DD); the server accepts it only within a day of its own clock, else uses its own.
 * The transcript is never stored or logged.
 */
export interface TurnRequest {
  text: string;
  today: string;
  draft?: SpokenVisit;
  asking?: Question | null;
}

export type TurnFailure = 'empty' | 'refused' | 'unreadable' | 'failed' | 'busy';
export type TurnResponse =
  | { ok: true; draft: SpokenVisit }
  | { ok: false; reason: TurnFailure; message: string };
/** HTTP: 200 with the body above (a model failure is `ok:false`, not an error); 400 bad body; 401/403 no login / no `use_voice_assistant`;
 *  429 limit reached (body `{ message, retryAfterSeconds? }`); 503 the server has no ANTHROPIC_API_KEY (the screen offers typing). */

// ─── GET /api/assistant/words ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What the phone's recognizer is told to expect (`hints`, ≤ HINTS_MAX, hardest first) and what Claude is told to correct (kept on the
 *  server — the app only needs `version` to know when its cached hints are stale). Needs `use_voice_assistant`. */
export interface WordsResponse {
  /** Changes whenever any voice word changes; the app re-reads when it differs from its copy. */
  version: string;
  hints: string[];
}

// ─── Voice words (Admin → Voice Assistant → Words) — need `manage_voice_words` ───────────────────────────────────────────────────────────
export type VoiceWordKind = 'stone' | 'brand' | 'branch' | 'business' | 'slang' | 'customer' | 'other';
export interface VoiceWord {
  id: string;
  /** What the recognizer tends to write ("cala cotta gold"). "" for a plain word that is only a hint. */
  heard: string;
  /** What it should be ("Calacatta Gold"). Always set. */
  meant: string;
  kind: VoiceWordKind;
  active: boolean;
  note: string;
  updatedAt: string;
}
export type VoiceWordInput = Pick<VoiceWord, 'heard' | 'meant' | 'kind'> & Partial<Pick<VoiceWord, 'active' | 'note'>>;
/** GET    /api/assistant/voice-words          → { words: VoiceWord[] }
 *  POST   /api/assistant/voice-words          VoiceWordInput → VoiceWord      (409 when `heard` (case-insensitive) is already a word)
 *  PATCH  /api/assistant/voice-words/:id      Partial<VoiceWordInput> → VoiceWord
 *  DELETE /api/assistant/voice-words/:id      → { ok: true }                   (hide instead of delete is the screen's default) */

// ─── GET /api/assistant/usage?month=YYYY-MM — needs `manage_voice_words`; counts and cost only, never text ──────────────────────────────────
export interface UsageResponse {
  month: string;
  turns: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  /** Estimated from the model's list price. */
  costUsd: number;
  people: { userId: string; name: string; turns: number; failed: number }[];
}

// ─── Saving the visit ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The visit is saved by the ordinary `POST /api/customers/:id/visits`. The assistant adds ONE field to that body: `byVoice: true`. The server
 *  keeps it (`visits.by_voice`) only from someone holding `use_voice_assistant`, ignores it otherwise, and visit answers carry `byVoice: boolean`. */

// ─── The phone's Speech plugin (bridge name `Speech`, mobile/src/host) ───────────────────────────────────────────────────────────────────
export interface SpeechAvailability {
  /** False in a browser and in an app build without the plugin (the call fails, the web side treats that as false). */
  available: boolean;
  onDevice: boolean;
  permission: 'granted' | 'denied' | 'undetermined';
}
export interface SpeechPlugin {
  available(): Promise<SpeechAvailability>;
  requestPermission(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  /** Starts listening. Resolves once listening has begun. */
  start(options: { hints: string[]; lang?: string }): Promise<void>;
  /** Stops and resolves with everything heard, the recognizer's chunks joined (`addResult` / `heardText`). */
  stop(): Promise<{ text: string }>;
  abort(): Promise<void>;
  /** Events: `partial` { text } (everything heard so far), `level` { level } (0..1, for the animation), `error` { code, message }. */
  addListener(event: 'partial' | 'level' | 'error', handler: (data: any) => void): Promise<{ remove: () => Promise<void> }>;
}
