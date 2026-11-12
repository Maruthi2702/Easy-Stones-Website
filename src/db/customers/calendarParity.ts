/** Source-proven clock conversions for read-only calendar comparisons. No runtime read rules live here. */
import { branchZone } from '../../config/branches.ts';
import { toLocalTime } from '../copy/values.ts';
import type { Loose } from '../../types/records.ts';
import type { Difference } from './parity.ts';

type ClockField = 'startTime' | 'endTime';
export interface CalendarClockFact {
  /** The only spellings MongoDB can return for this exact saved value (hydrated or lean). */
  mongoValues: ReadonlySet<string>;
  /** The copy's exact local clock, in the app's three-digit-millisecond spelling. */
  expected: string | null;
  normalized: boolean;
}
export interface CalendarScheduleFact {
  zone: string;
  sourceStartKey: string;
  startTime: CalendarClockFact;
  endTime: CalendarClockFact;
  sourceMissing: boolean;
}
export interface CalendarParityContext {
  bySchedule: ReadonlyMap<string, CalendarScheduleFact>;
  convertedStartIds: ReadonlySet<string>;
}

function clockFact(raw: unknown, zone: string): CalendarClockFact {
  const mongoValues = new Set<string>();
  if (typeof raw === 'string') mongoValues.add(raw);
  else if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    // Mongoose's String path casts a legacy BSON Date via toString(); lean JSON uses ISO.
    mongoValues.add(raw.toString()); mongoValues.add(raw.toISOString());
  }
  const converted = toLocalTime(raw, zone);
  // toLocalTime always emits millisecond precision, exactly what appLocalTime reads back.
  const expected = converted.ok && converted.value ? converted.value.replace(' ', 'T') : null;
  return { mongoValues, expected, normalized: expected !== null && mongoValues.size > 0 && !mongoValues.has(expected) };
}

/** Build facts from the same source snapshot the copy used, never from Postgres's answer. */
export function calendarParityContext(schedules: Loose[], users: Loose[]): CalendarParityContext {
  const zoneByUser = new Map(users.map(user => [String(user._id), branchZone(user.location || '')]));
  const bySchedule = new Map<string, CalendarScheduleFact>();
  const convertedStartIds = new Set<string>();
  for (const schedule of schedules) {
    const id = String(schedule._id), zone = zoneByUser.get(String(schedule.userId)) || branchZone('');
    const startTime = clockFact(schedule.startTime, zone), endTime = clockFact(schedule.endTime, zone);
    const rawStart = schedule.startTime;
    const sourceStartKey = rawStart instanceof Date && !Number.isNaN(rawStart.getTime())
      ? `date:${rawStart.toISOString()}` : typeof rawStart === 'string' ? `string:${rawStart}` : `unknown:${id}`;
    bySchedule.set(id, { zone, sourceStartKey, startTime, endTime, sourceMissing: schedule.source === undefined });
    if (startTime.normalized) convertedStartIds.add(id);
  }
  return { bySchedule, convertedStartIds };
}

/** Accepts the comparison's broader parity context; only a direct calendar record's two clocks qualify. */
export function knownCalendarClock(difference: Difference, context?: { postgres: unknown; calendar?: CalendarParityContext; calendarFeed?: boolean }): boolean {
  if (!context?.calendar || context.calendarFeed) return false;
  if (!/^(?:\d+\.)?(?:startTime|endTime)$/.test(difference.path)) return false;
  const keys = difference.path.split('.');
  const field = keys.pop();
  if (field !== 'startTime' && field !== 'endTime') return false;
  let record = context.postgres as Loose | undefined;
  for (const key of keys) record = record?.[key];
  if (!record || typeof record !== 'object' || !record._id) return false;
  const fact = context.calendar.bySchedule.get(String(record._id))?.[field as ClockField];
  return Boolean(fact?.normalized && typeof difference.mongo === 'string' &&
    fact.mongoValues.has(difference.mongo) && difference.postgres === fact.expected);
}

/** Exact order check: only adjacent equal source start keys are canonicalized by id. */
export function calendarOrderIds(value: unknown, facts: CalendarParityContext): string[] {
  const rows = value as Loose[];
  const ids: string[] = [];
  for (let start = 0; start < rows.length;) {
    const id = String(rows[start]._id), key = facts.bySchedule.get(id)?.sourceStartKey;
    let end = start + 1;
    while (key !== undefined && end < rows.length && facts.bySchedule.get(String(rows[end]._id))?.sourceStartKey === key) end++;
    ids.push(...rows.slice(start, end).map(row => String(row._id)).sort());
    start = end;
  }
  return ids;
}

/** The lean feed exposes the copy's model default only when this exact source row lacked it. */
export function knownCalendarDefault(difference: Difference, context?: { postgres: unknown; calendar?: CalendarParityContext; calendarFeed?: boolean }): boolean {
  if (!context?.calendar || !context.calendarFeed || difference.mongo !== undefined || difference.postgres !== 'manual') return false;
  if (!/^(?:\d+\.)?source$/.test(difference.path)) return false;
  const keys = difference.path.split('.');
  if (keys.pop() !== 'source') return false;
  let record = context.postgres as Loose | undefined;
  for (const key of keys) record = record?.[key];
  return Boolean(record?._id && context.calendar.bySchedule.get(String(record._id))?.sourceMissing);
}

/** Convenience for focused parity tests; production comparison reports the two reasons separately. */
export const knownCalendarDifference = (difference: Difference, context?: { postgres: unknown; calendar?: CalendarParityContext; calendarFeed?: boolean }) =>
  knownCalendarClock(difference, context) || knownCalendarDefault(difference, context);
