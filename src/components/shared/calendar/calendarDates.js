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

const pad = (n) => String(n).padStart(2, '0');

// ── Reading and writing the strings ────────────────────────────────────────

/** A local Date as "YYYY-MM-DD". */
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Today on the viewer's clock. */
export const todayISO = () => isoOf(new Date());

/** "YYYY-MM-DD" → { y, m (0–11), d }, or null when it isn't a real calendar day. */
export const parseISO = (s) => {
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

export const isValidISO = (s) => parseISO(s) !== null;

/** "YYYY-MM" → { y, m (0–11) } or null. */
export const parseMonth = (s) => {
    const hit = /^(\d{4})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!hit || Number(hit[2]) < 1 || Number(hit[2]) > 12) return null;
    return { y: Number(hit[1]), m: Number(hit[2]) - 1 };
};

/** "YYYY" or 2026 → 2026, or null. */
export const parseYear = (s) => {
    const hit = /^(\d{4})$/.exec(String(s ?? ''));
    return hit ? Number(hit[1]) : null;
};

export const monthOf = (iso) => iso.slice(0, 7);

const toDate = (iso) => {
    const p = parseISO(iso);
    return p ? new Date(p.y, p.m, p.d) : null;
};

// ── Moving around ──────────────────────────────────────────────────────────

/** A day moved by whole days (negative goes back). */
export const shiftDay = (iso, days) => {
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
export const shiftMonth = (iso, months) => {
    const p = parseISO(iso);
    if (!p) return iso;
    const lastOfTarget = new Date(p.y, p.m + months + 1, 0).getDate();
    return isoOf(new Date(p.y, p.m + months, Math.min(p.d, lastOfTarget)));
};

/** The same day number in another month ("YYYY-MM"), clamped like shiftMonth. */
export const withMonth = (iso, ym) => {
    const target = parseMonth(ym);
    const p = parseISO(iso);
    if (!target || !p) return iso;
    const lastOfTarget = new Date(target.y, target.m + 1, 0).getDate();
    return `${ym}-${pad(Math.min(p.d, lastOfTarget))}`;
};

/** A "YYYY-MM" moved by whole months. */
export const shiftMonthKey = (ym, months) => {
    const p = parseMonth(ym);
    if (!p) return ym;
    const d = new Date(p.y, p.m + months, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

// ── The month grid ─────────────────────────────────────────────────────────

/** Weekday headings, in the order the week starts. */
export const weekdayLabels = (weekStart = WEEK_STARTS_ON) =>
    WEEKDAYS_SUN_FIRST.slice(weekStart).concat(WEEKDAYS_SUN_FIRST.slice(0, weekStart));

/** The 42 days (six rows) shown for a month, spilling into the months either side. */
export const monthGrid = (year, month, weekStart = WEEK_STARTS_ON) => {
    const offset = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
    return Array.from({ length: 42 }, (_, i) => isoOf(new Date(year, month, 1 - offset + i)));
};

/** First and last day of the week a day falls in. */
export const weekBounds = (iso, weekStart = WEEK_STARTS_ON) => {
    const d = toDate(iso);
    if (!d) return null;
    const back = (d.getDay() - weekStart + 7) % 7;
    return { start: shiftDay(iso, -back), end: shiftDay(iso, 6 - back) };
};

/** First year of the decade a year is in (2026 → 2020). */
export const decadeStart = (year) => Math.floor(year / 10) * 10;

/** The twelve cells of the year view: one year before the decade, its ten, one after. */
export const yearCells = (decade) => Array.from({ length: 12 }, (_, i) => decade - 1 + i);

// ── Limits ─────────────────────────────────────────────────────────────────

/** True when a day is before `min` or after `max` (either may be empty). */
export const dayOutside = (iso, min, max) => Boolean((min && iso < min) || (max && iso > max));
/** True when a whole month ("YYYY-MM") has no day inside the limits. */
export const monthOutside = (ym, min, max) => Boolean((min && ym < min.slice(0, 7)) || (max && ym > max.slice(0, 7)));
/** True when a whole year has no day inside the limits. */
export const yearOutside = (year, min, max) => Boolean((min && String(year) < min.slice(0, 4)) || (max && String(year) > max.slice(0, 4)));

/** A day pulled back inside the limits. */
export const clampDay = (iso, min, max) => {
    if (min && iso < min) return min;
    if (max && iso > max) return max;
    return iso;
};

// ── Words ──────────────────────────────────────────────────────────────────

/** "Tue, Oct 20, 2026" — what a date field shows. */
export const formatDateText = (iso) => {
    const d = toDate(iso);
    return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
};

/** "Tuesday, October 20, 2026" — what a screen reader hears for a day. */
export const formatDateLong = (iso) => {
    const d = toDate(iso);
    return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
};

/** "October 2026" for "2026-10". */
export const formatMonthText = (ym) => {
    const p = parseMonth(ym);
    return p ? `${MONTH_NAMES[p.m]} ${p.y}` : '';
};

/** "Oct 19 – 25, 2026" / "Oct 27 – Nov 2, 2026" / "Dec 28, 2026 – Jan 3, 2027" for a run of days. */
export const formatRangeText = (startISO, endISO) => {
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
export const dayAfterKey = (iso, key, shiftKey = false, weekStart = WEEK_STARTS_ON) => {
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
export const inDays = (label, days, today = todayISO()) => ({ label, value: shiftDay(today, days) });

// ── A date with a time (the visit scheduler) ───────────────────────────────

/** Local "YYYY-MM-DDTHH:mm:00.000" for a Date. */
export const localDateTime = (d) =>
    `${isoOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00.000`;

/**
 * Reads a saved date-time. A trailing Z is dropped so the clock reads exactly
 * what was typed — these times are local wall-clock times, not instants.
 * An empty or unreadable value is "now".
 */
export const readDateTime = (value) => {
    if (!value) return new Date();
    const d = new Date(typeof value === 'string' && value.endsWith('Z') ? value.slice(0, -1) : value);
    return Number.isNaN(d.getTime()) ? new Date() : d;
};

/** Now, rounded to the nearest 5 minutes — what an empty scheduler starts at. */
export const roundedNow = (now = new Date()) => {
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
export const clockParts = (d) => ({
    hour: d.getHours() % 12 === 0 ? 12 : d.getHours() % 12,
    minute: (Math.round(d.getMinutes() / 5) * 5) % 60,
    period: d.getHours() >= 12 ? 'PM' : 'AM'
});

/** A date-time with its clock set to a 12-hour hour, a minute and AM / PM. */
export const withClock = (value, hour, minute, period) => {
    const d = readDateTime(value);
    d.setHours((Number(hour) % 12) + (period === 'PM' ? 12 : 0), Number(minute), 0, 0);
    return localDateTime(d);
};

/** A date-time moved to another day, keeping the time of day. */
export const withDay = (value, iso) => {
    const p = parseISO(iso);
    if (!p) return value;
    const d = readDateTime(value);
    d.setFullYear(p.y, p.m, p.d);
    return localDateTime(d);
};

/** "10:30 AM". */
export const formatTimeText = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
