import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { HINTS_MAX } from '../../utils/assistantContract';
import type { TurnRequest, TurnResponse, WordsResponse } from '../../utils/assistantContract';
import type { SpokenVisit } from '../../utils/assistantVisit';
import type { FailureWhy } from './assistantMachine';

/**
 * The voice assistant's two server calls (contract: src/utils/assistantContract.ts) — a typed client with every answer the
 * screen has to handle turned into one shape. The transcript is sent and never kept: nothing here stores or logs the words.
 */

export type TurnResult =
  | { ok: true; draft: SpokenVisit }
  | { ok: false; reason: FailureWhy; message: string; retryAfterSeconds?: number };

const FAILURES = new Set<string>(['empty', 'refused', 'unreadable', 'failed', 'busy']);

const asJson = async (res: Response): Promise<Record<string, unknown>> => {
  try { return (await res.json()) as Record<string, unknown>; } catch { return {}; }
};

/** One spoken (or typed) turn. Never throws: a model failure, a limit, no signal, a missing key are all `ok: false`. */
export async function postTurn(request: TurnRequest, signal?: AbortSignal): Promise<TurnResult> {
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/assistant/turn`, { method: 'POST', body: JSON.stringify(request), signal });
  } catch {
    return { ok: false, reason: 'network', message: 'No connection.' };
  }
  const body = await asJson(res);
  const message = typeof body.message === 'string' ? body.message : '';
  if (res.status === 429) {
    const wait = Number(body.retryAfterSeconds);
    return { ok: false, reason: 'limit', message: message || 'You have reached today\'s limit for the assistant.', ...(Number.isFinite(wait) && wait > 0 ? { retryAfterSeconds: wait } : {}) };
  }
  if (res.status === 503) return { ok: false, reason: 'unavailable', message: message || 'The assistant is not available right now.' };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'forbidden', message: message || 'The assistant is not switched on for you.' };
  if (!res.ok) return { ok: false, reason: 'failed', message: message || 'The assistant could not answer.' };
  const answer = body as unknown as Partial<TurnResponse>;
  if (answer.ok === true && answer.draft && typeof answer.draft === 'object') return { ok: true, draft: answer.draft };
  const reason = (answer as { reason?: string }).reason;
  return { ok: false, reason: reason && FAILURES.has(reason) ? (reason as FailureWhy) : 'failed', message };
}

// ─── The recognizer's hints ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const WORDS_KEY = 'assistant.words.v1';
/** The server's list is re-read at most this often; between reads the cached copy is used. */
export const WORDS_REFRESH_MS = 30 * 60 * 1000;

let memory: WordsResponse | null = null;
let checkedAt = 0;
let inflight: Promise<WordsResponse | null> | null = null;

const validWords = (v: unknown): v is WordsResponse =>
  Boolean(v) && typeof (v as WordsResponse).version === 'string' && Array.isArray((v as WordsResponse).hints);

/** The copy this device already has (memory, else storage), or null. */
export function cachedWords(): WordsResponse | null {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(WORDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (validWords(parsed)) { memory = parsed; return memory; }
    }
  } catch { /* storage blocked: just load it */ }
  return null;
}

const keep = (words: WordsResponse) => {
  memory = words;
  try { window.localStorage.setItem(WORDS_KEY, JSON.stringify(words)); } catch { /* the in-memory copy still works */ }
};

/**
 * The recognizer's word list, cached by `version`: the cached copy answers at once; the server is asked again at most every
 * 30 minutes (or with `force`) and the copy is replaced only when the version differs. A failed read keeps what is cached.
 */
export function loadWords({ force = false }: { force?: boolean } = {}): Promise<WordsResponse | null> {
  const have = cachedWords();
  if (have && !force && Date.now() - checkedAt < WORDS_REFRESH_MS && checkedAt > 0) return Promise.resolve(have);
  if (inflight) return inflight;
  const run = (async (): Promise<WordsResponse | null> => {
    try {
      const res = await authFetch(`${API_URL}/api/assistant/words`);
      if (!res.ok) return cachedWords();
      const data = await asJson(res);
      if (!validWords(data)) return cachedWords();
      checkedAt = Date.now();
      const current = cachedWords();
      if (!current || current.version !== data.version) keep({ version: data.version, hints: data.hints.map(String) });
      return cachedWords();
    } catch {
      return cachedWords();
    } finally {
      inflight = null;
    }
  })();
  inflight = run;
  return run;
}

/** Forget the copy (a sign-out) so the next person never starts with someone else's. */
export function resetWordsCache(): void {
  memory = null; checkedAt = 0; inflight = null;
  try { window.localStorage.removeItem(WORDS_KEY); } catch { /* nothing to forget */ }
}

/**
 * What the recognizer is told to expect: this rep's last opened customers first (the names they are likeliest to say), then the
 * company's words, no repeats (case aside), at most HINTS_MAX.
 */
export function buildHints(words: WordsResponse | null | undefined, recentNames: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...recentNames, ...(words?.hints ?? [])]) {
    const hint = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const key = hint.toLowerCase();
    if (!hint || seen.has(key)) continue;
    seen.add(key);
    out.push(hint);
    if (out.length >= HINTS_MAX) break;
  }
  return out;
}
