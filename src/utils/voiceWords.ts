/**
 * Voice words (2026-11-28; plan in docs/VOICE_ASSISTANT_PLAN.md, "Getting the words right"): the company's own list of words the
 * speech recognizer gets wrong. Pure rules shared by the server and Admin → Voice Words — what a word may be, the recognizer hints,
 * the glossary Claude is given, the list's version, and what a turn costs. Tested in voiceWords.test.ts.
 *
 * A word is `heard` → `meant`: "cala cotta" → "Calacatta". A plain word (`heard` = "") is only a hint for the recognizer and a
 * spelling for Claude. Nothing here ever holds what a rep said.
 */
import { HINTS_MAX, type VoiceWordInput, type VoiceWordKind } from './assistantContract.ts';

export const VOICE_WORD_KIND_LIST: readonly VoiceWordKind[] = ['stone', 'brand', 'branch', 'business', 'slang', 'customer', 'other'];
export const WORD_MAX = 80;
export const NOTE_MAX = 300;
/** Bounds on what goes into Claude's prompt, so a long list can't make every turn slow or dear. */
export const GLOSSARY_PAIRS_MAX = 300;
export const GLOSSARY_TERMS_MAX = 400;

const tidy = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** What a person typed, or what an old client sent, made safe. `partial` for PATCH: only the keys that were sent are checked. */
export function cleanVoiceWordInput(raw: unknown, { partial = false }: { partial?: boolean } = {}):
  { ok: true; value: Partial<VoiceWordInput> } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Send the word.' };
  const r = raw as Record<string, unknown>;
  const value: Partial<VoiceWordInput> = {};
  if (!partial || r.meant !== undefined) {
    const meant = tidy(r.meant, WORD_MAX + 1);
    if (!meant) return { ok: false, message: 'Say what it should be.' };
    if (meant.length > WORD_MAX) return { ok: false, message: `Keep it to ${WORD_MAX} characters.` };
    value.meant = meant;
  }
  if (!partial || r.heard !== undefined) {
    const heard = tidy(r.heard, WORD_MAX + 1);
    if (heard.length > WORD_MAX) return { ok: false, message: `Keep it to ${WORD_MAX} characters.` };
    value.heard = heard;
  }
  if (!partial || r.kind !== undefined) {
    const kind = r.kind === undefined ? 'other' : r.kind;
    if (typeof kind !== 'string' || !VOICE_WORD_KIND_LIST.includes(kind as VoiceWordKind)) return { ok: false, message: 'Choose a kind of word.' };
    value.kind = kind as VoiceWordKind;
  }
  if (r.active !== undefined) {
    if (typeof r.active !== 'boolean') return { ok: false, message: 'Active is on or off.' };
    value.active = r.active;
  }
  if (r.note !== undefined) {
    const note = tidy(r.note, NOTE_MAX + 1);
    if (note.length > NOTE_MAX) return { ok: false, message: `Keep the note to ${NOTE_MAX} characters.` };
    value.note = note;
  }
  if (partial && !Object.keys(value).length) return { ok: false, message: 'Nothing to change.' };
  // A word that "hears" what it means says nothing.
  if (value.heard && value.meant && value.heard.toLowerCase() === value.meant.toLowerCase()) return { ok: false, message: 'What it is heard as and what it means are the same.' };
  return { ok: true, value };
}

type WordLike = { heard: string; meant: string; active?: boolean };

/**
 * The phrases handed to the phone's recognizer: at most HINTS_MAX, hardest first. The list's own order is its priority (the seed is
 * written hardest first), but a word with a known mis-hearing is by definition hard, so those lead. One phrase once, however spelled.
 */
export function hintsFrom(words: readonly WordLike[], max = HINTS_MAX): string[] {
  const live = words.filter((w) => w.active !== false && w.meant);
  const ordered = [...live.filter((w) => w.heard), ...live.filter((w) => !w.heard)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of ordered) {
    const key = w.meant.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w.meant);
    if (out.length >= max) break;
  }
  return out;
}

export type Glossary = { pairs: [heard: string, meant: string][]; terms: string[] };
export const EMPTY_GLOSSARY: Glossary = { pairs: [], terms: [] };

/**
 * What Claude is told to correct. Sorted, so the same words always make the same text — the prompt's start must not change from one
 * turn to the next or it can't be cached.
 */
export function glossaryFrom(words: readonly WordLike[]): Glossary {
  const live = words.filter((w) => w.active !== false && w.meant);
  const byLower = <T,>(get: (x: T) => string) => (a: T, b: T) => (get(a).toLowerCase() < get(b).toLowerCase() ? -1 : get(a).toLowerCase() > get(b).toLowerCase() ? 1 : 0);
  const pairs = live.filter((w) => w.heard).map((w) => [w.heard, w.meant] as [string, string]).sort(byLower((p) => p[0])).slice(0, GLOSSARY_PAIRS_MAX);
  const terms = [...new Set(live.map((w) => w.meant))].sort(byLower((t) => t)).slice(0, GLOSSARY_TERMS_MAX);
  return { pairs, terms };
}

/** The glossary as prompt text ('' when there are no words). */
export function glossaryText(g: Glossary): string {
  const parts: string[] = [];
  if (g.pairs.length) {
    parts.push('Speech-recognition slips this company knows about — when the transcript has the left side, the rep almost certainly said the right side (use the right side in your answer):');
    parts.push(...g.pairs.map(([heard, meant]) => `- "${heard}" → ${meant}`));
  }
  if (g.terms.length) {
    parts.push('Words this company uses — spell them exactly like this when the transcript has them or something that sounds like them:');
    parts.push(g.terms.join('; '));
  }
  return parts.join('\n');
}

/**
 * A short code that changes whenever an active word's text changes (two 53-bit string hashes — no crypto, so the screens can use this
 * too). The phone re-reads its hints when it differs from its copy.
 */
export function wordsVersion(words: readonly WordLike[]): string {
  const live = words.filter((w) => w.active !== false && w.meant).map((w) => `${w.heard.toLowerCase()}\u0001${w.meant}`).sort();
  const text = live.join('\u0002');
  const hash = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  };
  return `${live.length.toString(36)}-${hash(0)}${hash(1).slice(-4)}`;
}

/** Claude Haiku's list price, USD per million tokens (the owner's estimate basis, 2026-11-28). Cached input reads cost a tenth. */
export const PRICE_PER_MILLION = { input: 0.1, output: 0.5, cacheReadFactor: 0.1 } as const;

/** What one call cost, estimated. `input` is the uncached part (cache writes included); `cacheRead` the cached part. */
export function turnCostUsd({ input = 0, output = 0, cacheRead = 0 }: { input?: number; output?: number; cacheRead?: number }): number {
  const usd = (input * PRICE_PER_MILLION.input + cacheRead * PRICE_PER_MILLION.input * PRICE_PER_MILLION.cacheReadFactor + output * PRICE_PER_MILLION.output) / 1_000_000;
  return Math.round(usd * 1e8) / 1e8;
}

/** YYYY-MM for a usage month, or null when it isn't one. */
export const monthOf = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);
