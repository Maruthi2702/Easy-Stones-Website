/**
 * Scoring for the speech test: how close what the phone heard is to the sentence that was read, and whether each
 * hard word (stone name, brand, jargon) came through. Pure functions so they can be tested without a phone.
 */

/** Lower-case, punctuation gone, numbers kept, single spaces. "Calacatta-Gold," → "calacatta gold". */
export const normalize = (s: string): string =>
  String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Same, with every space removed — so "calacatta gold" and "calacattagold" (or "tabletop" and "table top") compare equal. */
export const compact = (s: string): string => normalize(s).replace(/ /g, '');

const editDistance = <T,>(a: T[], b: T[]): number => {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag : 1 + Math.min(diag, prev[j], prev[j - 1]);
      diag = up;
    }
  }
  return prev[b.length];
};

/** Word error rate: word edits needed to turn what was heard into what was said, over the words said. 0 = perfect. */
export const wordErrorRate = (expected: string, heard: string): number => {
  const e = normalize(expected).split(' ').filter(Boolean);
  const h = normalize(heard).split(' ').filter(Boolean);
  if (!e.length) return h.length ? 1 : 0;
  return editDistance(e, h) / e.length;
};

/**
 * What the phone has heard so far. iOS reports speech in CHUNKS: after a pause it marks the chunk it was on as final and the next
 * results start again from nothing (the library's own docs: "you'll need to concatenate previous final results"). Showing only the
 * newest report therefore threw away everything before the last pause, and an empty closing report wiped the lot (2026-11-28).
 * `committed` holds the finished chunks; `current` is the chunk still being spoken (it may be revised until it is final).
 */
export type HeardState = { committed: string; current: string };
export const emptyHeard: HeardState = { committed: '', current: '' };

const joinWords = (a: string, b: string): string => [a.trim(), b.trim()].filter(Boolean).join(' ');

/** Fold one report from the recognizer in. A report with no words changes nothing; a final one finishes the current chunk. */
export const addResult = (state: HeardState, transcript: string | undefined | null, isFinal: boolean): HeardState => {
  const words = (transcript || '').trim();
  if (!words) return state;
  return isFinal ? { committed: joinWords(state.committed, words), current: '' } : { committed: state.committed, current: words };
};

/** Everything heard so far, finished chunks first. */
export const heardText = (state: HeardState): string => joinWords(state.committed, state.current);

export type TermState = 'exact' | 'close' | 'missed';
export type TermResult = { term: string; state: TermState; heardAs?: string };

/**
 * Did a hard word come through? `exact`: it is in the heard text (spaces ignored). `close`: some stretch of the heard text
 * is within a couple of letters ("calacota" for "calacatta") — the kind of slip Claude or a name match can still repair.
 * `missed`: nothing like it, so `heardAs` shows the nearest stretch to see what the phone made of it.
 */
export const termResult = (term: string, heard: string): TermResult => {
  const want = compact(term);
  if (!want) return { term, state: 'exact' };
  const words = normalize(heard).split(' ').filter(Boolean);
  const all = words.join('');
  if (all.includes(want)) return { term, state: 'exact' };
  const span = term.trim().split(/\s+/).length;
  let best = { d: Infinity, text: '' };
  for (let n = Math.max(1, span - 1); n <= span + 1; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const text = words.slice(i, i + n).join('');
      const d = editDistance([...text], [...want]);
      if (d < best.d) best = { d, text: words.slice(i, i + n).join(' ') };
    }
  }
  const allowed = want.length <= 5 ? 1 : want.length <= 9 ? 2 : 3;
  if (best.d <= allowed) return { term, state: 'close', heardAs: best.text };
  return { term, state: 'missed', heardAs: best.text || undefined };
};

export type Attempt = {
  id: string;
  /** Which settings it ran with, e.g. "hints + on-device". */
  config: string;
  expected: string;
  heard: string;
  wer: number;
  terms: TermResult[];
  /** Seconds from "Done" to the final words, when known. */
  settleMs?: number;
};

export const scoreAttempt = (a: { id: string; config: string; expected: string; heard: string; terms: string[]; settleMs?: number }): Attempt => ({
  id: a.id,
  config: a.config,
  expected: a.expected,
  heard: a.heard,
  wer: wordErrorRate(a.expected, a.heard),
  terms: a.terms.map((t) => termResult(t, a.heard)),
  settleMs: a.settleMs
});

export type ConfigSummary = { config: string; sentences: number; avgWer: number; terms: number; exact: number; close: number; missed: number };

/** One line of numbers per settings choice, so "hints" and "no hints" can be put side by side. */
export const summarize = (attempts: Attempt[]): ConfigSummary[] => {
  const by = new Map<string, Attempt[]>();
  for (const a of attempts) by.set(a.config, [...(by.get(a.config) || []), a]);
  return [...by.entries()].map(([config, list]) => {
    const all = list.flatMap((a) => a.terms);
    return {
      config,
      sentences: list.length,
      avgWer: list.reduce((n, a) => n + a.wer, 0) / list.length,
      terms: all.length,
      exact: all.filter((t) => t.state === 'exact').length,
      close: all.filter((t) => t.state === 'close').length,
      missed: all.filter((t) => t.state === 'missed').length
    };
  });
};

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');

/** What the person shares back: totals per setting, then every sentence with what was heard and which words slipped. */
export const reportText = (attempts: Attempt[], meta: { device: string; onDeviceSupported: boolean; when: string }): string => {
  const lines: string[] = [];
  lines.push(`Speech test · ${meta.when} · ${meta.device} · on-device supported: ${meta.onDeviceSupported ? 'yes' : 'no'}`);
  lines.push('');
  for (const s of summarize(attempts)) {
    lines.push(`${s.config}: ${s.sentences} sentences · word errors ${Math.round(s.avgWer * 100)}% · hard words exact ${pct(s.exact, s.terms)}, close ${pct(s.close, s.terms)}, missed ${pct(s.missed, s.terms)} (${s.terms} words)`);
  }
  lines.push('');
  for (const a of attempts) {
    lines.push(`[${a.config}] ${a.id}`);
    lines.push(`  said:  ${a.expected}`);
    lines.push(`  heard: ${a.heard || '(nothing)'}`);
    const slips = a.terms.filter((t) => t.state !== 'exact');
    if (slips.length) lines.push(`  slips: ${slips.map((t) => `${t.term} → ${t.heardAs || '?'} (${t.state})`).join('; ')}`);
  }
  return lines.join('\n');
};
