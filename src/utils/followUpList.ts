/*
 * Dashboard → Follow-ups (design A · Due list on the claude.ai artifact
 * "Follow-ups redesign canvas", https://claude.ai/artifact/5x7prJdkNJAKcViVbzeTbK):
 * which follow-ups a view holds, how they're sorted and grouped, what the
 * totals say, and what ticking one done / reopening / snoozing it writes.
 * Shared: GET /api/dashboard/followups (server.js) and the PATCH in
 * src/routes/visits.js run the same rules the screen does.
 *
 * A follow-up is a visit's `followUp` note and `followUpDate`. Its due day is
 * the follow-up date, else the visit's own day (as the Visits tab's panel,
 * followUpPanel.js). Done is `followUpDoneAt` (when), `followUpDoneOn` (the
 * day, on the clock of whoever ticked it), who, and an optional "what
 * happened" (`followUpOutcome`). Every snooze, tick and reopen is also kept
 * in `followUpHistory` (who, when, and a snooze's old and new day). Days are
 * compared as YYYY-MM-DD strings — never Dates — so a day is the same day for
 * everyone.
 *
 * The date range is the dashboard's own (its header, every tab; owner's call
 * 2026-10-31): a follow-up is in it by its due day, and one still overdue is
 * always listed whatever the range, so unfinished work never drops off. The
 * totals count only the ones due in the range.
 */
import { MONTH_NAMES, MONTH_SHORT, isValidISO, nextWeekday, shiftDay, weekBounds } from '../components/shared/calendar/calendarDates.ts';
import { dayOf as dayOfLoose } from './followUpPanel.ts';
import type { Loose } from '../types/records.ts';

const dayOf = (value: unknown): string => dayOfLoose(value as Loose);

/** A row of GET /api/dashboard/followups (a visit with its customer's name). */
export type FollowUpRow = {
    _id?: string;
    customerId?: string;
    date?: unknown;
    followUp?: string;
    nextAction?: string;
    followUpDate?: unknown;
    followUpDoneAt?: string;
    followUpDoneOn?: string;
    followUpDoneBy?: string;
    followUpDoneByName?: string;
    followUpOutcome?: string;
    followUpHistory?: FollowUpEvent[];
    company?: string;
    contactName?: string;
    customerName?: string;
    createdBy?: unknown;
    createdByName?: string;
    location?: string;
    city?: string;
    phone?: string;
    purpose?: string;
    [key: string]: unknown;
};

/** One line of a follow-up's record: a snooze (from → to), a tick or a reopen. */
export type FollowUpEvent = { action: 'snooze' | 'done' | 'reopen'; at: string; on: string; by: string; byName: string; from?: string; to?: string };

export type FollowUpStatus = 'pending' | 'done' | 'all';
/** The dashboard's time range ids (dashboardFocus.ts's RANGES). */
export type FollowUpRange = '1day' | '7days' | '30days' | '90days' | 'year' | 'all' | 'custom';
export const FOLLOW_UP_RANGE_IDS: FollowUpRange[] = ['1day', '7days', '30days', '90days', 'year', 'all', 'custom'];
/** The range and, for Custom, its days. */
export type FollowUpRangeQuery = { range: FollowUpRange; from: string; to: string };
export type DueBucket = 'all' | 'overdue' | 'today' | 'next7' | 'later';
export type FollowUpState = 'done' | 'overdue' | 'pending';

/** The page's own filters (the range is the dashboard's). */
export type FollowUpFilters = { status: FollowUpStatus; due: DueBucket };

/** What the page opens on: what's still to do. */
export const DEFAULT_FOLLOW_UP_FILTERS: FollowUpFilters = Object.freeze({ status: 'pending', due: 'all' }) as FollowUpFilters;

export const FOLLOW_UP_STATUSES: { value: FollowUpStatus; label: string }[] = [
    { value: 'pending', label: 'Pending' },
    { value: 'done', label: 'Done' },
    { value: 'all', label: 'All' }
];

/** The ranges that look back over a period, which bring up the totals tiles (not Today, not All). */
export const rangeHasTotals = (range: FollowUpRange): boolean => ['7days', '30days', '90days', 'year', 'custom'].includes(range);

/** The Due field (pending follow-ups only). */
export const DUE_BUCKETS: { value: DueBucket; label: string }[] = [
    { value: 'all', label: 'All pending' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'today', label: 'Today' },
    { value: 'next7', label: 'Next 7 days' },
    { value: 'later', label: 'Later' }
];

const LAST_DAYS: Partial<Record<FollowUpRange, number>> = { '7days': 7, '30days': 30, '90days': 90 };

/** The longest "what happened" kept. */
export const FOLLOW_UP_OUTCOME_MAX = 1000;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const dayNumber = (day: string): number => {
    const [y, m, d] = day.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export const daysBetween = (a: string, b: string): number => dayNumber(b) - dayNumber(a);

/** The day it's due: its follow-up date, else the visit's day; '' when neither is a day. */
export const dueDayOf = (row: FollowUpRow): string => dayOf(row?.followUpDate) || dayOf(row?.date);
export const isFollowUpDone = (row: FollowUpRow): boolean => Boolean(text(row?.followUpDoneAt));
/** The day it was ticked done ('' while pending). */
export const doneDayOf = (row: FollowUpRow): string => (isFollowUpDone(row) ? (dayOf(row.followUpDoneOn) || dayOf(row.followUpDoneAt)) : '');
/** Whether a visit carries a follow-up at all (a note or a date). */
export const hasFollowUpFields = (row: FollowUpRow): boolean =>
    Boolean(text(row?.followUp) || text(row?.nextAction) || dayOf(row?.followUpDate));
export const followUpNote = (row: FollowUpRow): string => text(row?.followUp) || text(row?.nextAction);

export const followUpState = (row: FollowUpRow, today: string): FollowUpState => {
    if (isFollowUpDone(row)) return 'done';
    const due = dueDayOf(row);
    return due && due < today ? 'overdue' : 'pending';
};

/** Where a pending follow-up sits: overdue, today, the next 7 days, or later. */
export const dueBucketOf = (row: FollowUpRow, today: string): Exclude<DueBucket, 'all'> => {
    const due = dueDayOf(row);
    if (!due || due < today) return 'overdue';
    if (due === today) return 'today';
    return due <= shiftDay(today, 7) ? 'next7' : 'later';
};

/** Done on or before the day it was due. */
export const doneOnTime = (row: FollowUpRow): boolean => {
    const done = doneDayOf(row);
    const due = dueDayOf(row);
    return Boolean(done) && (!due || done <= due);
};

/** The first and last due day a Date range covers (either may be ''), or null for any time. */
export const rangeBounds = (range: FollowUpRange, today: string, from = '', to = ''): { start: string; end: string } | null => {
    if (range === '1day') return { start: today, end: today };
    const last = LAST_DAYS[range];
    if (last) return { start: shiftDay(today, 1 - last), end: today };
    if (range === 'year') return { start: `${today.slice(0, 4)}-01-01`, end: today };
    if (range === 'custom') {
        const a = isValidISO(from) ? from.slice(0, 10) : '';
        const b = isValidISO(to) ? to.slice(0, 10) : '';
        if (!a && !b) return null;
        return a && b && a > b ? { start: b, end: a } : { start: a, end: b };
    }
    return null;
};

const inBounds = (day: string, b: { start: string; end: string } | null): boolean =>
    !b || (Boolean(day) && (!b.start || day >= b.start) && (!b.end || day <= b.end));

/** The follow-ups due in the range — what the totals count. */
export const followUpsDueIn = (rows: FollowUpRow[], q: FollowUpRangeQuery, today: string): FollowUpRow[] => {
    const b = rangeBounds(q.range, today, q.from, q.to);
    return rows.filter((r) => r && hasFollowUpFields(r) && inBounds(dueDayOf(r), b));
};

/**
 * What the list holds for a range: the ones due in it, every one still
 * overdue, and every one ticked done in it (so Today + Done is what got done
 * today).
 */
export const followUpsInView = (rows: FollowUpRow[], q: FollowUpRangeQuery, today: string): FollowUpRow[] => {
    const b = rangeBounds(q.range, today, q.from, q.to);
    return rows.filter((r) => {
        if (!r || !hasFollowUpFields(r)) return false;
        const due = dueDayOf(r);
        if (inBounds(due, b)) return true;
        return isFollowUpDone(r) ? inBounds(doneDayOf(r), b) : Boolean(due) && due < today;
    });
};

/** A follow-up's snoozes, oldest first. */
export const snoozesOf = (row: FollowUpRow): FollowUpEvent[] =>
    (Array.isArray(row?.followUpHistory) ? row.followUpHistory.filter((e) => e?.action === 'snooze') : []);
/** The day it was first due, before any snooze. */
export const firstDueOf = (row: FollowUpRow): string => dayOf(snoozesOf(row)[0]?.from) || dueDayOf(row);
/** "Snoozed from Oct 24" / "Snoozed 3× · first due Oct 24", or '' when never snoozed. */
export const snoozeText = (row: FollowUpRow, today: string): string => {
    const n = snoozesOf(row).length;
    if (!n) return '';
    const first = shortDay(firstDueOf(row), today);
    return n === 1 ? `Snoozed from ${first}` : `Snoozed ${n}× · first due ${first}`;
};

export const withStatus = (rows: FollowUpRow[], status: FollowUpStatus): FollowUpRow[] =>
    (status === 'all' ? rows : rows.filter((r) => isFollowUpDone(r) === (status === 'done')));

export const withDue = (rows: FollowUpRow[], due: DueBucket, today: string): FollowUpRow[] =>
    (due === 'all' ? rows : rows.filter((r) => !isFollowUpDone(r) && dueBucketOf(r, today) === due));

export type FollowUpCounts = {
    all: number; done: number; doneOnTime: number; pending: number; overdue: number; today: number; next7: number; later: number;
};

/** The totals tiles and the Due field's counts. */
export const followUpCounts = (rows: FollowUpRow[], today: string): FollowUpCounts => {
    const c: FollowUpCounts = { all: 0, done: 0, doneOnTime: 0, pending: 0, overdue: 0, today: 0, next7: 0, later: 0 };
    for (const r of rows) {
        c.all++;
        if (isFollowUpDone(r)) {
            c.done++;
            if (doneOnTime(r)) c.doneOnTime++;
        } else {
            c.pending++;
            c[dueBucketOf(r, today)]++;
        }
    }
    return c;
};

/** Ticked done this week (Monday first, as the calendar). */
export const doneThisWeek = (rows: FollowUpRow[], today: string): number => {
    const week = weekBounds(today);
    if (!week) return 0;
    return rows.filter((r) => { const d = doneDayOf(r); return d >= week.start && d <= week.end; }).length;
};

const lower = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');
/** The search box: customer, note, what happened, rep, city, branch. */
export const searchFollowUps = (rows: FollowUpRow[], term: string): FollowUpRow[] => {
    const q = term.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.company, r.contactName, r.customerName, r.followUp, r.nextAction, r.followUpOutcome, r.createdByName, r.city, r.location]
        .some((v) => lower(v).includes(q)));
};

/** Pending: soonest due first (so overdue leads). Done: last ticked first. All: newest due first. */
export const sortFollowUps = (rows: FollowUpRow[], status: FollowUpStatus): FollowUpRow[] => {
    const copy = [...rows];
    if (status === 'pending') return copy.sort((a, b) => dueDayOf(a).localeCompare(dueDayOf(b)));
    if (status === 'done') {
        return copy.sort((a, b) => doneDayOf(b).localeCompare(doneDayOf(a))
            || text(b.followUpDoneAt).localeCompare(text(a.followUpDoneAt))
            || dueDayOf(b).localeCompare(dueDayOf(a)));
    }
    return copy.sort((a, b) => dueDayOf(b).localeCompare(dueDayOf(a)));
};

export type FollowUpGroup = {
    key: string;
    label: string;
    /** Red heading (Overdue). */
    late: boolean;
    rows: FollowUpRow[];
    /** For Status: All — how many of the group are done / pending. */
    done: number;
    pending: number;
};

const monthLabel = (day: string): string => (day ? `${MONTH_NAMES[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}` : 'No date');
const DUE_LABELS: Record<Exclude<DueBucket, 'all'>, string> = { overdue: 'Overdue', today: 'Today', next7: 'Next 7 days', later: 'Later' };

/**
 * Headings for a sorted list, in its order. Pending: Overdue / Today / Next 7
 * days / Later. Done: This week / Last week / then by month ticked. All: by
 * month due.
 */
export const groupFollowUps = (rows: FollowUpRow[], status: FollowUpStatus, today: string): FollowUpGroup[] => {
    const week = weekBounds(today);
    const lastWeek = weekBounds(shiftDay(today, -7));
    const keyOf = (r: FollowUpRow): [string, string, boolean] => {
        if (status === 'pending') {
            const b = dueBucketOf(r, today);
            return [b, DUE_LABELS[b], b === 'overdue'];
        }
        if (status === 'done') {
            const d = doneDayOf(r);
            if (week && d >= week.start && d <= week.end) return ['this-week', 'This week', false];
            if (lastWeek && d >= lastWeek.start && d <= lastWeek.end) return ['last-week', 'Last week', false];
            return [d.slice(0, 7) || 'none', monthLabel(d), false];
        }
        const due = dueDayOf(r);
        return [due.slice(0, 7) || 'none', monthLabel(due), false];
    };
    const groups: FollowUpGroup[] = [];
    for (const r of rows) {
        const [key, label, late] = keyOf(r);
        let g = groups[groups.length - 1];
        if (!g || g.key !== key) {
            g = groups.find((x) => x.key === key) || { key, label, late, rows: [], done: 0, pending: 0 };
            if (!groups.includes(g)) groups.push(g);
        }
        g.rows.push(r);
        if (isFollowUpDone(r)) g.done++; else g.pending++;
    }
    return groups;
};

/** One page of a grouped list: each group's rows on this page, its heading keeping the group's full count. */
export const pageOfGroups = (groups: FollowUpGroup[], page: number, perPage: number): (FollowUpGroup & { total: number })[] => {
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const out: (FollowUpGroup & { total: number })[] = [];
    let at = 0;
    for (const g of groups) {
        const from = Math.max(start, at);
        const to = Math.min(end, at + g.rows.length);
        if (from < to) out.push({ ...g, total: g.rows.length, rows: g.rows.slice(from - at, to - at) });
        at += g.rows.length;
        if (at >= end) break;
    }
    return out;
};

/** "Oct 24", with the year when it isn't this year's. */
export const shortDay = (day: string, today: string): string => {
    if (!day) return '—';
    const label = `${MONTH_SHORT[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
    return day.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${day.slice(0, 4)}`;
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * The line under the due date: "7 days late", "Yesterday", "Today",
 * "Tomorrow", a weekday in the coming week; for a done one "On time" or how
 * late it was ticked.
 */
export const whenText = (row: FollowUpRow, today: string): string => {
    const due = dueDayOf(row);
    if (!due) return '';
    if (isFollowUpDone(row)) {
        const late = daysBetween(due, doneDayOf(row));
        return late > 0 ? `${plural(late, 'day')} late` : 'On time';
    }
    const ahead = daysBetween(today, due);
    if (ahead === 0) return 'Today';
    if (ahead === -1) return 'Yesterday';
    if (ahead < 0) return `${plural(-ahead, 'day')} late`;
    if (ahead === 1) return 'Tomorrow';
    if (ahead < 7) return WEEKDAY_NAMES[new Date(dayNumber(due) * 86400000).getUTCDay()];
    return '';
};

/** Snooze's quick picks. */
export const snoozeChoices = (today: string): { label: string; value: string }[] => [
    { label: 'Tomorrow', value: shiftDay(today, 1) },
    { label: 'Monday', value: nextWeekday(today, 1) },
    { label: 'Next week', value: shiftDay(today, 7) }
];

/** Tags for what's switched on (the defaults show none). */
export const followUpTags = (f: FollowUpFilters): { key: 'status' | 'due'; label: string }[] => {
    const tags: { key: 'status' | 'due'; label: string }[] = [];
    if (f.status !== 'pending') tags.push({ key: 'status', label: `Status: ${FOLLOW_UP_STATUSES.find((s) => s.value === f.status)?.label}` });
    if (f.status === 'pending' && f.due !== 'all') tags.push({ key: 'due', label: `Due: ${DUE_LABELS[f.due]}` });
    return tags;
};

export const withoutTag = (f: FollowUpFilters, key: 'status' | 'due'): FollowUpFilters =>
    (key === 'status' ? { ...f, status: 'pending' } : { ...f, due: 'all' });

/** Excel rows for what's on screen. */
export const followUpExportRows = (rows: FollowUpRow[], today: string): Record<string, string>[] => rows.map((r) => {
    const state = followUpState(r, today);
    return {
        Status: state === 'done' ? 'Done' : state === 'overdue' ? 'Overdue' : 'Pending',
        Due: dueDayOf(r),
        'First due': firstDueOf(r),
        'Times snoozed': String(snoozesOf(r).length),
        'Done on': doneDayOf(r),
        'Done by': text(r.followUpDoneByName),
        Company: text(r.company) || text(r.customerName),
        Contact: text(r.company) ? text(r.contactName) : '',
        City: text(r.city),
        Location: text(r.location),
        'Follow-up': followUpNote(r),
        'What happened': text(r.followUpOutcome),
        Rep: text(r.createdByName),
        'Visit type': text(r.purpose),
        'Visit date': dayOf(r.date)
    };
});

export type FollowUpAction = 'done' | 'reopen' | 'snooze' | 'note';
/** What to write: fields to set and, for a snooze / tick / reopen, a line for the record. */
type Update = { ok: true; set: Record<string, string>; event?: FollowUpEvent } | { ok: false; status: number; message: string };
const DONE_FIELDS = ['followUpDoneAt', 'followUpDoneOn', 'followUpDoneBy', 'followUpDoneByName', 'followUpOutcome'] as const;
const cleared = (): Record<string, string> => Object.fromEntries(DONE_FIELDS.map((f) => [f, '']));

/**
 * What PATCH …/visits/:visitId/follow-up writes (field → value, on the visit).
 * `body` is the request's: { action, doneOn?, until?, outcome? }. `ctx` has
 * the server's clock and who is acting.
 */
export const followUpUpdate = (
    visit: FollowUpRow | null,
    body: { action?: unknown; doneOn?: unknown; until?: unknown; outcome?: unknown },
    ctx: { now: string; today: string; userId: string; userName: string }
): Update => {
    if (!visit) return { ok: false, status: 404, message: 'Customer or visit not found' };
    if (!hasFollowUpFields(visit)) return { ok: false, status: 400, message: 'This visit has no follow-up.' };
    const outcome = typeof body.outcome === 'string' ? body.outcome.trim() : '';
    const who = { at: ctx.now, on: ctx.today, by: ctx.userId, byName: ctx.userName };
    if (outcome.length > FOLLOW_UP_OUTCOME_MAX) return { ok: false, status: 400, message: `Keep "What happened" under ${FOLLOW_UP_OUTCOME_MAX} characters.` };
    switch (body.action) {
        case 'done': {
            const doneOn = isValidISO(body.doneOn) ? String(body.doneOn).slice(0, 10) : ctx.today;
            return {
                ok: true,
                set: { followUpDoneAt: ctx.now, followUpDoneOn: doneOn, followUpDoneBy: ctx.userId, followUpDoneByName: ctx.userName, followUpOutcome: outcome },
                event: { action: 'done', ...who, on: doneOn }
            };
        }
        case 'reopen':
            return { ok: true, set: cleared(), event: { action: 'reopen', ...who } };
        case 'snooze': {
            if (!isValidISO(body.until)) return { ok: false, status: 400, message: 'Pick the day to snooze it to.' };
            const until = String(body.until).slice(0, 10);
            if (until < ctx.today) return { ok: false, status: 400, message: 'Snooze it to today or a later day.' };
            return { ok: true, set: { ...cleared(), followUpDate: until }, event: { action: 'snooze', ...who, from: dueDayOf(visit), to: until } };
        }
        case 'note':
            if (!isFollowUpDone(visit)) return { ok: false, status: 400, message: 'Mark the follow-up done first.' };
            return { ok: true, set: { followUpOutcome: outcome } };
        default:
            return { ok: false, status: 400, message: 'Unknown follow-up action.' };
    }
};
