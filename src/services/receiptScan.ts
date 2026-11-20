import Anthropic from '@anthropic-ai/sdk';
import { cleanScan, scanPrompt, scanSchema, type ReceiptScan, type ScanCategory } from '../utils/receiptScan.ts';

/**
 * Reads a receipt photo or PDF with Claude (Credit Card Receipts → Add receipt).
 * The rules — the schema, the prompt and the checks on the answer — are
 * src/utils/receiptScan.ts; this file only makes the call.
 *
 * Set up by ANTHROPIC_API_KEY (no key = no reading; the form works as before).
 * RECEIPT_SCAN_MODEL picks the model (default Claude Opus 5.5); try others with
 * scripts/receipt-scan-test.ts on real receipts before changing it.
 */

export const DEFAULT_RECEIPT_MODEL = 'claude-opus-5-5';

/** Models the API can rescue with another model when it declines (server-side fallbacks). */
const FALLBACK_MODELS = /^claude-(opus-5|opus-5-5|sonnet-5-5|fable-5)/;

export type ReceiptSource =
  | { url: string; pdf: boolean }
  | { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf' };

export type ScanResult =
  | { ok: true; scan: ReceiptScan; usage: { input: number; output: number }; model: string }
  | { ok: false; reason: 'refused' | 'unreadable' | 'failed'; message: string };

export type ReceiptScanner = {
  model: string;
  scan: (source: ReceiptSource, opts: { categories: ScanCategory[]; today: string }) => Promise<ScanResult>;
};

function contentBlock(source: ReceiptSource) {
  if ('url' in source) {
    return source.pdf
      ? { type: 'document' as const, source: { type: 'url' as const, url: source.url } }
      : { type: 'image' as const, source: { type: 'url' as const, url: source.url } };
  }
  return source.mediaType === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: source.data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: source.mediaType, data: source.data } };
}

/** null when ANTHROPIC_API_KEY isn't set. */
export function createReceiptScanner({
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.RECEIPT_SCAN_MODEL || DEFAULT_RECEIPT_MODEL,
  workspaceId = process.env.ANTHROPIC_WORKSPACE_ID
} = {}): ReceiptScanner | null {
  if (!apiKey) return null;
  // A receipt is one short answer: give up after 45 s and retry once, so the form never waits long.
  // A personal key (sk-ant-usr-…) isn't tied to a workspace, so Anthropic needs ANTHROPIC_WORKSPACE_ID
  // (wrkspc_…) sent with every request; a workspace key (sk-ant-api…) needs neither.
  const client = new Anthropic({
    apiKey, timeout: 45_000, maxRetries: 1,
    ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {})
  });
  const fallbacks = FALLBACK_MODELS.test(model);

  return {
    model,
    async scan(source, { categories, today }) {
      try {
        const response = await client.beta.messages.create({
          model,
          max_tokens: 4000,
          ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          // Reading a receipt needs little thought; low effort keeps it quick and cheap.
          output_config: { effort: 'low', format: { type: 'json_schema', schema: scanSchema(categories) } },
          messages: [{ role: 'user', content: [contentBlock(source), { type: 'text', text: scanPrompt(categories, today) }] }]
        });
        if (response.stop_reason === 'refusal') return { ok: false, reason: 'refused', message: 'Couldn’t read this receipt.' };
        const text = response.content.find((b) => b.type === 'text');
        if (!text || text.type !== 'text' || response.stop_reason === 'max_tokens') {
          return { ok: false, reason: 'unreadable', message: 'Couldn’t read this receipt.' };
        }
        let raw: unknown;
        try { raw = JSON.parse(text.text); } catch { return { ok: false, reason: 'unreadable', message: 'Couldn’t read this receipt.' }; }
        return {
          ok: true,
          scan: cleanScan(raw, { categories, today }),
          usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
          model: response.model
        };
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          console.error(`[receipt-scan] ${model} answered ${error.status}: ${error.message}`);
        } else {
          console.error('[receipt-scan] failed:', error);
        }
        return { ok: false, reason: 'failed', message: 'Couldn’t read this receipt right now.' };
      }
    }
  };
}
