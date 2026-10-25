/*
 * Every date rule the app's calendar needs, in one place (2026-10-17).
 * The screens are in Calendar.jsx; the look is in Calendar.css. If a date
 * picker misbehaves, the cause is in one of these three files — a screen that
 * does its own date arithmetic for a picker (shifting a day or a month,
 * clamping the 31st, naming a month) should use these instead.
 *
 * Dates travel as plain strings, never Date objects: a day is "YYYY-MM-DD", a
 * month "YYYY-MM", a year "YYYY", a date with a time "YYYY-MM-DDTHH:mm:ss.000"
 * (local time, no zone). Everything here works on the viewer's local calendar
 * — a day never shifts because of UTC.
 */

/** The week starts on this day (0 = Sunday, 1 = Monday) — the Delivery Schedule's board starts on Monday. */
export const WEEK_STARTS_ON = 1;

export const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
const WEEKDAYS_SUN_FIRST = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const pad = (n: number): string => String(n).padStart(2, '0');

// ── Reading and writing the strings ────────────────────────────────────────

/** A local Date as "YYYY-MM-DD". */
export const isoOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Today on the viewer's clock. */
export const todayISO = (): string => isoOf(new Date());

/** "YYYY-MM-DD" → { y, m (0–11), d }, or null when it isn't a real calendar day. */
export const parseISO = (s: unknown): { y: number; m: number; d: number } | null => {
    const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof s === 'string' ? s : '');
    if (!hit) return null;
    const y = Number(hit[1]);
    const m = Number(hit[2]) - 1;
    const d = Number(hit[3]);
    const check = new Date(y, m, d);
    // new Date(2026, 1, 31) rolls into March — a rolled date wasn't real.
    if (check.getFullYear() !== y || check.getMonth() !== m || check.getDate() !== d) return null;
    return { y, m, d };
};

export const isValidISO = (s: unknown): boolean => parseISO(s) !== null;

/** "YYYY-MM" → { y, m (0–11) } or null. */
export const parseMonth = (s: unknown): { y: number; m: number } | null => {
    const hit = /^(\d{4})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!hit || Number(hit[2]) < 1 || Number(hit[2]) > 12) return null;
    return { y: Number(hit[1]), m: Number(hit[2]) - 1 };
};

/** "YYYY" or 2026 → 2026, or null. */
export const parseYear = (s: unknown): number | null => {
    const hit = /^(\d{4})$/.exec(String(s ?? ''));
    return hit ? Number(hit[1]) : null;
};

export const monthOf = (iso: string): string => iso.slice(0, 7);

const toDate = (iso: string): Date | null => {
    const p = parseISO(iso);
    return p ? new Date(p.y, p.m, p.d) : null;
};

// ── Moving around ──────────────────────────────────────────────────────────

/** A day moved by whole days (negative goes back). */
export const shiftDay = (iso: string, days: number): string => {
    const d = toDate(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + days);
    return isoOf(d);
};
export const addDays = shiftDay;

/**
 * A day moved by whole months, keeping the day number where it can — clamped,
 * because 31 January a month on is the 28th, not the 3rd of March, which is
 * what Date's own rollover would give.
 */
export const shiftMonth = (iso: string, months: number): string => {
    const p = parseISO(iso);
    if (!p) return iso;
    const lastOfTarget = new Date(p.y, p.m + months + 1, 0).getDate();
    return isoOf(new Date(p.y, p.m + months, Math.min(p.d, lastOfTarget)));
};

/** The same day number in another month ("YYYY-MM"), clamped like shiftMonth. */
export const withMonth = (iso: string, ym: string): string => {
    const target = parseMonth(ym);
    const p = parseISO(iso);
    if (!target || !p) return iso;
    const lastOfTarget = new Date(target.y, target.m + 1, 0).getDate();
    return `${ym}-${pad(Math.min(p.d, lastOfTarget))}`;
};

/** A "YYYY-MM" moved by whole months. */
export const shiftMonthKey = (ym: string, months: number): string => {
    const p = parseMonth(ym);
    if (!p) return ym;
    const d = new Date(p.y, p.m + months, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

// ── The month grid ─────────────────────────────────────────────────────────

/** Weekday headings, in the order the week starts. */
export const weekdayLabels = (weekStart: number = WEEK_STARTS_ON): string[] =>
    WEEKDAYS_SUN_FIRST.slice(weekStart).concat(WEEKDAYS_SUN_FIRST.slice(0, weekStart));

/** The 42 days (six rows) shown for a month, spilling into the months either side. */
export const monthGrid = (year: number, month: number, weekStart: number = WEEK_STARTS_ON): string[] => {
    const offset = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
    return Array.from({ length: 42 }, (_, i) => isoOf(new Date(year, month, 1 - offset + i)));
};

/** First and last day of the week a day falls in. */
export const weekBounds = (iso: string, weekStart: number = WEEK_STARTS_ON): { start: string; end: string } | null => {
    const d = toDate(iso);
    if (!d) return null;
    const back = (d.getDay() - weekStart + 7) % 7;
    return { start: shiftDay(iso, -back), end: shiftDay(iso, 6 - back) };
};

/** First year of the decade a year is in (2026 → 2020). */
export const decadeStart = (year: number): number => Math.floor(year / 10) * 10;

/** The twelve cells of the year view: one year before the decade, its ten, one after. */
export const yearCells = (decade: number): number[] => Array.from({ length: 12 }, (_, i) => decade - 1 + i);

// ── Limits ─────────────────────────────────────────────────────────────────

/** True when a day is before `min` or after `max` (either may be empty). */
type Limit = string | null | undefined;

export const dayOutside = (iso: string, min: Limit, max: Limit): boolean => Boolean((min && iso < min) || (max && iso > max));
/** True when a whole month ("YYYY-MM") has no day inside the limits. */
export const monthOutside = (ym: string, min: Limit, max: Limit): boolean => Boolean((min && ym < min.slice(0, 7)) || (max && ym > max.slice(0, 7)));
/** True when a whole year has no day inside the limits. */
export const yearOutside = (year: number | string, min: Limit, max: Limit): boolean => Boolean((min && String(year) < min.slice(0, 4)) || (max && String(year) > max.slice(0, 4)));

/** A day pulled back inside the limits. */
export const clampDay = (iso: string, min: Limit, max: Limit): string => {
    if (min && iso < min) return min;
    if (max && iso > max) return max;
    return iso;
};

// ── Words ──────────────────────────────────────────────────────────────────

/** "Tue, Oct 20, 2026" — what a date field shows. */
export const formatDateText = (iso: string): string => {
    const d = toDate(iso);
    return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
};

/** "Tuesday, October 20, 2026" — what a screen reader hears for a day. */
export const formatDateLong = (iso: string): string => {
    const d = toDate(iso);
    return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
};

/** "October 2026" for "2026-10". */
export const formatMonthText = (ym: string): string => {
    const p = parseMonth(ym);
    return p ? `${MONTH_NAMES[p.m]} ${p.y}` : '';
};

/** "Oct 19 – 25, 2026" / "Oct 27 – Nov 2, 2026" / "Dec 28, 2026 – Jan 3, 2027" for a run of days. */
export const formatRangeText = (startISO: string, endISO: string): string => {
    const a = parseISO(startISO);
    const b = parseISO(endISO);
    if (!a || !b) return '';
    if (a.y !== b.y) return `${MONTH_SHORT[a.m]} ${a.d}, ${a.y} – ${MONTH_SHORT[b.m]} ${b.d}, ${b.y}`;
    if (a.m !== b.m) return `${MONTH_SHORT[a.m]} ${a.d} – ${MONTH_SHORT[b.m]} ${b.d}, ${b.y}`;
    return `${MONTH_SHORT[a.m]} ${a.d} – ${b.d}, ${b.y}`;
};

// ── Keyboard ───────────────────────────────────────────────────────────────

/**
 * Where the day view's keyboard focus goes for a key, or null for a key it
 * doesn't handle: arrows move a day / a week, PageUp / PageDown a month
 * (Shift: a year), Home / End the ends of the week.
 */
export const dayAfterKey = (iso: string, key: string, shiftKey = false, weekStart: number = WEEK_STARTS_ON): string | null => {
    switch (key) {
        case 'ArrowLeft': return shiftDay(iso, -1);
        case 'ArrowRight': return shiftDay(iso, 1);
        case 'ArrowUp': return shiftDay(iso, -7);
        case 'ArrowDown': return shiftDay(iso, 7);
        case 'PageUp': return shiftMonth(iso, shiftKey ? -12 : -1);
        case 'PageDown': return shiftMonth(iso, shiftKey ? 12 : 1);
        case 'Home': return weekBounds(iso, weekStart)?.start ?? null;
        case 'End': return weekBounds(iso, weekStart)?.end ?? null;
        default: return null;
    }
};

// ── Shortcut buttons ───────────────────────────────────────────────────────

/** A shortcut that lands `days` from today ("Tomorrow", "+1 week"). */
export const inDays = (label: string, days: number, today: string = todayISO()): { label: string; value: string } => ({ label, value: shiftDay(today, days) });

// ── A date with a time (the visit scheduler) ───────────────────────────────

/** Local "YYYY-MM-DDTHH:mm:00.000" for a Date. */
export const localDateTime = (d: Date): string =>
    `${isoOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00.000`;

/**
 * Reads a saved date-time. A trailing Z is dropped so the clock reads exactly
 * what was typed — these times are local wall-clock times, not instants.
 * An empty or unreadable value is "now".
 */
export const readDateTime = (value: string | number | Date | null | undefined): Date => {
    if (!value) return new Date();
    const d = new Date(typeof value === 'string' && value.endsWith('Z') ? value.slice(0, -1) : value);
    return Number.isNaN(d.getTime()) ? new Date() : d;
};

/** Now, rounded to the nearest 5 minutes — what an empty scheduler starts at. */
export const roundedNow = (now: Date = new Date()): Date => {
    const d = new Date(now);
    let minutes = Math.round(d.getMinutes() / 5) * 5;
    if (minutes >= 60) {
        d.setHours(d.getHours() + 1);
        minutes = 0;
    }
    d.setMinutes(minutes, 0, 0);
    return d;
};

/** The 12-hour clock's parts for a Date, minutes rounded to the 5 the picker offers. */
export const clockParts = (d: Date): { hour: number; minute: number; period: 'AM' | 'PM' } => ({
    hour: d.getHours() % 12 === 0 ? 12 : d.getHours() % 12,
    minute: (Math.round(d.getMinutes() / 5) * 5) % 60,
    period: d.getHours() >= 12 ? 'PM' : 'AM'
});

/** A date-time with its clock set to a 12-hour hour, a minute and AM / PM. */
export const withClock = (value: string | null | undefined, hour: number | string, minute: number | string, period: string): string => {
    const d = readDateTime(value);
    d.setHours((Number(hour) % 12) + (period === 'PM' ? 12 : 0), Number(minute), 0, 0);
    return localDateTime(d);
};

/** A date-time moved to another day, keeping the time of day. */
export const withDay = (value: string | null | undefined, iso: string): string | null | undefined => {
    const p = parseISO(iso);
    if (!p) return value;
    const d = readDateTime(value);
    d.setFullYear(p.y, p.m, p.d);
    return localDateTime(d);
};

/** "10:30 AM". */
export const formatTimeText = (d: Date): string => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
