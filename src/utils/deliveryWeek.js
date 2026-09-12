/**
 * Shape of the delivery board's week.
 *
 * The board is a work-week view: Monday to Friday is what a normal week looks
 * like, and that hasn't changed. Weekend deliveries do happen, rarely, and
 * used to be unreachable — the week was built as five dates, so the fetch
 * range ended on Friday and the day columns were a fixed Mon–Fri list. A
 * Saturday date could still be picked and saved (nothing validated it), after
 * which the delivery was neither fetched nor renderable: it vanished off the
 * board with no error, which reads exactly like it was never created.
 *
 * So the week spans seven dates for fetching, and a weekend day is rendered
 * only when it actually carries something. A normal week is visually
 * identical to before; scheduling a Saturday makes Saturday appear.
 *
 * Dates here are calendar dates ('YYYY-MM-DD'), never instants — see the note
 * at the top of dateUtils.js. They're read by their date parts so a timezone
 * offset can't shift which weekday a date falls on.
 */
import { formatForDateInput } from './dateUtils';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Monday through Sunday. The board renders a subset (see visibleWeekDates);
// this is the full span, and the range the week's deliveries are fetched over.
export const DAYS_IN_WEEK = 7;
// Monday..Friday occupy indexes 0-4 of a week built by getWeekDates.
export const WEEKDAY_COUNT = 5;

/** Weekday index (0 = Sunday … 6 = Saturday) of a 'YYYY-MM-DD' calendar date. */
export const weekdayIndex = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getDay();
};

export const isWeekendDate = (dateStr) => {
  const i = weekdayIndex(dateStr);
  return i === 0 || i === 6;
};

/**
 * Day name for a date, derived from the date itself rather than from a
 * fixed list the caller indexes in parallel. The board used to pair a
 * hard-coded Mon–Fri array against the dates by position, which silently
 * mislabels every column the moment the two lengths stop matching.
 */
export const dayLabel = (dateStr) => {
  const i = weekdayIndex(dateStr);
  if (i === null) return { name: '', short: '' };
  return { name: DAY_NAMES[i], short: DAY_SHORT[i] };
};

/**
 * The Monday of the week containing `date` — including for Sunday, which
 * belongs to the week it closes.
 *
 * This is a deliberate change from the old five-day behaviour, where Sunday
 * rolled *forward* to the next Monday. That was harmless while Sunday was
 * merely the gap between two work weeks, but now that it can hold a delivery
 * it would mean opening the board on a Sunday showed the week starting
 * tomorrow — with that day's own deliveries off-screen behind the back arrow.
 * Today should always be inside the week on display.
 *
 * The cost is that Sunday now opens on the week just ending rather than the
 * one about to start; the forward arrow is one click away.
 */
export const getWeekMonday = (date = new Date()) => {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : new Date(date);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  return monday;
};

/** Seven calendar dates, Monday first. */
export const getWeekDates = (mondayDate) => {
  const base = new Date(mondayDate);
  return Array.from({ length: DAYS_IN_WEEK }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return formatForDateInput(d);
  });
};

/**
 * The days the board should actually draw: the five weekdays always, plus a
 * weekend day only when something is scheduled on it. `usedDates` is any
 * iterable of 'YYYY-MM-DD' strings that have deliveries.
 */
export const visibleWeekDates = (weekDates = [], usedDates = []) => {
  const used = usedDates instanceof Set ? usedDates : new Set(usedDates);
  return weekDates.filter((date, i) => i < WEEKDAY_COUNT || used.has(date));
};

/** e.g. "Sep 7 — Sep 11", spanning whichever days are on screen. */
export const formatWeekRangeText = (dates) => {
  if (!dates || !dates.length) return '';
  const fmt = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(dates[0])} — ${fmt(dates[dates.length - 1])}`;
};
