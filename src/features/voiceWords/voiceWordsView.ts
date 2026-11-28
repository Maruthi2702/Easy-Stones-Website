import type { UsageResponse, VoiceWord, VoiceWordInput, VoiceWordKind } from '../../utils/assistantContract';

/** Admin → Voice Assistant → Words and Usage: the screen's pure rules (tested in voiceWordsView.test.ts). */

export const KIND_LABELS: Record<VoiceWordKind, string> = {
  stone: 'Stone', brand: 'Brand', branch: 'Branch', business: 'Business', slang: 'Slang', customer: 'Customer', other: 'Other'
};
export const KIND_ORDER: VoiceWordKind[] = ['stone', 'brand', 'branch', 'business', 'slang', 'customer', 'other'];
export const KIND_OPTIONS = KIND_ORDER.map((value) => ({ value, label: KIND_LABELS[value] }));

/** Limits the form and the paste check apply (a screen default; the server is the real check). */
export const WORD_MAX = 80;
export const NOTE_MAX = 200;

export const isKind = (value: unknown): value is VoiceWordKind => KIND_ORDER.includes(value as VoiceWordKind);

export type StatusFilter = 'all' | 'active' | 'hidden';
export type WordFilters = { query: string; kind: VoiceWordKind | 'all'; status: StatusFilter };
export const NO_FILTERS: WordFilters = { query: '', kind: 'all', status: 'active' };

const norm = (s: string) => s.trim().toLowerCase();

const matchesQuery = (w: VoiceWord, q: string) => !q || `${w.meant} ${w.heard} ${w.note} ${KIND_LABELS[w.kind] || ''}`.toLowerCase().includes(q);
const matchesStatus = (w: VoiceWord, status: StatusFilter) => status === 'all' || (status === 'active' ? w.active : !w.active);

/** The words that match the search, kind and Active / Hidden choice, A–Z by what they should be. */
export function filterWords(words: VoiceWord[], filters: WordFilters): VoiceWord[] {
  const q = norm(filters.query);
  return words
    .filter((w) => matchesQuery(w, q) && matchesStatus(w, filters.status) && (filters.kind === 'all' || w.kind === filters.kind))
    .sort((a, b) => a.meant.localeCompare(b.meant, undefined, { sensitivity: 'base' }) || a.heard.localeCompare(b.heard));
}

/** How many words each kind would show under the current search and Active / Hidden choice ("all" is the total). */
export function kindCounts(words: VoiceWord[], filters: Pick<WordFilters, 'query' | 'status'>): Record<VoiceWordKind | 'all', number> {
  const q = norm(filters.query);
  const counts = { all: 0, stone: 0, brand: 0, branch: 0, business: 0, slang: 0, customer: 0, other: 0 } as Record<VoiceWordKind | 'all', number>;
  for (const w of words) {
    if (!matchesQuery(w, q) || !matchesStatus(w, filters.status)) continue;
    counts.all += 1;
    if (isKind(w.kind)) counts[w.kind] += 1;
  }
  return counts;
}

export const statusCounts = (words: VoiceWord[]) => ({ active: words.filter((w) => w.active).length, hidden: words.filter((w) => !w.active).length });

/** What a row says under its name: "heard as “cala cotta”" or "Plain word". */
export const heardLine = (w: Pick<VoiceWord, 'heard'>): string => (w.heard ? `Heard as “${w.heard}”` : 'Plain word — only a hint');

export const EMPTY_LINE = 'The voice words teach the assistant our stone names, brands and slang, so what a rep says is understood the way they meant it.';

// ─── The form ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type WordFormValues = { meant: string; heard: string; kind: VoiceWordKind; note: string };
export type WordFormErrors = Partial<Record<'meant' | 'heard' | 'note', string>>;

export function wordFormErrors(v: WordFormValues): WordFormErrors {
  const meant = v.meant.trim(), heard = v.heard.trim();
  const errors: WordFormErrors = {};
  if (!meant) errors.meant = 'Enter the word';
  else if (meant.length > WORD_MAX) errors.meant = `At most ${WORD_MAX} characters`;
  if (heard.length > WORD_MAX) errors.heard = `At most ${WORD_MAX} characters`;
  else if (heard && meant && norm(heard) === norm(meant)) errors.heard = 'Same as the word — leave it empty for a plain word';
  if (v.note.trim().length > NOTE_MAX) errors.note = `At most ${NOTE_MAX} characters`;
  return errors;
}

export const wordInput = (v: WordFormValues): VoiceWordInput => ({ meant: v.meant.trim(), heard: v.heard.trim(), kind: v.kind, note: v.note.trim() });

/** Fields that differ from the saved word (the edit form's change count). */
export function changedFields(v: WordFormValues, word: VoiceWord): Partial<VoiceWordInput> {
  const input = wordInput(v);
  const patch: Partial<VoiceWordInput> = {};
  if (input.meant !== word.meant) patch.meant = input.meant;
  if (input.heard !== word.heard) patch.heard = input.heard;
  if (input.kind !== word.kind) patch.kind = input.kind;
  if ((input.note || '') !== (word.note || '')) patch.note = input.note;
  return patch;
}

// ─── Paste a list ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type PasteStatus = 'new' | 'exists' | 'repeat' | 'invalid';
export type PasteRow = { line: number; heard: string; meant: string; kind: VoiceWordKind; status: PasteStatus; problem: string };

/** `heard = meant` — also with =>, ->, →, ⇒, a tab or a bar. The first separator splits; the rest belongs to the word. */
const SEPARATOR = /\s*(?:=>|->|→|⇒|=+|\t|\|)\s*/;
const BULLET = /^\s*(?:[-*•·–—]|\d+[.)])\s+/;
const QUOTES = /^[\s"'“”‘’«»]+|[\s"'“”‘’«»]+$/g;
const clean = (s: string) => s.replace(QUOTES, '').replace(/\s+/g, ' ').trim();

/** The key a word is unique by: its `heard` when it has one, else the plain word itself (the server's unique rule is on `heard`). */
export const wordKey = (w: { heard: string; meant: string }): string => (w.heard.trim() ? `h:${norm(w.heard)}` : `m:${norm(w.meant)}`);

/**
 * Reads a pasted list, one per line. Blank lines and lines starting with # are skipped. Every row says whether it will be added (`new`),
 * is already in the list (`exists`), repeats an earlier line (`repeat`) or can't be used (`invalid`, with the reason).
 */
export function parsePastedList(text: string, existing: Pick<VoiceWord, 'heard' | 'meant'>[] = [], kind: VoiceWordKind = 'other'): PasteRow[] {
  const have = new Set(existing.map(wordKey));
  const seen = new Set<string>();
  const rows: PasteRow[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = raw.replace(BULLET, '').trim();
    if (!line || line.startsWith('#')) return;
    const at = line.search(SEPARATOR);
    let heard = '', meant = line;
    if (at >= 0) {
      const sep = line.match(SEPARATOR) as RegExpMatchArray;
      heard = line.slice(0, at);
      meant = line.slice(at + sep[0].length);
    }
    heard = clean(heard); meant = clean(meant);
    const row: PasteRow = { line: index + 1, heard, meant, kind, status: 'new', problem: '' };
    if (!meant) { row.status = 'invalid'; row.problem = 'Nothing after the separator'; }
    else if (meant.length > WORD_MAX || heard.length > WORD_MAX) { row.status = 'invalid'; row.problem = `Longer than ${WORD_MAX} characters`; }
    else if (heard && norm(heard) === norm(meant)) { row.status = 'invalid'; row.problem = 'Heard and meant are the same'; }
    else {
      const key = wordKey(row);
      if (have.has(key)) { row.status = 'exists'; row.problem = 'Already in the list'; }
      else if (seen.has(key)) { row.status = 'repeat'; row.problem = 'Repeats an earlier line'; }
      seen.add(key);
    }
    rows.push(row);
  });
  return rows;
}

export const pasteSummary = (rows: PasteRow[]) => ({
  add: rows.filter((r) => r.status === 'new').length,
  skip: rows.filter((r) => r.status === 'exists' || r.status === 'repeat').length,
  invalid: rows.filter((r) => r.status === 'invalid').length
});

export const PASTE_STATUS_LABEL: Record<PasteStatus, string> = { new: 'Will be added', exists: 'Already there', repeat: 'Repeat', invalid: 'Can’t use' };

// ─── Usage ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const formatCost = (usd: number): string => {
  const n = Number(usd) || 0;
  if (n <= 0) return '$0.00';
  return n >= 1 ? `$${n.toFixed(2)}` : n < 0.001 ? '<$0.001' : `$${n.toFixed(3)}`;
};

export const formatCount = (n: number): string => (Number(n) || 0).toLocaleString('en-US');

/** 1,234 stays whole; a million or more reads 1.2M. */
export const formatTokens = (n: number): string => {
  const v = Number(n) || 0;
  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : formatCount(v);
};

/** failed / turns as "2.5%", or "—" with no turns. */
export const failRate = (failed: number, turns: number): string => {
  if (!turns) return '—';
  const pct = (failed / turns) * 100;
  return `${pct >= 10 || Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`;
};

/** Busiest first, then A–Z. */
export const sortPeople = (people: UsageResponse['people']): UsageResponse['people'] =>
  [...people].sort((a, b) => b.turns - a.turns || a.name.localeCompare(b.name));

export const currentMonth = (now: Date = new Date()): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
