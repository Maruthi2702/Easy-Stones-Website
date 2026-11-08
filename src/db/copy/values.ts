/**
 * Turning MongoDB's stored values into Postgres column values for the copy
 * (src/db/README.md). Every converter either returns a clean value or records
 * a problem — nothing is silently guessed or dropped.
 *
 * What MongoDB holds today (read 2026-11-08):
 * - days: 'YYYY-MM-DD' strings, '' or null for none, and a few real Dates at
 *   midnight UTC (visit follow-up dates saved by an older form);
 * - local clock times: '2026-10-23T14:05:00.000' (no zone — the writer's own
 *   clock), a few Date.toString() strings ('Thu Oct 23 2026 14:05:00 GMT-0700
 *   (Pacific Daylight Time)'), and some real Dates (schedules, the activity log).
 */

/** One value the copy couldn't take as it was: what, where, and what it did instead. */
export interface CopyProblem {
  table: string;
  id: string;
  field: string;
  reason: string;
  /** skipped = row not copied; blanked = copied with this field empty; converted = rewritten by a rule; kept = copied as is, flagged. */
  outcome: 'skipped' | 'blanked' | 'converted' | 'kept';
}

const HEX24 = /^[0-9a-f]{24}$/i;

/** A record id as 24 lowercase hex characters, or null when it isn't one. */
export function idOf(value: unknown): string | null {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : typeof (value as { toHexString?: unknown }).toHexString === 'function'
    ? (value as { toHexString(): string }).toHexString() : String(value);
  return HEX24.test(s) ? s.toLowerCase() : null;
}

/** When an ObjectId was made (its first 8 hex digits are Unix seconds). */
export function idTime(value: unknown): Date {
  const id = idOf(value);
  return new Date(id ? parseInt(id.slice(0, 8), 16) * 1000 : 0);
}

/** A blank-able text field: strings as they are, null / missing → ''. */
export const textOf = (value: unknown): string => value == null ? '' : String(value);

/** A real calendar day? ('2026-02-30' is not.) */
export function isRealDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** The wall clock in `zone` at an instant, as 'YYYY-MM-DD HH:MM:SS.mmm'. */
export function wallClockIn(at: Date, zone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(at).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${pad(at.getUTCMilliseconds(), 3)}`;
}

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const LOCAL_ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const ZONED_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const DATE_TO_STRING = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT[+-]\d{4}/;

type Result<T> = { ok: true; value: T; converted?: string } | { ok: false; reason: string };

/** A day column: 'YYYY-MM-DD' or null. A Date counts only at midnight UTC (how older forms saved a day). */
export function toDay(value: unknown, zone: string): Result<string | null> {
  if (value == null || value === '') return { ok: true, value: null };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { ok: false, reason: 'invalid date' };
    const iso = value.toISOString();
    if (iso.endsWith('T00:00:00.000Z')) return { ok: true, value: iso.slice(0, 10), converted: 'date stored as midnight UTC' };
    return { ok: true, value: wallClockIn(value, zone).slice(0, 10), converted: `date with a time, read on ${zone}` };
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (isRealDay(s)) return { ok: true, value: s };
    const local = LOCAL_ISO.exec(s);
    if (local && isRealDay(local[1])) return { ok: true, value: local[1], converted: 'time dropped from a day' };
    return { ok: false, reason: `not a day: ${shape(s)}` };
  }
  return { ok: false, reason: `not a day: ${typeof value}` };
}

/**
 * A local clock time column ('YYYY-MM-DD HH:MM:SS.mmm' or null). Local
 * strings are kept exactly as written; an instant (a Date, or text with a zone)
 * is read on `zone` — the clock of the branch it belongs to.
 */
export function toLocalTime(value: unknown, zone: string): Result<string | null> {
  if (value == null || value === '') return { ok: true, value: null };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { ok: false, reason: 'invalid date' };
    return { ok: true, value: wallClockIn(value, zone), converted: `instant read on ${zone}` };
  }
  if (typeof value !== 'string') return { ok: false, reason: `not a time: ${typeof value}` };
  const s = value.trim();
  const local = LOCAL_ISO.exec(s);
  if (local) {
    // An older formatter (hour12: false) wrote the hour after midnight as 24 on the same day.
    const midnightAs24 = local[2] === '24';
    const hour = midnightAs24 ? '00' : local[2];
    if (!isRealDay(local[1]) || Number(hour) > 23 || Number(local[3]) > 59 || Number(local[4] || 0) > 59) {
      return { ok: false, reason: `not a real time: ${shape(s)}` };
    }
    const value = `${local[1]} ${hour}:${local[3]}:${local[4] || '00'}.${(local[5] || '0').padEnd(3, '0')}`;
    return midnightAs24 ? { ok: true, value, converted: 'hour 24 read as 00 on the same day' } : { ok: true, value };
  }
  if (ZONED_ISO.test(s)) {
    const at = new Date(s);
    if (!Number.isNaN(at.getTime())) return { ok: true, value: wallClockIn(at, zone), converted: `instant read on ${zone}` };
  }
  const old = DATE_TO_STRING.exec(s);
  if (old && MONTHS[old[1]]) {
    const dayPart = `${old[3]}-${pad(MONTHS[old[1]])}-${old[2]}`;
    if (isRealDay(dayPart)) return { ok: true, value: `${dayPart} ${old[4]}:${old[5]}:${old[6]}.000`, converted: 'Date.toString() text, its own clock kept' };
  }
  if (isRealDay(s)) return { ok: true, value: `${s} 00:00:00.000`, converted: 'day without a time' };
  return { ok: false, reason: `not a time: ${shape(s)}` };
}

/** A real moment (timestamptz): Dates and ISO text with a zone. */
export function toMoment(value: unknown): Result<Date | null> {
  if (value == null || value === '') return { ok: true, value: null };
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? { ok: false, reason: 'invalid date' } : { ok: true, value };
  if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value: new Date(value), converted: 'epoch milliseconds' };
  if (typeof value === 'string' && ZONED_ISO.test(value.trim())) return { ok: true, value: new Date(value.trim()) };
  return { ok: false, reason: `not a moment: ${typeof value === 'string' ? shape(value) : typeof value}` };
}

/** A value's shape without its content, for problem reports (digits → 9, letters → a). */
export function shape(s: string): string {
  return s.replace(/[0-9]/g, '9').replace(/[A-Za-z]+/g, 'a').slice(0, 40);
}

/**
 * Converters bound to one row, recording problems as they go. A failed
 * conversion blanks the field (null) and says so; a rule-based one is noted
 * once per field so the report can count them.
 */
export function rowConverter(problems: CopyProblem[], table: string, id: string) {
  const note = <T>(field: string, r: Result<T>, fallback: T): T => {
    if (!r.ok) { problems.push({ table, id, field, reason: r.reason, outcome: 'blanked' }); return fallback; }
    if (r.converted) problems.push({ table, id, field, reason: r.converted, outcome: 'converted' });
    return r.value;
  };
  return {
    day: (field: string, v: unknown, zone: string) => note(field, toDay(v, zone), null),
    localTime: (field: string, v: unknown, zone: string) => note(field, toLocalTime(v, zone), null),
    moment: (field: string, v: unknown) => note(field, toMoment(v), null),
    problem: (field: string, reason: string, outcome: CopyProblem['outcome']) => problems.push({ table, id, field, reason, outcome })
  };
}
