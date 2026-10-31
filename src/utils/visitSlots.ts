/**
 * The schedule form's rules (src/components/shared/schedule/): which day it
 * opens on, which start time to suggest, what a time collides with. Pure — the
 * form only draws it. The assumed length of a booking with no end time is
 * DEFAULT_VISIT_MINUTES (scheduleRecord.js, which the calendar feed uses too).
 *
 * Times are 'HH:MM' on a 24-hour clock, dates 'YYYY-MM-DD'. A booked visit is
 * { startTime, endTime } as the Schedule stores them ('YYYY-MM-DDTHH:mm:ss…').
 */

import { DEFAULT_VISIT_MINUTES } from './scheduleRecord.ts';
import { newVisitId } from './visitForm.ts';

const pad = (n: number): string => String(n).padStart(2, '0');

const dateOf = (iso: string): Date => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
const isoOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDaysISO = (iso: string, days: number): string => { const d = dateOf(iso); d.setDate(d.getDate() + days); return isoOf(d); };

/** Tomorrow, next Monday, and the Monday after — the dates one tap should reach. */
export const quickDates = (todayIso: string): { label: string; value: string }[] => {
  const day = dateOf(todayIso).getDay(); // 0 = Sunday
  // A Sunday's next Monday is tomorrow, which "Tomorrow" already offers.
  let toNextMonday = ((8 - day) % 7) || 7;
  if (toNextMonday === 1) toNextMonday += 7;
  const nextMonday = addDaysISO(todayIso, toNextMonday);
  return [
    { label: 'Tomorrow', value: addDaysISO(todayIso, 1) },
    { label: 'Next week', value: nextMonday },
    { label: 'In 2 weeks', value: addDaysISO(nextMonday, 7) }
  ];
};

/** The hour (24h clock) after which "today" is over and a new visit defaults to tomorrow. */
export const DAY_OVER_HOUR = 18;

/** The day a new visit opens on: today until 6 PM, tomorrow after. `now` is local time. */
export const defaultVisitDate = (now: Date = new Date()): string => {
  const today = isoOf(now);
  return now.getHours() >= DAY_OVER_HOUR ? addDaysISO(today, 1) : today;
};

/** The earliest start worth suggesting on `date`: 9:00, or the next quarter hour if that day is today and 9:00 has passed. */
export const earliestStart = (date: string, now: Date = new Date()): number => {
  if (date !== isoOf(now)) return DAY_START;
  const next = Math.ceil((now.getHours() * 60 + now.getMinutes()) / STEP) * STEP;
  return Math.max(DAY_START, next);
};

/** Minutes since midnight of 'HH:MM' or of an ISO date-time's clock part. */
export const minutesOf = (time: unknown): number | null => {
  const m = String(time || '').match(/(?:T|^)(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export const timeText = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** '10:30 AM' from minutes since midnight. */
export const clockLabel = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${pad(minutes % 60)} ${h < 12 ? 'AM' : 'PM'}`;
};

export const DAY_START = 9 * 60;
export const DAY_END = 17 * 60;
export const STEP = 15;
export { DEFAULT_VISIT_MINUTES };

/**
 * The earliest start between 9:00 and 17:00 where a visit of `minutes` fits
 * between what's already booked (visits on other days are ignored by the
 * caller). A booking with no usable end counts as DEFAULT_VISIT_MINUTES long, whatever
 * length is being added (the Sales Planner never saved an end). Returns
 * 'HH:MM', or null when the day has no room — the caller then offers 09:00 and
 * lets the person decide.
 */
export const firstFreeSlot = (
  booked: { startTime?: string; endTime?: string }[] = [],
  { minutes = DEFAULT_VISIT_MINUTES, from = DAY_START, to = DAY_END }: { minutes?: number; from?: number; to?: number } = {}
): string | null => {
  const busy = booked
    .map((b) => {
      const start = minutesOf(b.startTime);
      if (start == null) return null;
      const end = minutesOf(b.endTime);
      return { start, end: end != null && end > start ? end : start + DEFAULT_VISIT_MINUTES };
    })
    .filter((b): b is { start: number; end: number } => b !== null);
  for (let start = from; start + minutes <= to; start += STEP) {
    const end = start + minutes;
    if (!busy.some((b) => start < b.end && end > b.start)) return timeText(start);
  }
  return null;
};

/** Every quarter hour from 06:00 to 20:00, as the time picker's options. */
export const timeOptions = (): { value: string; label: string }[] => {
  const out: { value: string; label: string }[] = [];
  for (let m = 6 * 60; m <= 20 * 60; m += STEP) out.push({ value: timeText(m), label: clockLabel(m) });
  return out;
};

/** 'YYYY-MM-DDTHH:mm:00.000' — the stored local-time shape — from a date, a start and a length. */
export const startEnd = (date: string, start: string, minutes: number): { startTime: string; endTime: string } => {
  const s = minutesOf(start);
  const e = (s as number) + minutes;
  const end = `${pad(Math.floor(e / 60) % 24)}:${pad(e % 60)}`;
  return { startTime: `${date}T${start}:00.000`, endTime: `${date}T${end}:00.000` };
};

/** One entry already on a day, as the form needs it. */
export type BookedRow = { id?: string; customerId?: string; startTime?: string; endTime?: string; label?: string };

/** The minutes a booking covers (a missing end counts as DEFAULT_VISIT_MINUTES), or null when it has no readable start. */
export const bookedSpan = (b: BookedRow): { start: number; end: number; assumed: boolean } | null => {
  const start = minutesOf(b.startTime);
  if (start == null) return null;
  const end = minutesOf(b.endTime);
  const real = end != null && end > start;
  return { start, end: real ? (end as number) : start + DEFAULT_VISIT_MINUTES, assumed: !real };
};

/** The bookings a visit of `minutes` starting at `start` (minutes since midnight) would overlap. */
export const overlapsOf = (booked: BookedRow[] = [], start: number, minutes: number): BookedRow[] => {
  const end = start + minutes;
  return booked.filter((b) => {
    const span = bookedSpan(b);
    return span !== null && start < span.end && end > span.start;
  });
};

/** The bookings that are already for this customer (same day is the caller's: pass that day's rows). */
export const bookedForCustomer = (booked: BookedRow[] = [], customerId: string): BookedRow[] =>
  customerId ? booked.filter((b) => b.customerId && String(b.customerId) === String(customerId)) : [];

/** True when `date` is today and `start` (minutes since midnight) has already gone by. */
export const startIsPast = (date: string, start: number, now: Date = new Date()): boolean =>
  date === isoOf(now) && start < now.getHours() * 60 + now.getMinutes();

/** '9:00 – 9:30 AM', or '11:30 AM – 12:00 PM' when it crosses noon. */
export const rangeLabel = (start: number, end: number): string => {
  const a = clockLabel(start);
  const b = clockLabel(end);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
};

/** The earliest day from `fromIso` (itself included) that has a free slot of `minutes`, skipping weekends; null within `maxDays`. */
export const nextDayWithRoom = (
  fromIso: string,
  bookedOn: (iso: string) => BookedRow[],
  minutes: number,
  now: Date = new Date(),
  maxDays = 14
): string | null => {
  for (let i = 0; i < maxDays; i++) {
    const day = addDaysISO(fromIso, i);
    const dow = dateOf(day).getDay();
    if (dow === 0 || dow === 6) continue;
    if (firstFreeSlot(bookedOn(day), { minutes, from: earliestStart(day, now) }) !== null) return day;
  }
  return null;
};

/** The lengths a visit can have, in the order they're offered. */
export const LENGTH_MINUTES = [15, 30, 45, 60, 90, 120];

/** A new entry's own id (24 hex), so a repeated save is recognised by the server. */
export const newScheduleId = (): string => newVisitId();
