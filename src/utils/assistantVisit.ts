/**
 * Logging a visit by voice (the assistant; plan in the claude.ai canvas "Voice Assistant — Log a Visit"):
 * what we ask Claude to pull out of a spoken sentence, how its answer is checked, and which question
 * comes next. Shared by the server (src/services/visitExtract.ts) and the screen. Tested in assistantVisit.test.ts.
 *
 * Claude only EXTRACTS. It never picks a customer (it hands back the name as spoken; the customer list
 * ranks the matches) and never decides what to ask next (`nextQuestion` does, so the questions are the same
 * every time). The visit is saved by the ordinary visit route after the person confirms.
 */
import { normalizeVisitDate } from './visitDates.ts';
import { visitFieldsOf, type TypeLike } from './typeLists.ts';

/** What Claude answers. Every field is required; "" means it wasn't said. */
export type SpokenVisit = {
  customerQuery: string;
  cityHint: string;
  visitType: string;
  visitDate: string;
  notes: string;
  outcome: string;
  followUp: string;
  followUpDate: string;
};

export type SpokenType = TypeLike & { name: string; label?: string };

export const EMPTY_SPOKEN_VISIT: SpokenVisit = Object.freeze({
  customerQuery: '', cityHint: '', visitType: '', visitDate: '', notes: '', outcome: '', followUp: '', followUpDate: ''
});

const activeOnly = (types: SpokenType[]) => types.filter((t) => t.active !== false);

/** The JSON schema for Claude's structured output (output_config.format). */
export function spokenVisitSchema(types: SpokenType[]) {
  const names = activeOnly(types).map((t) => t.name);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['customerQuery', 'cityHint', 'visitType', 'visitDate', 'notes', 'outcome', 'followUp', 'followUpDate'],
    properties: {
      customerQuery: { type: 'string', description: 'The customer or company as the person said it, e.g. "Smith Granite"; "" if no customer was named.' },
      cityHint: { type: 'string', description: 'A city or area said to tell two customers apart (e.g. "Kent"); "" if none was said.' },
      visitType: { type: 'string', enum: [...names, ''], description: 'The visit type only when what was said clearly fits exactly one; "" when unsure.' },
      visitDate: { type: 'string', description: 'The day the visit happened as YYYY-MM-DD ("today", "yesterday", "Tuesday" resolved from today); "" if not said.' },
      notes: { type: 'string', description: 'What happened, in the person\'s own words, tidied: no filler, no invented detail. "" if nothing was said about it.' },
      outcome: { type: 'string', description: 'The result only when the person stated one (e.g. "Wants a quote", "Not interested"); "" otherwise.' },
      followUp: { type: 'string', description: 'What to do next, only when the person said there is a follow-up (e.g. "Send quote"); "" otherwise.' },
      followUpDate: { type: 'string', description: 'The day the follow-up is due as YYYY-MM-DD, a future day resolved from today ("Friday" = the next Friday after today); "" if no day was said.' }
    }
  };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayOf = (ymd: string): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getUTCDay()];
};

/** The instruction sent with what the person said. Types are listed by stored name and label. */
export function spokenVisitPrompt(types: SpokenType[], today: string): string {
  const list = activeOnly(types).map((t) => `- ${t.name}: ${t.label || t.name}`).join('\n');
  return [
    'A field sales rep at a stone distributor spoke this out loud to log a customer visit. Pull out only what they said.',
    `Today is ${weekdayOf(today)} ${today}. "Friday" for a follow-up means the next Friday after today; "yesterday" and "Tuesday" for the visit mean the most recent such day.`,
    'Never invent anything. If a field was not said, use "". Do not infer an outcome, a follow-up or a visit type that was not clearly stated.',
    'customerQuery is only the customer\'s name as spoken (fix an obvious speech-recognition slip only if the right name is unmistakable). Do not include the city in it.',
    'notes: keep the rep\'s own facts and wording, remove "um", repeats and the instruction itself ("log a visit at…"). Do not add advice or summaries.',
    'visitType: choose from this list only when it clearly fits, else "":',
    list || '(no visit types)'
  ].join('\n');
}

const text = (v: unknown, max = 2000) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/** A visit more than this many days back is more likely misheard than real. */
export const OLDEST_VISIT_DAYS = 14;
/** A follow-up further out than this is more likely misheard than real. */
export const FURTHEST_FOLLOW_UP_DAYS = 365;

/**
 * Check Claude's answer. Anything malformed becomes blank rather than wrong: a day that isn't real (or a visit in
 * the future / over OLDEST_VISIT_DAYS back, a follow-up before today or over a year out), a type that isn't on the
 * shown list. A follow-up date with no follow-up words is kept: a date alone is still a follow-up.
 */
export function cleanSpokenVisit(raw: unknown, { types, today }: { types: SpokenType[]; today: string }): SpokenVisit {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof SpokenVisit, unknown>>;
  const shown = new Set(activeOnly(types).map((t) => t.name));
  const visitType = text(r.visitType, 200);
  const visitDay = normalizeVisitDate(text(r.visitDate, 10));
  const visitOk = !!visitDay && daysBetween(visitDay, today) >= 0 && daysBetween(visitDay, today) <= OLDEST_VISIT_DAYS;
  const followDay = normalizeVisitDate(text(r.followUpDate, 10));
  const followOk = !!followDay && daysBetween(today, followDay) >= 0 && daysBetween(today, followDay) <= FURTHEST_FOLLOW_UP_DAYS;
  return {
    customerQuery: text(r.customerQuery, 120),
    cityHint: text(r.cityHint, 60),
    visitType: shown.has(visitType) ? visitType : '',
    visitDate: visitOk ? visitDay! : '',
    notes: text(r.notes),
    outcome: text(r.outcome, 500),
    followUp: text(r.followUp, 500),
    followUpDate: followOk ? followDay! : ''
  };
}

/** True when nothing useful was heard. */
export const spokenIsEmpty = (s: SpokenVisit) => Object.values(s).every((v) => !v);

export type Question = 'customer' | 'type' | 'notes' | 'outcome' | 'followUp';

/**
 * The next thing to ask, or null when the draft is ready to confirm. Always in this order, and only for what the
 * visit type uses (Admin → Visit Types): notes and outcome when the type has them, a follow-up only when the type
 * requires one ('always'; an optional one is offered at "Anything else?", never nagged). A question the person
 * answered with "skip" is in `skipped` and is not asked again.
 */
export function nextQuestion(
  draft: { customerId?: string; visitType?: string; notes?: string; outcome?: string; followUp?: string; followUpDate?: string },
  type: SpokenType | null | undefined,
  skipped: readonly Question[] = []
): Question | null {
  if (!draft.customerId) return 'customer';
  if (!draft.visitType || !type) return 'type';
  const f = visitFieldsOf(type);
  const open = (q: Question) => !skipped.includes(q);
  if (f.notes && open('notes') && !String(draft.notes || '').trim()) return 'notes';
  if (f.outcome && open('outcome') && !String(draft.outcome || '').trim()) return 'outcome';
  if (f.followUp === 'always' && open('followUp') && !String(draft.followUp || '').trim() && !String(draft.followUpDate || '').trim()) return 'followUp';
  return null;
}

/** What the person is asked for each question. */
export const QUESTION_TEXT: Record<Question, string> = {
  customer: 'Which customer?',
  type: 'What kind of visit was it?',
  notes: 'What happened? Say the notes.',
  outcome: 'What was the outcome? Say “none” to skip.',
  followUp: 'When should you follow up, and on what?'
};
