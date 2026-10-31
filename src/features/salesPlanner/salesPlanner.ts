import type { PlannerItem } from './plannerSchedule';
import type { ScheduleInitial } from '../../components/shared/schedule/ScheduleActivityForm';
import { DEFAULT_VISIT_MINUTES, defaultVisitDate, timeText, type BookedRow } from '../../utils/visitSlots';

/**
 * The sales planner's pure rules: the days a view shows and fetches, where a
 * dropped stop lands, and the labels the calendar draws. No React, no network.
 *
 * The date helpers here are the planner's own (it works in local Date objects,
 * the shared calendar in 'YYYY-MM-DD' strings) — KNOWN_ISSUES.md lists them as
 * date arithmetic still to fold into calendarDates.js.
 */

export type ViewMode = 'day' | 'week' | 'month';

/** What a save of the schedule form sends (src/routes/schedule.ts checks it again). `_id` is a new entry's own id, so a repeated send books once. */
export type ActivitySave = { customerId: string; startTime: string; endTime: string; activityType: string; notes: string; _id?: string };

/** One move in the air, whichever input started it. */
export type Drag = { item: PlannerItem; source: 'mouse' | 'touch' | 'keyboard'; dayKey: string | null; index: number | null };

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' in local time — the key a day is stored and looked up under. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Schedules are stored as a local ISO string with no zone suffix, and are read
 * back the same way. Anything that builds a startTime has to match that or the
 * item lands on the wrong day for anyone east of UTC.
 */
export const localISO = (d: Date) =>
    `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000`;

export const startOfDay = (d: Date | number) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Monday of whatever week `d` falls in. Sunday belongs to the week just ending. */
export const mondayOf = (d: Date) => {
    const x = startOfDay(d);
    const g = x.getDay();
    return addDays(x, g === 0 ? -6 : 1 - g);
};

/** 'YYYY-MM-DD' as local midnight. */
export const parseISOLocal = (iso: string) => new Date(`${iso}T00:00:00`);

export const isSameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

/**
 * Whole days between two dates. Rounded rather than truncated because the days
 * a clock goes forward and back are 23 and 25 hours long, and a drag across
 * either of those edges must still count as one day.
 */
export const dayOffset = (from: Date, to: Date) => Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000);

const MINUTES_IN_DAY = 24 * 60;

/** Minutes past midnight — all the ordering inside a day depends on. */
export const minutesOf = (value: string | Date | undefined): number | null => {
    const d = new Date(value as string);
    if (Number.isNaN(d.getTime())) return null;
    return d.getHours() * 60 + d.getMinutes();
};

/** `day` at `minutes` past midnight. setMinutes rolls the hour over itself. */
export const atMinutes = (day: Date, minutes: number) => {
    const d = startOfDay(day);
    d.setMinutes(minutes);
    return d;
};

/**
 * The time a stop takes when it is dropped into slot `index` of `neighbours` —
 * the day's other stops, in order, never including the one being moved.
 *
 * Between two stops it takes the middle of the gap: dropped between a 9am and
 * an 11am it becomes 10am, which is the only reading of "put it here" that a
 * time-ordered list can honour. The middle is rounded to five minutes when the
 * gap is wide enough that rounding cannot land it back on a neighbour — inside
 * a tight gap the exact minute is kept, because a tidy time that shuffles the
 * card back where it came from is worse than an untidy one that does not.
 *
 * At the top it is half an hour before the first stop, at the bottom half an
 * hour after the last. A null index — an empty day, the open end of a column,
 * a month cell with no order to read — means the stop keeps the time it has.
 */
export const slotMinutes = (neighbours: PlannerItem[], index: number | null): number | null => {
    if (index === null || neighbours.length === 0) return null;

    const before = index > 0 ? minutesOf(neighbours[index - 1].startTime) : null;
    const after = index < neighbours.length ? minutesOf(neighbours[index].startTime) : null;

    if (before === null && after === null) return null;
    if (before === null) return Math.max(0, (after as number) - 30);
    if (after === null) return Math.min(MINUTES_IN_DAY - 1, before + 30);

    const middle = (before + after) / 2;
    const tidy = Math.round(middle / 5) * 5;
    return tidy > before && tidy < after ? tidy : Math.floor(middle);
};

/**
 * What aiming stop `id` at gap `gap` of a day's `items` (as drawn, so counting
 * the stop itself when it is already there) asks for: 'stays' for either of the
 * two gaps beside it, else the minutes it would take — null to keep its time.
 *
 * The card stays on screen while it is being moved rather than leaving a hole
 * that shifts everything under the cursor, so a gap below its own position is
 * counting it, and has to give one back.
 */
export const aimedMinutes = (items: PlannerItem[], id: string, gap: number | null): 'stays' | number | null => {
    const self = items.findIndex(i => i._id === id);
    if (self !== -1 && gap !== null && (gap === self || gap === self + 1)) return 'stays';

    let slot = gap;
    if (slot !== null && self !== -1 && slot > self) slot -= 1;

    const neighbours = self === -1 ? items : items.filter(i => i._id !== id);
    return slotMinutes(neighbours, slot);
};

export type MovePlan = { nextStart: Date; patch: { startTime: string; endTime?: string } };

/**
 * Moving `item` to `day`, into gap `gap` of that day's `items`: the new start
 * and the write it takes, or null when nothing would change. Aimed at a gap the
 * time moves to fit it; dropped on the open end of a column (gap null) it keeps
 * the time it had, because there the gesture was about the day and nothing else.
 */
export const planMove = (item: PlannerItem, day: Date, items: PlannerItem[], gap: number | null): MovePlan | null => {
    const from = new Date(item.startTime);
    if (Number.isNaN(from.getTime())) return null;

    // Aimed at one of the two gaps it already sits between. Nothing was
    // asked for, so nothing is the honest answer.
    const minutes = aimedMinutes(items, item._id, gap);
    if (minutes === 'stays') return null;

    const days = dayOffset(from, day);
    if (days === 0 && (minutes === null || minutes === minutesOf(item.startTime))) return null;

    const nextStart = minutes === null ? addDays(from, days) : atMinutes(day, minutes);
    const patch: MovePlan['patch'] = { startTime: localISO(nextStart) };

    // The planner never sets an end time, but the calendar sync does. Carry
    // the length across rather than the clock time it used to end at.
    if (item.endTime) {
        const length = new Date(item.endTime).getTime() - from.getTime();
        if (Number.isFinite(length) && length >= 0) {
            patch.endTime = localISO(new Date(nextStart.getTime() + length));
        }
    }
    return { nextStart, patch };
};

/**
 * The aims the up and down keys walk through, in order: null first — "leave
 * the time alone", which is what moving to another day usually means — then
 * one per gap between a day's `count` stops.
 */
export const gapsFor = (count: number): (number | null)[] => [null, ...Array.from({ length: count + 1 }, (_, i) => i)];

/** The 'YYYY-MM-DD' key's day, back as a local Date. */
export const dayFromKey = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
};

export const ACTIVITY_COLORS: Record<string, string> = {
    'Visit': '#4ade80',
    'Call': '#3b82f6',
    'Drop-off': '#facc15',
    'Other': '#94a3b8'
};

export const ACTIVITY_TYPE_OPTIONS = [
    { value: 'Visit', label: 'Visit' },
    { value: 'Call', label: 'Call' },
    { value: 'Drop-off', label: 'Drop-off' },
    { value: 'Other', label: 'Other' }
];

export const activityModifier = (type: unknown) => {
    switch (type) {
        case 'Call': return 'call';
        case 'Drop-off': return 'dropoff';
        case 'Other': return 'other';
        default: return 'visit';
    }
};

export const activityColor = (type: unknown) => ACTIVITY_COLORS[type as string] || ACTIVITY_COLORS.Other;

export const timeLabel = (value: string | Date) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/** '9:00 AM' as { clock: '9:00', period: 'AM' } — the phone card's time column. A 24-hour locale has no period. */
export const timeParts = (value: string | Date): { clock: string; period: string } => {
    const [clock = '', period = ''] = timeLabel(value).split(' ');
    return { clock, period };
};

/** '30 min', '1 hr', '1½ hr' — what a length of `minutes` is called. */
export const durationText = (minutes: number): string =>
    minutes < 60 ? `${minutes} min` : minutes % 60 === 0 ? `${minutes / 60} hr` : minutes % 60 === 30 ? `${Math.floor(minutes / 60)}½ hr` : `${minutes} min`;

/** A stop's length from its own end time; '' when it has none (older stops never saved one). */
export const lengthOf = (item: PlannerItem): string => {
    const start = minutesOf(item.startTime);
    const end = minutesOf(item.endTime);
    return start !== null && end !== null && end > start ? durationText(end - start) : '';
};

/** 'Today', 'Tomorrow' or 'Yesterday' for the Day view's subtitle; null for any other day. */
export const relativeDayLabel = (day: Date, today: Date): 'Today' | 'Tomorrow' | 'Yesterday' | null => {
    const offset = dayOffset(today, day);
    return offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : null;
};

/** Whether the period on screen (the day, the week, the month) contains today — the phone's Today button hides when it does. */
export const isCurrentPeriod = (date: Date, mode: ViewMode, today: Date): boolean => {
    if (mode === 'month') return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
    const { start, end } = rangeFor(date, mode);
    const key = dayKey(today);
    return key >= dayKey(start) && key <= dayKey(end);
};

/** The populated customer on an item, or null when it is only an id. */
export const customerOf = (item: PlannerItem) => (item.customerId && typeof item.customerId === 'object' ? item.customerId : null);

export const customerName = (item: PlannerItem) =>
    customerOf(item)?.company || customerOf(item)?.contactName || 'Unknown';

/**
 * What the schedule form opens with. A new activity opens on the day you
 * clicked, or on today / tomorrow after 6 PM when you came from the New button,
 * at the first free start (the form works that out); an existing stop opens
 * with its own day, start, length, type and notes.
 */
export const initialFor = (item: PlannerItem | null, day: Date | null, now: Date = new Date()): ScheduleInitial => {
    if (!item) return { date: day ? dayKey(day) : defaultVisitDate(now), start: null, minutes: DEFAULT_VISIT_MINUTES };
    const start = minutesOf(item.startTime);
    const end = minutesOf(item.endTime);
    return {
        customerId: customerOf(item)?._id || (item.customerId as string) || '',
        date: dayKey(new Date(item.startTime)),
        start: start === null ? null : timeText(start),
        minutes: start !== null && end !== null && end > start ? end - start : DEFAULT_VISIT_MINUTES,
        activityType: item.activityType || 'Visit',
        notes: item.notes || ''
    };
};

/** An entry as a row of "already booked" for the form. Cancelled ones don't count. */
export const bookedRowOf = (item: PlannerItem): BookedRow => ({
    id: String(item._id),
    customerId: String(customerOf(item)?._id || (typeof item.customerId === 'string' ? item.customerId : '') || ''),
    startTime: item.startTime,
    endTime: item.endTime,
    label: customerName(item)
});

/**
 * The span to fetch, which is not the same as the span to draw: week view
 * renders five columns but pulls all seven days, because the weekend rail can
 * only show what was asked for.
 */
export const rangeFor = (date: Date, mode: ViewMode) => {
    if (mode === 'day') {
        const s = startOfDay(date);
        return { start: s, end: s };
    }
    if (mode === 'week') {
        const s = mondayOf(date);
        return { start: s, end: addDays(s, 6) };
    }
    // Weeks run Monday to Sunday here as everywhere else (WEEK_STARTS_ON).
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return {
        start: mondayOf(first),
        end: addDays(mondayOf(last), 6)
    };
};

/** One pass over the response instead of a filter per day per render. */
export const groupByDay = (items: PlannerItem[] | null | undefined) => {
    const map = new Map<string, PlannerItem[]>();
    for (const item of items || []) {
        const d = new Date(item.startTime);
        if (Number.isNaN(d.getTime())) continue;
        const key = dayKey(d);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(item);
    }
    for (const list of map.values()) {
        list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }
    return map;
};

/** Monday to Friday of the week `date` is in. */
export const weekdaysOf = (date: Date) => {
    const s = mondayOf(date);
    return [0, 1, 2, 3, 4].map(i => addDays(s, i));
};

/** Saturday and Sunday of the week `date` is in. */
export const weekendOf = (date: Date) => {
    const s = mondayOf(date);
    return [addDays(s, 5), addDays(s, 6)];
};

/** The month view's rows, seven days each, from `start` to `end`. */
export const weeksBetween = (start: Date, end: Date) => {
    const weeks: Date[][] = [];
    let cursor = new Date(start);
    while (cursor <= end) {
        weeks.push([0, 1, 2, 3, 4, 5, 6].map(i => addDays(cursor, i)));
        cursor = addDays(cursor, 7);
    }
    return weeks;
};

/** The Day view's title on a phone, where the long form doesn't fit between the arrows: 'Thu, Oct 29'. */
export const shortDayTitle = (date: Date) =>
    date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/** The toolbar's title: the day, the week's span, or the month. */
export const titleFor = (viewMode: ViewMode, currentDate: Date) => {
    if (viewMode === 'day') {
        return currentDate.toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
        });
    }
    if (viewMode === 'week') {
        const a = weekdaysOf(currentDate)[0];
        const b = weekendOf(currentDate)[1];
        const sameMonth = a.getMonth() === b.getMonth();
        const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const right = sameMonth
            ? `${b.getDate()}, ${b.getFullYear()}`
            : b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return `${left} – ${right}`;
    }
    return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export const addLabel = (day: Date) =>
    `Schedule an activity on ${day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`;

/**
 * 'Completed'/'linkedVisitId' only get set once an actual visit is logged
 * against this stop (see the Add Visit handler in server.ts) — everything
 * else just sits at the 'Scheduled' default whether or not it happened.
 * A 'Scheduled' stop whose day has already passed reads as missed rather
 * than silently staying indistinguishable from one still coming up.
 */
export const visitFlag = (item: PlannerItem, now: Date = new Date()): 'done' | 'missed' | null => {
    if (item.status === 'Completed') return 'done';
    if (item.status === 'Scheduled' && dayKey(new Date(item.startTime)) < dayKey(now)) return 'missed';
    return null;
};

/** What an aim will actually do, in a sentence, for the live region. */
export const describeAim = (item: PlannerItem, day: Date, items: PlannerItem[], gap: number | null) => {
    const where = day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    if (gap === null) return `${where}, keeping ${timeLabel(item.startTime)}.`;
    const minutes = aimedMinutes(items, item._id, gap);
    if (minutes === 'stays') return `${where}, where it already is.`;
    return minutes === null
        ? `${where}, keeping ${timeLabel(item.startTime)}.`
        : `${where}, ${timeLabel(atMinutes(day, minutes))}.`;
};
