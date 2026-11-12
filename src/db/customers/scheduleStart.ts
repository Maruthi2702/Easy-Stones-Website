/** Preserve only the source clock spelling/type needed for MongoDB filtering, sorting and ICS feeds. */
import { and, sql, type SQL } from 'drizzle-orm';
import { schedules, type LegacyScheduleClock } from '../schema/customers.ts';

export function scheduleClockMetadata(raw: unknown, canonical: string | null): LegacyScheduleClock | null {
  if (!canonical) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return { kind: 'date', value: raw.toISOString() };
  if (typeof raw === 'string' && raw !== canonical.replace(' ', 'T')) return { kind: 'string', value: raw };
  return null;
}


/** What MongoDB's String path (or lean legacy Date) gives the existing-field validator. */
export const scheduleValidationClock = (legacy: LegacyScheduleClock | null, canonical: string | undefined): string | undefined =>
  legacy ? (legacy.kind === 'date' ? new Date(legacy.value).toString() : legacy.value) : canonical;

/** SQL spellings are shared by calendar reads and the linked-calendar write predicates. */
export const scheduleClockText = (): SQL => sql`coalesce(${schedules.legacyStartTime}->>'value', to_char(${schedules.startsAt}, 'YYYY-MM-DD"T"HH24:MI:SS.MS')) collate "C"`;
export const scheduleClockIsString = (): SQL => sql`${schedules.legacyStartTime}->>'kind' is distinct from 'date'`;
export const scheduleClockKind = (): SQL => sql`case when ${schedules.legacyStartTime}->>'kind' = 'date' then 1 else 0 end`;
/** The caller has already validated the YYYY-MM-DD date used in MongoDB's anchored regex. */
export const scheduleOnDay = (date: string): SQL => and(scheduleClockIsString(), sql`left(${scheduleClockText()}, 10) = ${date}`)!;
