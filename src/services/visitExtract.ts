import Anthropic from '@anthropic-ai/sdk';
import {
  cleanSpokenVisit, spokenVisitInstruction, spokenVisitRequest, spokenVisitSchema,
  type Question, type SpokenType, type SpokenVisit
} from '../utils/assistantVisit.ts';

/**
 * Pulls a visit out of what a rep said out loud (the voice assistant). The rules — the schema, the prompt and the
 * checks on the answer — are src/utils/assistantVisit.ts; this file only makes the call, like receiptScan.ts.
 *
 * Set up by ANTHROPIC_API_KEY (no key = no assistant; the visit form works as before).
 * VISIT_EXTRACT_MODEL picks the model — compare them with scripts/voice-extract-test.ts before choosing.
 *
 * A rep is waiting, so a slow or failing Claude must cost them as little as possible:
 *   - each attempt gives up after 8 s, and there is one retry (a timeout, a dropped connection, a 429 or a 5xx — never a refusal
 *     or a bad request, which would answer the same again);
 *   - a small circuit breaker: three failed calls in a row and the next 30 s are answered at once with `failed` (no waiting, no
 *     cost), then one call is let through to see if Claude is back;
 *   - the instruction, the visit types and the company word list are sent first and marked cacheable, with everything about this one
 *     request (today, the question, the words) last, so repeat calls read the start from the cache and are cheaper and quicker.
 * The model is given NO tools and the rep's words sit in a fenced block it is told is data.
 */

export const DEFAULT_VISIT_EXTRACT_MODEL = 'claude-haiku-5-5';
export const ATTEMPT_TIMEOUT_MS = 8_000;
export const BREAKER_FAILURES = 3;
export const BREAKER_OPEN_MS = 30_000;
const RETRY_PAUSE_MS = 300;

export type ExtractUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type ExtractOptions = {
  types: SpokenType[];
  today: string;
  /** The question this answers (merged by the route; here it only tells Claude what the words are about). */
  asking?: Question | null;
  /** `glossaryText(...)` of the company's voice words ('' for none). */
  glossary?: string;
};
export type ExtractResult =
  | { ok: true; visit: SpokenVisit; usage: ExtractUsage; model: string; ms: number }
  | { ok: false; reason: 'refused' | 'unreadable' | 'failed'; message: string; ms: number; usage?: ExtractUsage; shortCircuited?: boolean };

export type VisitExtractor = {
  model: string;
  extract: (spoken: string, opts: ExtractOptions) => Promise<ExtractResult>;
};

/** "N failures in a row → closed for a while." Time is injected so a test needn't wait. */
export function createBreaker({ failures = BREAKER_FAILURES, openMs = BREAKER_OPEN_MS, now = Date.now } = {}) {
  let fails = 0;
  let openUntil = 0;
  return {
    /** False while the breaker is open. After the pause one call is allowed through; if it fails the pause starts again. */
    allow: () => now() >= openUntil,
    success: () => { fails = 0; openUntil = 0; },
    failure: () => { fails += 1; if (fails >= failures) openUntil = now() + openMs; }
  };
}
export type Breaker = ReturnType<typeof createBreaker>;

/** Worth another try: it might answer next time. */
function retryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIConnectionError) return true; // includes timeouts
  if (error instanceof Anthropic.APIError) {
    const s = error.status;
    return s === undefined || s === 408 || s === 409 || s === 429 || s >= 500;
  }
  return false;
}

const UNREADABLE = 'Couldn’t understand that.';
type MessagesClient = { beta: { messages: { create: (params: never) => Promise<Anthropic.Beta.BetaMessage> } } };

/** null when ANTHROPIC_API_KEY isn't set. `client`, `breaker` and `sleep` are for tests. */
export function createVisitExtractor({
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.VISIT_EXTRACT_MODEL || DEFAULT_VISIT_EXTRACT_MODEL,
  workspaceId = process.env.ANTHROPIC_WORKSPACE_ID,
  client: injected,
  breaker = createBreaker(),
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
}: { apiKey?: string; model?: string; workspaceId?: string; client?: unknown; breaker?: Breaker; sleep?: (ms: number) => Promise<void> } = {}): VisitExtractor | null {
  if (!apiKey && !injected) return null;
  // The attempts and the pause between them are ours (maxRetries 0), so the whole wait is bounded and known.
  const client = (injected ?? new Anthropic({
    apiKey, timeout: ATTEMPT_TIMEOUT_MS, maxRetries: 0,
    ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {})
  })) as MessagesClient;

  const call = (spoken: string, { types, today, asking, glossary }: ExtractOptions) => client.beta.messages.create({
    model,
    max_tokens: 1200,
    // Pulling words into fields needs little thought; low effort keeps it quick and cheap.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: spokenVisitSchema(types) } },
    // The stable part first, marked cacheable; this request's own text last. No tools are offered.
    system: [{ type: 'text', text: spokenVisitInstruction(types, glossary || ''), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: spokenVisitRequest({ today, asking, text: spoken }) }] }]
  } as never);

  return {
    model,
    async extract(spoken, opts) {
      const started = Date.now();
      const took = () => Date.now() - started;
      if (!breaker.allow()) return { ok: false, reason: 'failed', message: 'Couldn’t understand that right now.', ms: 0, shortCircuited: true };
      let response: Anthropic.Beta.BetaMessage | null = null;
      for (let attempt = 1; attempt <= 2 && !response; attempt++) {
        try {
          response = await call(spoken, opts);
        } catch (error) {
          if (error instanceof Anthropic.APIError) console.error(`[visit-extract] ${model} answered ${error.status ?? 'no status'} (attempt ${attempt}): ${error.name}`);
          else console.error(`[visit-extract] failed (attempt ${attempt}):`, error instanceof Error ? error.name : 'error');
          if (attempt === 2 || !retryable(error)) {
            breaker.failure();
            return { ok: false, reason: 'failed', message: 'Couldn’t understand that right now.', ms: took() };
          }
          await sleep(RETRY_PAUSE_MS);
        }
      }
      // Claude answered, whatever it said: the service is up.
      breaker.success();
      const u = response!.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
      const usage: ExtractUsage = {
        input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0
      };
      if (response!.stop_reason === 'refusal') return { ok: false, reason: 'refused', message: UNREADABLE, ms: took(), usage };
      const block = response!.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text' || response!.stop_reason === 'max_tokens') return { ok: false, reason: 'unreadable', message: UNREADABLE, ms: took(), usage };
      let raw: unknown;
      try { raw = JSON.parse(block.text); } catch { return { ok: false, reason: 'unreadable', message: UNREADABLE, ms: took(), usage }; }
      return { ok: true, visit: cleanSpokenVisit(raw, { types: opts.types, today: opts.today }), usage, model: response!.model, ms: took() };
    }
  };
}
