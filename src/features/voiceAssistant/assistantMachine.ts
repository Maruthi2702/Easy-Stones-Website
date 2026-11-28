import { EMPTY_SPOKEN_VISIT, nextQuestion, QUESTION_TEXT } from '../../utils/assistantVisit';
import type { Question, SpokenType, SpokenVisit } from '../../utils/assistantVisit';
import { visitValuesToSave } from '../../utils/visitForm';
import type { LocationReading } from '../../utils/visitLocation';
import type { SoundVerdict } from '../../utils/soundAlike';

/**
 * The voice assistant's conversation as a PURE state machine (plan: docs/VOICE_ASSISTANT_PLAN.md, "The conversation" and
 * "Failure ladder"). No React, no network, no speech: the hook (useAssistant.ts) feeds it events and does what its state
 * asks (start the mic, call the server, save). Tested in assistantMachine.test.ts — every transition and every failure.
 *
 *   idle → permission → listening → thinking → pick | ask | confirm → saving → saved
 *                          └─ error (permission denied · nothing heard · turn failed) · typing · search
 *   Cancel works from every state. Nothing is saved without Save on the confirm card.
 *
 * Code decides, Claude only extracts: the customer is ranked by the hook (soundAlike) and handed in with the turn; what
 * to ask next is `nextQuestion`. A tap (customer, type, an edited field) always wins over what was heard.
 */

export type Phase =
  | 'idle' | 'permission' | 'listening' | 'thinking' | 'pick' | 'ask' | 'confirm' | 'search' | 'typing' | 'saving' | 'saved' | 'error';

export type ErrorKind = 'permission-denied' | 'nothing-heard' | 'turn-failed';
/** Why a turn failed (the server's `reason`, plus what the client adds). */
export type FailureWhy = 'empty' | 'refused' | 'unreadable' | 'failed' | 'busy' | 'limit' | 'unavailable' | 'forbidden' | 'network';

/** A customer as the assistant shows one: the name, the city, and a line of who it belongs to / which branch (for "Which one?"). */
export type Candidate = { id: string; label: string; city: string; note?: string };
export type RankLite = { verdict: SoundVerdict; candidates: Candidate[] };

export type EditableField = 'visitType' | 'visitDate' | 'notes' | 'outcome' | 'followUp' | 'followUpDate';

export interface AssistantState {
  phase: Phase;
  /** Where Back from typing / search returns to. */
  from: Phase | null;
  draft: SpokenVisit;
  /** The customer, once picked (a clear match, a tap on a card, or a search). */
  customer: Candidate | null;
  /** "Which one?" cards. */
  candidates: Candidate[];
  /** The shown visit types, in the managers' order (useVisitTypes().active). */
  types: SpokenType[];
  /** The question the mic is open for; null for the first sentence. */
  asking: Question | null;
  skipped: Question[];
  /** The words of the turn in flight / last. */
  heard: string;
  /** Every turn's words, in order — they go into the form's Notes if the assistant gives up. */
  said: string[];
  /** The live words while listening. */
  partial: string;
  mic: 'off' | 'on';
  /** What was heard when no customer fitted ('' when no name was said). */
  customerMiss: string;
  /** "Didn't catch that" retries used. */
  retries: number;
  /** `code`: what the phone's recognizer reported when the microphone failed (shown small, so a problem can be told apart). */
  error: { kind: ErrorKind; why?: FailureWhy; code?: string } | null;
  saved: { visitId: string; customerId: string; undoUntil: number } | null;
  undo: 'ready' | 'working' | 'failed' | 'expired';
  lastResult: 'saved' | 'undone' | 'save-failed' | 'cancelled' | null;
  today: string;
  /** Turns sent this session (for the limit message and the tests). */
  turns: number;
}

export const MAX_RETRIES = 2;
export const UNDO_WINDOW_MS = 10_000;
export const TYPE_CHOICES_SHOWN = 4;

export const initialState: AssistantState = Object.freeze({
  phase: 'idle', from: null, draft: { ...EMPTY_SPOKEN_VISIT }, customer: null, candidates: [], types: [], asking: null, skipped: [],
  heard: '', said: [], partial: '', mic: 'off', customerMiss: '', retries: 0, error: null, saved: null, undo: 'ready', lastResult: null,
  today: '', turns: 0
}) as AssistantState;

export type AssistantEvent =
  | { type: 'OPEN'; today: string; types: SpokenType[]; available: boolean; permission: 'granted' | 'denied' | 'undetermined' }
  | { type: 'PERMISSION_RESULT'; granted: boolean }
  | { type: 'MIC'; on: boolean }
  /** The recognizer failed while listening: `denied` = the microphone / speech permission is off. */
  | { type: 'MIC_FAILED'; denied: boolean; code?: string }
  | { type: 'PARTIAL'; text: string }
  | { type: 'DONE'; text: string }
  | { type: 'TYPE_INSTEAD' }
  | { type: 'SUBMIT_TYPED'; text: string }
  | { type: 'BACK' }
  | { type: 'TURN_OK'; draft: SpokenVisit; rank: RankLite | null }
  | { type: 'TURN_FAILED'; why: FailureWhy }
  | { type: 'PICK_CUSTOMER'; customer: Candidate }
  | { type: 'OPEN_SEARCH' }
  | { type: 'PICK_TYPE'; name: string }
  | { type: 'EDIT'; field: EditableField; value: string }
  | { type: 'SKIP' }
  | { type: 'RETRY' }
  | { type: 'SAVE'; ready: boolean }
  | { type: 'SAVE_OK'; visitId: string; customerId: string; now: number }
  | { type: 'SAVE_FAILED' }
  | { type: 'UNDO' }
  | { type: 'UNDO_OK' }
  | { type: 'UNDO_FAILED' }
  | { type: 'UNDO_EXPIRED' }
  | { type: 'ADD_ANOTHER'; today?: string }
  | { type: 'CANCEL' };

/** Said instead of an answer: "skip", "none", "nothing", "no"… — no server turn needed. */
export function isSkipWords(text: string): boolean {
  const t = String(text || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return /^(skip( it| that| this)?|none|nothing|no|nope|nah|not (really|applicable)|n a|no outcome|no follow ?up|no notes?|pass|never ?mind|thats all|nothing else)$/.test(t)
    || /^(no|none|nothing)( thanks| thank you)?$/.test(t);
}

const typeOf = (s: AssistantState): SpokenType | undefined => s.types.find((t) => t.name === s.draft.visitType);
const UNRESOLVED: Question[] = ['notes', 'outcome', 'followUp'];

/** What the draft still lacks, after a customer / type / answer changed: ask it, or go to the confirm card. */
function advance(s: AssistantState): AssistantState {
  const q = nextQuestion(
    { customerId: s.customer?.id, visitType: s.draft.visitType, notes: s.draft.notes, outcome: s.draft.outcome, followUp: s.draft.followUp, followUpDate: s.draft.followUpDate },
    typeOf(s),
    s.skipped
  );
  return {
    ...s, partial: '', mic: 'off', candidates: [], from: null, error: null,
    phase: q ? 'ask' : 'confirm', asking: q
  };
}

const listening = (s: AssistantState, asking: Question | null): AssistantState =>
  ({ ...s, phase: asking ? 'ask' : 'listening', asking, partial: '', mic: 'off', error: null, from: null });

/** The turn is sent: the words go to the server, the card shows as a skeleton. */
function sendTurn(s: AssistantState, text: string): AssistantState {
  const words = text.trim();
  return { ...s, phase: 'thinking', heard: words, said: [...s.said, words], partial: '', mic: 'off', turns: s.turns + 1, error: null, from: null };
}

const isAnswering = (s: AssistantState) => s.phase === 'listening' || s.phase === 'ask';

export function assistantReducer(s: AssistantState, e: AssistantEvent): AssistantState {
  // Cancel works from every state.
  if (e.type === 'CANCEL') return { ...initialState, lastResult: 'cancelled' };

  switch (e.type) {
    case 'OPEN': {
      if (s.phase !== 'idle') return s;
      const base: AssistantState = { ...initialState, types: e.types, today: e.today };
      // No speech plugin (a browser, an old app): the ordinary form is the only way — the screen opens it.
      if (!e.available) return { ...base, phase: 'error', error: { kind: 'turn-failed', why: 'unavailable' } };
      if (e.permission === 'denied') return { ...base, phase: 'error', error: { kind: 'permission-denied' } };
      if (e.permission === 'undetermined') return { ...base, phase: 'permission' };
      return listening(base, null);
    }
    case 'PERMISSION_RESULT': {
      if (s.phase !== 'permission') return s;
      return e.granted ? listening(s, null) : { ...s, phase: 'error', error: { kind: 'permission-denied' } };
    }
    case 'MIC':
      return isAnswering(s) ? { ...s, mic: e.on ? 'on' : 'off' } : s;
    case 'MIC_FAILED': {
      if (!isAnswering(s)) return s;
      if (e.denied) return { ...s, phase: 'error', mic: 'off', partial: '', error: { kind: 'permission-denied' } };
      return { ...s, phase: 'error', mic: 'off', partial: '', retries: s.retries + 1, error: { kind: 'nothing-heard', code: e.code || undefined } };
    }
    case 'PARTIAL':
      return isAnswering(s) ? { ...s, partial: e.text } : s;

    case 'DONE':
    case 'SUBMIT_TYPED': {
      const typing = s.phase === 'typing';
      const allowed = isAnswering(s) || typing || (e.type === 'SUBMIT_TYPED' && (s.phase === 'error' || s.phase === 'pick' || s.phase === 'permission'));
      if (!allowed) return s;
      const words = e.text.trim();
      if (!words) {
        // Nothing heard: retry twice, then the ladder offers typing / the form. An empty typed box just stays.
        if (typing) return s;
        return { ...s, phase: 'error', mic: 'off', partial: '', retries: s.retries + 1, error: { kind: 'nothing-heard' } };
      }
      // "skip" / "none" to a notes / outcome / follow-up question needs no server turn.
      if (s.asking && UNRESOLVED.includes(s.asking) && isSkipWords(words)) return advance({ ...s, skipped: [...s.skipped, s.asking] });
      return sendTurn(s, words);
    }

    case 'TYPE_INSTEAD': {
      if (!(isAnswering(s) || s.phase === 'error' || s.phase === 'pick' || s.phase === 'permission')) return s;
      return { ...s, phase: 'typing', from: s.phase, mic: 'off', partial: '' };
    }
    case 'OPEN_SEARCH': {
      if (!(isAnswering(s) || s.phase === 'pick' || s.phase === 'confirm' || s.phase === 'error' || s.phase === 'permission')) return s;
      return { ...s, phase: 'search', from: s.phase, mic: 'off', partial: '' };
    }
    case 'BACK': {
      if (s.phase !== 'typing' && s.phase !== 'search') return s;
      const back = s.from;
      if (back === 'confirm' || back === 'pick' || back === 'error' || back === 'permission') return { ...s, phase: back, from: null };
      return listening(s, back === 'ask' ? s.asking : null);
    }

    case 'TURN_OK': {
      if (s.phase !== 'thinking') return s;
      let next: AssistantState = { ...s, draft: e.draft, error: null, retries: 0 };
      // A question the answer left empty is not asked twice (notes, outcome, follow-up): the person can still fill it on the card.
      if (s.asking && UNRESOLVED.includes(s.asking)) {
        const got = s.asking === 'followUp' ? (e.draft.followUp || e.draft.followUpDate) : e.draft[s.asking as 'notes' | 'outcome'];
        if (!String(got || '').trim()) next = { ...next, skipped: [...s.skipped, s.asking] };
      }
      if (!next.customer) {
        const rank = e.rank;
        if (rank?.verdict === 'clear' && rank.candidates[0]) next = { ...next, customer: rank.candidates[0], customerMiss: '' };
        else if (rank?.verdict === 'ambiguous' && rank.candidates.length) {
          return { ...next, phase: 'pick', candidates: rank.candidates, asking: null, customerMiss: '', mic: 'off', partial: '' };
        } else {
          return { ...next, phase: 'ask', asking: 'customer', candidates: [], customerMiss: e.draft.customerQuery, mic: 'off', partial: '' };
        }
      }
      return advance(next);
    }
    case 'TURN_FAILED': {
      if (s.phase !== 'thinking') return s;
      if (e.why === 'empty' || e.why === 'unreadable') {
        return { ...s, phase: 'error', retries: s.retries + 1, error: { kind: 'nothing-heard', why: e.why } };
      }
      // The assistant can't help: the ordinary form opens with the words in Notes.
      return { ...s, phase: 'error', error: { kind: 'turn-failed', why: e.why } };
    }
    case 'RETRY': {
      if (s.phase !== 'error' || s.error?.kind === 'turn-failed' || s.error?.kind === 'permission-denied') return s;
      if (s.retries > MAX_RETRIES) return s;
      return listening(s, s.asking);
    }

    case 'PICK_CUSTOMER': {
      if (!(s.phase === 'pick' || s.phase === 'search' || s.phase === 'confirm' || s.phase === 'ask')) return s;
      return advance({ ...s, customer: e.customer, customerMiss: '' });
    }
    case 'PICK_TYPE': {
      if (!s.types.some((t) => t.name === e.name)) return s;
      if (!(s.phase === 'ask' || s.phase === 'confirm')) return s;
      return advance({ ...s, draft: { ...s.draft, visitType: e.name } });
    }
    case 'EDIT': {
      if (s.phase !== 'confirm') return s;
      if (e.field === 'visitType') {
        if (!s.types.some((t) => t.name === e.value)) return s;
        return advance({ ...s, draft: { ...s.draft, visitType: e.value } });
      }
      const draft = { ...s.draft, [e.field]: e.value.trim() } as SpokenVisit;
      // An edited follow-up needs no more asking; one cleared on the card is the person's choice.
      return { ...s, draft, skipped: e.field === 'followUp' || e.field === 'followUpDate' ? [...new Set([...s.skipped, 'followUp' as Question])] : s.skipped };
    }
    case 'SKIP': {
      if (s.phase !== 'ask' || !s.asking || !UNRESOLVED.includes(s.asking)) return s;
      return advance({ ...s, skipped: [...s.skipped, s.asking] });
    }

    case 'SAVE': {
      if (s.phase !== 'confirm' || !e.ready || !s.customer || !s.draft.visitType) return s;
      return { ...s, phase: 'saving' };
    }
    case 'SAVE_OK': {
      if (s.phase !== 'saving') return s;
      return { ...s, phase: 'saved', saved: { visitId: e.visitId, customerId: e.customerId, undoUntil: e.now + UNDO_WINDOW_MS }, undo: 'ready', lastResult: 'saved' };
    }
    case 'SAVE_FAILED': {
      // The page's own save puts the entries back in the ordinary form (its retry / reopen rule), so the sheet closes.
      if (s.phase !== 'saving') return s;
      return { ...initialState, lastResult: 'save-failed' };
    }
    case 'UNDO': {
      if (s.phase !== 'saved' || s.undo !== 'ready') return s;
      return { ...s, undo: 'working' };
    }
    case 'UNDO_OK': {
      if (s.phase !== 'saved' || s.undo !== 'working') return s;
      return { ...initialState, lastResult: 'undone' };
    }
    case 'UNDO_FAILED': {
      if (s.phase !== 'saved' || s.undo !== 'working') return s;
      return { ...s, undo: 'failed' };
    }
    case 'UNDO_EXPIRED': {
      if (s.phase !== 'saved' || s.undo !== 'ready') return s;
      return { ...s, undo: 'expired' };
    }
    case 'ADD_ANOTHER': {
      if (s.phase !== 'saved') return s;
      return listening({ ...initialState, types: s.types, today: e.today || s.today, lastResult: 'saved' }, null);
    }
    default:
      return s;
  }
}

// ─── Selectors ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The logo spins only while the assistant is working or hearing: listening, thinking, a question with the mic open, saving. */
export const isSpinning = (s: AssistantState): boolean =>
  s.phase === 'listening' || s.phase === 'thinking' || s.phase === 'saving' || (s.phase === 'ask' && s.mic === 'on');

/** The mic should be open: the first sentence, or a question being asked. */
export const wantsMic = (s: AssistantState): boolean => s.phase === 'listening' || s.phase === 'ask';

export const questionText = (s: AssistantState): string => {
  if (!s.asking) return '';
  if (s.asking === 'customer' && s.customerMiss) return 'I didn’t catch the customer';
  return QUESTION_TEXT[s.asking];
};

/** The type chips: the four the managers list first; all of them when `all`. */
export function typeChoices(s: AssistantState, all = false): SpokenType[] {
  const shown = s.types.filter((t) => t.active !== false);
  return all ? shown : shown.slice(0, TYPE_CHOICES_SHOWN);
}

/** Seconds left to undo, 0 when the window is over or undo isn't offered. */
export const undoLeftMs = (s: AssistantState, now: number): number =>
  s.phase === 'saved' && s.undo === 'ready' && s.saved ? Math.max(0, s.saved.undoUntil - now) : 0;

/** What the card shows, in order; `empty` rows read "Not mentioned". */
export type ConfirmRow = { field: 'customer' | EditableField; label: string; value: string; empty: boolean };
export function confirmRows(s: AssistantState, labelOfType: (name: string) => string, dayLabel: (iso: string) => string): ConfirmRow[] {
  const rows: ConfirmRow[] = [
    { field: 'customer', label: 'Customer', value: s.customer ? [s.customer.label, s.customer.city].filter(Boolean).join(' · ') : '', empty: !s.customer },
    { field: 'visitType', label: 'Visit type', value: s.draft.visitType ? labelOfType(s.draft.visitType) : '', empty: !s.draft.visitType },
    { field: 'visitDate', label: 'Day', value: dayLabel(s.draft.visitDate || s.today), empty: false }
  ];
  const f = typeOf(s)?.fields;
  if (!f || f.notes !== false) rows.push({ field: 'notes', label: 'Notes', value: s.draft.notes, empty: !s.draft.notes });
  if (!f || f.outcome !== false) rows.push({ field: 'outcome', label: 'Outcome', value: s.draft.outcome, empty: !s.draft.outcome });
  if (!f || f.followUp !== 'none') {
    const value = [s.draft.followUp, s.draft.followUpDate ? dayLabel(s.draft.followUpDate) : ''].filter(Boolean).join(' · ');
    rows.push({ field: 'followUp', label: 'Follow-up', value, empty: !value });
  }
  return rows;
}

/** Save is allowed on the confirm card with a customer, a type and (the caller says) a location reading. */
export const canSave = (s: AssistantState, locationReady: boolean): boolean =>
  s.phase === 'confirm' && Boolean(s.customer) && Boolean(s.draft.visitType) && locationReady;

/** What the page's visit save is given — the Add visit form's own values, plus the reading and `byVoice`. */
export function saveValues(s: AssistantState, reading: LocationReading | null): Record<string, unknown> {
  const d = s.draft;
  const followUpOn = Boolean(d.followUp || d.followUpDate);
  const base = {
    customerId: s.customer?.id || '',
    date: d.visitDate || s.today,
    purpose: d.visitType,
    notes: d.notes,
    outcome: d.outcome,
    followUp: d.followUp,
    followUpDate: d.followUpDate,
    image: [] as string[]
  };
  return { ...visitValuesToSave(base, typeOf(s) || null, followUpOn), loggedFrom: reading, byVoice: true };
}

/** What the ordinary Add visit form opens with when the assistant gives up: the rep's own words in Notes (theirs to keep). */
export type FormPrefill = { customerId: string; purpose: string; date: string; notes: string; outcome: string; followUp: string; followUpDate: string };
export function formPrefill(s: AssistantState): FormPrefill {
  const d = s.draft;
  return {
    customerId: s.customer?.id || '',
    purpose: d.visitType,
    date: d.visitDate || s.today,
    notes: d.notes || s.said.join('\n'),
    outcome: d.outcome,
    followUp: d.followUp,
    followUpDate: d.followUpDate
  };
}

/** Should the screen offer "Say it again"? Not after the retries are used up. */
export const canRetry = (s: AssistantState): boolean => s.phase === 'error' && s.error?.kind === 'nothing-heard' && s.retries <= MAX_RETRIES;
/** Is the assistant out of road: the form (with the words) is the only way left? */
export const mustOpenForm = (s: AssistantState): boolean =>
  s.phase === 'error' && (s.error?.kind === 'turn-failed' || (s.error?.kind === 'nothing-heard' && s.retries > MAX_RETRIES));
