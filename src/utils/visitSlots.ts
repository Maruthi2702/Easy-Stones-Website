/**
 * The Route Planner's "Schedule a visit" sheet: which dates to offer in one tap
 * and which start time to suggest. Pure — the sheet only draws it.
 *
 * Times are 'HH:MM' on a 24-hour clock, dates 'YYYY-MM-DD'. A booked visit is
 * { startTime, endTime } as the Schedule stores them ('YYYY-MM-DDTHH:mm:ss…').
 */

const pad = (n: number): string => String(n).padStart(2, '0');

const dateOf = (iso: string): Date => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
const isoOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (iso: string, days: number): string => { const d = dateOf(iso); d.setDate(d.getDate() + days); return isoOf(d); };

/** Tomorrow, next Monday, and the Monday after — the dates one tap should reach. */
export const quickDates = (todayIso: string): { label: string; value: string }[] => {
  const day = dateOf(todayIso).getDay(); // 0 = Sunday
  // A Sunday's next Monday is tomorrow, which "Tomorrow" already offers.
  let toNextMonday = ((8 - day) % 7) || 7;
  if (toNextMonday === 1) toNextMonday += 7;
  const nextMonday = plus(todayIso, toNextMonday);
  return [
    { label: 'Tomorrow', value: plus(todayIso, 1) },
    { label: 'Next week', value: nextMonday },
    { label: 'In 2 weeks', value: plus(nextMonday, 7) }
  ];
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

/**
 * The earliest start between 9:00 and 17:00 where a visit of `minutes` fits
 * between what's already booked (visits on other days are ignored by the
 * caller). A booking with no usable end counts as `minutes` long. Returns
 * 'HH:MM', or null when the day has no room — the caller then offers 09:00 and
 * lets the person decide.
 */
export const firstFreeSlot = (
  booked: { startTime?: string; endTime?: string }[] = [],
  { minutes = 45, from = DAY_START, to = DAY_END }: { minutes?: number; from?: number; to?: number } = {}
): string | null => {
  const busy = booked
    .map((b) => {
      const start = minutesOf(b.startTime);
      if (start == null) return null;
      const end = minutesOf(b.endTime);
      return { start, end: end != null && end > start ? end : start + minutes };
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
