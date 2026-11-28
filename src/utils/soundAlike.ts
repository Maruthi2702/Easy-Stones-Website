/**
 * Finding a customer by how a name SOUNDS as well as how it is spelled (voice assistant, plan:
 * docs/VOICE_ASSISTANT_PLAN.md "Getting the words right", layer 3). A rep says "Cascade Fab" or "smith grant it" and the
 * phone writes down whatever it heard; this ranks the shared customer list (`useCustomerOptions`) against those words.
 *
 * Pure and tested (soundAlike.test.ts). The ranking never picks for the person: it answers `clear` (one match well
 * ahead), `ambiguous` (several fit — two "Smith Granite" in different cities, shown with their city) or `none`, and the
 * screen asks when it isn't clear. Claude never sees the customer list.
 *
 * What it tolerates: capitals, punctuation, diacritics ("Café"), "&" for "and", noise like Inc / LLC / The, plural
 * "s", word order, a word cut short ("Fab" for "Fabrication"), a run-together or split name ("grant it" for
 * "Granite") and spellings that sound alike ("Smyth" for "Smith", "Cala cotta" for "Calacatta").
 */

/** The customer fields the ranking reads (a `CustomerOption` has them all). */
export type SoundCandidate = { value: string; label: string; city?: string };

export type SoundMatch<T extends SoundCandidate = SoundCandidate> = {
  option: T;
  /** 0..~1.15. Over 1 only for an exact name whose city also matched the hint; show `Math.min(1, score)`. */
  score: number;
  /** The name is the same after normalising (case, punctuation, Inc / LLC, "&"). */
  exact: boolean;
  /** The spoken city hint matched this customer's city. */
  cityMatch: boolean;
};

export type SoundVerdict = 'clear' | 'ambiguous' | 'none';

export type SoundResult<T extends SoundCandidate = SoundCandidate> = {
  verdict: SoundVerdict;
  /** Every match at or above MIN_SCORE, best first, at most `limit`. */
  matches: SoundMatch<T>[];
  /** What to show: the one match when clear, the ones close to the best when ambiguous, [] when none. */
  candidates: SoundMatch<T>[];
};

/** Below this a customer isn't a match at all. */
export const MIN_SCORE = 0.62;
/** A single match must reach this to be taken without asking. */
export const CLEAR_SCORE = 0.8;
/** …and be this far ahead of the next one. */
export const CLEAR_GAP = 0.12;
/** At most this many cards in "Which one?". */
export const MAX_CANDIDATES = 5;
const CITY_BOOST = 0.15;

const NOISE = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'co', 'corp', 'corporation', 'company', 'the', 'of', 'and', 'a', 'at', 'for', 'dba'
]);

/** Lower case, no accents, "&" as "and", letters and digits only, single spaces. */
export function normalizeName(input: string): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The words that carry the name: noise words (Inc, LLC, The, and…) dropped — kept when nothing else is left. */
export function nameTokens(input: string): string[] {
  const all = normalizeName(input).split(' ').filter(Boolean);
  const kept = all.filter((t) => !NOISE.has(t));
  return kept.length ? kept : all;
}

/** A word without a plural "s" (kitchens → kitchen, glass stays glass). */
const stem = (w: string): string => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/**
 * A rough "how it sounds" key: vowels and silent letters drop out, letters that sound alike merge
 * (c/k/q, s/z, f/v/ph, t/d, p/b, g/k, sh/ch…), repeats collapse. "Granite" and "grant it" → "krnt".
 */
export function phoneticKey(input: string): string {
  let w = normalizeName(input).replace(/ /g, '');
  if (!w) return '';
  w = w
    .replace(/^(kn|gn|pn)/, 'n').replace(/^wr/, 'r').replace(/^wh/, 'w').replace(/^x/, 's').replace(/^ps/, 's')
    .replace(/sch/g, 'sk').replace(/tch/g, 'x').replace(/dge/g, 'je').replace(/ck/g, 'k')
    .replace(/sh|ch/g, 'x').replace(/th/g, 't').replace(/ph/g, 'f')
    .replace(/gh(?=t)/g, '').replace(/gh$/, '').replace(/gh/g, 'g')
    .replace(/qu/g, 'kw').replace(/q/g, 'k').replace(/x(?=.)/g, 'x')
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/g(?=[eiy])/g, 'j')
    .replace(/z/g, 's').replace(/v/g, 'f');
  const first = w[0];
  const rest = w.slice(1).replace(/[aeiouyhw]/g, '');
  const head = /[aeiouy]/.test(first) ? 'a' : first === 'h' ? '' : first;
  const merge: Record<string, string> = { b: 'p', d: 't', g: 'k', j: 'x' };
  const mapped = (head + rest).split('').map((ch) => merge[ch] ?? ch).join('');
  return mapped.replace(/(.)\1+/g, '$1');
}

/** Edit distance, two rows. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
const similarity = (a: string, b: string): number => (a || b ? 1 - distance(a, b) / Math.max(a.length, b.length) : 1);

/** How well one spoken word fits one name word, 0..1. */
function wordScore(spoken: string, name: string): number {
  if (spoken === name) return 1;
  if (stem(spoken) === stem(name)) return 0.97;
  const sk = phoneticKey(spoken);
  const nk = phoneticKey(name);
  if (sk.length >= 2 && sk === nk) return 0.9;
  // A word cut short ("fab" for "fabrication") — either way round.
  const short = spoken.length <= name.length ? spoken : name;
  const long = spoken.length <= name.length ? name : spoken;
  if (short.length >= 3 && long.startsWith(short)) return 0.85;
  if (sk.length >= 3 && nk.length >= 3 && (nk.startsWith(sk) || sk.startsWith(nk)) && Math.min(sk.length, nk.length) >= 3) return 0.8;
  const raw = similarity(spoken, name);
  if (Math.min(spoken.length, name.length) >= 4 && raw >= 0.8) return raw * 0.9;
  const sound = similarity(sk, nk);
  if (Math.min(sk.length, nk.length) >= 4 && sound >= 0.75) return 0.5 + sound * 0.35;
  return 0;
}

/** Word by word: each spoken word takes its best still-unused name word. Extra name words cost a little. */
function tokenScore(spoken: string[], name: string[]): number {
  if (!spoken.length || !name.length) return 0;
  const used = new Set<number>();
  let total = 0;
  let strong = 0;
  for (const s of spoken) {
    let best = 0;
    let at = -1;
    name.forEach((n, i) => {
      if (used.has(i)) return;
      const v = wordScore(s, n);
      if (v > best) { best = v; at = i; }
    });
    if (at >= 0 && best > 0) { used.add(at); if (best >= 0.8) strong += 1; }
    total += best;
  }
  const average = total / spoken.length;
  const coverage = strong / name.length;
  return average * (0.75 + 0.25 * Math.min(1, coverage));
}

type Prepared = { exactKey: string; tokens: string[]; joinedKey: string; cityKey: string };
const squash = (s: string) => s.replace(/ /g, '');
const prepared = new WeakMap<object, Prepared>();
function prepare(option: SoundCandidate): Prepared {
  let p = prepared.get(option);
  if (!p || p.exactKey !== normalizeName(option.label)) {
    const tokens = nameTokens(option.label);
    p = { exactKey: normalizeName(option.label), tokens, joinedKey: phoneticKey(tokens.join('')), cityKey: normalizeName(option.city || '') };
    prepared.set(option, p);
  }
  return p;
}

/** Does the spoken city ("Kent") fit this customer's city ("Kent", "Kent WA", "Kennt")? */
function cityFits(hint: string, cityKey: string): boolean {
  if (!hint || !cityKey) return false;
  if (hint === cityKey || cityKey.startsWith(hint) || hint.startsWith(cityKey)) return true;
  const a = phoneticKey(hint);
  const b = phoneticKey(cityKey);
  return a.length >= 2 && (a === b || (Math.min(a.length, b.length) >= 4 && similarity(a, b) >= 0.8));
}

/**
 * Rank `options` for a spoken customer name (and an optional spoken city). See the file's header for what it tolerates.
 * `limit` caps `matches`; `candidates` is at most MAX_CANDIDATES.
 */
export function rankBySound<T extends SoundCandidate>(options: readonly T[] | null | undefined, spoken: string, cityHint = '', limit = 8): SoundResult<T> {
  const none: SoundResult<T> = { verdict: 'none', matches: [], candidates: [] };
  const spokenKey = normalizeName(spoken);
  const spokenTokens = nameTokens(spoken);
  if (!spokenKey || !spokenTokens.length || !options?.length) return none;
  const spokenJoined = phoneticKey(spokenTokens.join(''));
  const hint = normalizeName(cityHint);

  const scored: SoundMatch<T>[] = [];
  for (const option of options) {
    const p = prepare(option);
    if (!p.tokens.length) continue;
    const exact = squash(p.exactKey) === squash(spokenKey) || squash(p.tokens.join(' ')) === squash(spokenTokens.join(' '));
    let score = exact ? 1 : tokenScore(spokenTokens, p.tokens);
    // "grant it" for "Granite": the run-together sound, whatever the word breaks.
    if (!exact && spokenJoined.length >= 3 && spokenJoined === p.joinedKey) score = Math.max(score, 0.93);
    if (score < MIN_SCORE) continue;
    const cityMatch = cityFits(hint, p.cityKey);
    if (cityMatch) score += CITY_BOOST;
    scored.push({ option, score, exact, cityMatch });
  }
  if (!scored.length) return none;
  scored.sort((a, b) => b.score - a.score || a.option.label.localeCompare(b.option.label));
  const matches = scored.slice(0, limit);
  const [top, second] = scored;

  // Exactly one customer is called exactly that: no need to ask.
  const exacts = scored.filter((m) => m.exact);
  if (exacts.length === 1) return { verdict: 'clear', matches, candidates: [exacts[0]] };
  if (exacts.length > 1) {
    const inCity = exacts.filter((m) => m.cityMatch);
    if (hint && inCity.length === 1) return { verdict: 'clear', matches, candidates: [inCity[0]] };
    return { verdict: 'ambiguous', matches, candidates: exacts.slice(0, MAX_CANDIDATES) };
  }
  // A word or two that fits only a small part of a long name ("Marble" for "O'Brien Marble Works") is shown for a tap, not taken.
  const wholeEnough = spokenTokens.length * 2 >= prepare(top.option).tokens.length || top.score >= 0.9;
  if (top.score >= CLEAR_SCORE && wholeEnough && (!second || top.score - second.score >= CLEAR_GAP)) {
    return { verdict: 'clear', matches, candidates: [top] };
  }
  const near = scored.filter((m) => top.score - m.score < CLEAR_GAP || m.score >= CLEAR_SCORE).slice(0, MAX_CANDIDATES);
  return { verdict: 'ambiguous', matches, candidates: near.length ? near : [top] };
}
