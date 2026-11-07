/**
 * Machine translation of the free-text notes between purchasing and a
 * supplier (src/utils/supplierBlocks.ts `Note`). Optional: it runs only when
 * GOOGLE_TRANSLATE_API_KEY is set (Google Cloud Translation, v2 REST). Without
 * it, or when a call fails, the note is saved as typed and the reader sees the
 * original — a note is never lost or held up waiting for a translation.
 *
 * Reasons and the portal's own words don't come through here: they're in
 * src/utils/supplierI18n.ts for every language.
 */
import type { Note } from '../utils/supplierBlocks.ts';

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const TIMEOUT_MS = 6000;

type Fetch = typeof fetch;

export const translationOn = () => Boolean(process.env.GOOGLE_TRANSLATE_API_KEY);

/** `text` in `to`, or '' when it can't be translated. */
export async function translateText(text: string, to: string, from: string, fetchImpl: Fetch = fetch): Promise<string> {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key || !text.trim() || to === from) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, target: to, source: from, format: 'text' }),
      signal: controller.signal
    });
    if (!res.ok) {
      console.warn(`[translate] ${from}→${to} answered ${res.status}`);
      return '';
    }
    const data = await res.json() as { data?: { translations?: { translatedText?: string }[] } };
    return String(data.data?.translations?.[0]?.translatedText || '');
  } catch (error) {
    console.warn('[translate] failed:', (error as Error).message);
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A note as saved: what was typed, its language, and its translation into each
 * of `readers` (the other side's languages). Empty text → null.
 */
export async function makeNote(text: string, lang: string, readers: string[], by: string, fetchImpl: Fetch = fetch): Promise<Note | null> {
  const clean = String(text || '').trim().slice(0, 1500);
  if (!clean) return null;
  const translations: Record<string, string> = {};
  const targets = [...new Set(readers.filter((r) => r && r !== lang))];
  const done = await Promise.all(targets.map((to) => translateText(clean, to, lang, fetchImpl)));
  targets.forEach((to, i) => { if (done[i]) translations[to] = done[i]!; });
  return { text: clean, lang, translations: Object.keys(translations).length ? translations : null, by, at: new Date() };
}
