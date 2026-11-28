import Anthropic from '@anthropic-ai/sdk';
import { cleanSpokenVisit, spokenVisitPrompt, spokenVisitSchema, type SpokenType, type SpokenVisit } from '../utils/assistantVisit.ts';

/**
 * Pulls a visit out of what a rep said out loud (the voice assistant). The rules — the schema, the prompt and the
 * checks on the answer — are src/utils/assistantVisit.ts; this file only makes the call, like receiptScan.ts.
 *
 * Set up by ANTHROPIC_API_KEY (no key = no assistant; the visit form works as before).
 * VISIT_EXTRACT_MODEL picks the model — compare them with scripts/voice-extract-test.ts before choosing.
 */

export const DEFAULT_VISIT_EXTRACT_MODEL = 'claude-haiku-5-5';

export type ExtractResult =
  | { ok: true; visit: SpokenVisit; usage: { input: number; output: number }; model: string; ms: number }
  | { ok: false; reason: 'refused' | 'unreadable' | 'failed'; message: string };

export type VisitExtractor = {
  model: string;
  extract: (spoken: string, opts: { types: SpokenType[]; today: string }) => Promise<ExtractResult>;
};

/** null when ANTHROPIC_API_KEY isn't set. */
export function createVisitExtractor({
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.VISIT_EXTRACT_MODEL || DEFAULT_VISIT_EXTRACT_MODEL,
  workspaceId = process.env.ANTHROPIC_WORKSPACE_ID
} = {}): VisitExtractor | null {
  if (!apiKey) return null;
  // A spoken visit is one short answer; give up after 20 s (a rep is waiting) and retry once.
  const client = new Anthropic({
    apiKey, timeout: 20_000, maxRetries: 1,
    ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {})
  });

  return {
    model,
    async extract(spoken, { types, today }) {
      const started = Date.now();
      try {
        const response = await client.beta.messages.create({
          model,
          max_tokens: 1200,
          // Pulling words into fields needs little thought; low effort keeps it quick and cheap.
          output_config: { effort: 'low', format: { type: 'json_schema', schema: spokenVisitSchema(types) } },
          messages: [{ role: 'user', content: [{ type: 'text', text: `${spokenVisitPrompt(types, today)}\n\nWhat the rep said:\n"""\n${spoken.slice(0, 2000)}\n"""` }] }]
        });
        if (response.stop_reason === 'refusal') return { ok: false, reason: 'refused', message: 'Couldn’t understand that.' };
        const block = response.content.find((b) => b.type === 'text');
        if (!block || block.type !== 'text' || response.stop_reason === 'max_tokens') return { ok: false, reason: 'unreadable', message: 'Couldn’t understand that.' };
        let raw: unknown;
        try { raw = JSON.parse(block.text); } catch { return { ok: false, reason: 'unreadable', message: 'Couldn’t understand that.' }; }
        return {
          ok: true,
          visit: cleanSpokenVisit(raw, { types, today }),
          usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
          model: response.model,
          ms: Date.now() - started
        };
      } catch (error) {
        if (error instanceof Anthropic.APIError) console.error(`[visit-extract] ${model} answered ${error.status}: ${error.message}`);
        else console.error('[visit-extract] failed:', error);
        return { ok: false, reason: 'failed', message: 'Couldn’t understand that right now.' };
      }
    }
  };
}
