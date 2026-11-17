import { describe, it, expect } from 'vitest';
import type { PlannerItem } from './plannerSchedule';
import {
    dayKey, localISO, weekStartOf, dayOffset, slotMinutes, aimedMinutes, planMove, gapsFor, dayFromKey,
    activityModifier, activityColor, customerName, initialFor, bookedRowOf, timeParts, shortDayTitle, durationText, lengthOf, relativeDayLabel, isCurrentPeriod, rangeFor, groupByDay,
    weekdaysOf, weekendOf, weekOf, weeksBetween, titleFor, visitFlag, describeAim, addLabel, daySummary, DAY_LOAD_FULL
} from './salesPlanner';

const stop = (id: string, startTime: string, o: Partial<PlannerItem> = {}): PlannerItem => ({ _id: id, startTime, ...o });
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe('days and spans', () => {
    it('keys a day and writes a local time with no zone', () => {
        expect(dayKey(day(2026, 3, 7))).toBe('2026-03-07');
        expect(localISO(new Date(2026, 9, 25, 9, 5, 30))).toBe('2026-10-25T09:05:30.000');
        expect(dayFromKey('2026-10-25').getTime()).toBe(day(2026, 10, 25).getTime());
    });

    it('starts the week on Sunday (WEEK_STARTS_ON)', () => {
        expect(dayKey(weekStartOf(day(2026, 10, 25)))).toBe('2026-10-25'); // a Sunday starts its week
        expect(dayKey(weekStartOf(day(2026, 10, 24)))).toBe('2026-10-18'); // a Saturday ends it
        expect(weekOf(day(2026, 10, 22)).map(dayKey)).toEqual(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
        expect(weekdaysOf(day(2026, 10, 22)).map(dayKey)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
        expect(weekendOf(day(2026, 10, 22)).map(dayKey)).toEqual(['2026-10-18', '2026-10-24']);
    });

    it('fetches the day, all seven days of the week, or whole weeks around the month', () => {
        const at = day(2026, 10, 22);
        const span = (m: 'day' | 'week' | 'month') => { const r = rangeFor(at, m); return [dayKey(r.start), dayKey(r.end)]; };
        expect(span('day')).toEqual(['2026-10-22', '2026-10-22']);
        expect(span('week')).toEqual(['2026-10-18', '2026-10-24']);
        expect(span('month')).toEqual(['2026-09-27', '2026-10-31']);
        const r = rangeFor(at, 'month');
        expect(weeksBetween(r.start, r.end)).toHaveLength(5);
    });

    it('counts whole days across a clock change', () => {
        expect(dayOffset(new Date(2026, 10, 1, 9), new Date(2026, 10, 2, 8))).toBe(1); // DST ends 2026-11-01 in the US
        expect(dayOffset(day(2026, 10, 25), day(2026, 10, 19))).toBe(-6);
    });

    it('titles each view', () => {
        expect(titleFor('week', day(2026, 10, 22))).toBe('Oct 18 – 24, 2026');
        expect(titleFor('week', day(2026, 9, 30))).toBe('Sep 27 – Oct 3, 2026');
        expect(titleFor('month', day(2026, 10, 22))).toBe('October 2026');
        expect(titleFor('day', day(2026, 10, 22))).toBe('Thursday, October 22, 2026');
        expect(addLabel(day(2026, 10, 22))).toBe('Schedule an activity on Thursday, Oct 22');
    });
});

describe('where a dropped stop lands', () => {
    const nine = stop('a', '2026-10-22T09:00:00.000');
    const eleven = stop('b', '2026-10-22T11:00:00.000');

    it('takes the middle of a gap, half an hour outside the ends, or keeps its time', () => {
        expect(slotMinutes([nine, eleven], 1)).toBe(10 * 60);
        expect(slotMinutes([nine, eleven], 0)).toBe(8 * 60 + 30);
        expect(slotMinutes([nine, eleven], 2)).toBe(11 * 60 + 30);
        expect(slotMinutes([nine, eleven], null)).toBeNull();
        expect(slotMinutes([], 0)).toBeNull();
    });

    it('keeps the exact minute in a gap too tight to round', () => {
        const a = stop('a', '2026-10-22T09:00:00.000');
        const b = stop('b', '2026-10-22T09:03:00.000');
        expect(slotMinutes([a, b], 1)).toBe(9 * 60 + 1);
    });

    it('either gap beside the stop itself means stay', () => {
        expect(aimedMinutes([nine, eleven], 'a', 0)).toBe('stays');
        expect(aimedMinutes([nine, eleven], 'a', 1)).toBe('stays');
        // Below itself counts the stop, so gap 2 is after 11:00.
        expect(aimedMinutes([nine, eleven], 'a', 2)).toBe(11 * 60 + 30);
    });

    it('moves the day and keeps the time on the open end of a column, carrying the length', () => {
        const item = stop('x', '2026-10-21T14:00:00.000', { endTime: '2026-10-21T14:45:00.000' });
        const plan = planMove(item, day(2026, 10, 22), [nine, eleven], null);
        expect(plan?.patch).toEqual({ startTime: '2026-10-22T14:00:00.000', endTime: '2026-10-22T14:45:00.000' });
    });

    it('fits the time to the gap it was aimed at', () => {
        const item = stop('x', '2026-10-21T14:00:00.000');
        expect(planMove(item, day(2026, 10, 22), [nine, eleven], 1)?.patch).toEqual({ startTime: '2026-10-22T10:00:00.000' });
    });

    it('does nothing when nothing would change', () => {
        expect(planMove(nine, day(2026, 10, 22), [nine, eleven], null)).toBeNull();
        expect(planMove(nine, day(2026, 10, 22), [nine, eleven], 1)).toBeNull();
        expect(planMove(stop('bad', 'not a date'), day(2026, 10, 22), [], null)).toBeNull();
    });

    it('walks the keyboard aims: keep the time, then each gap', () => {
        expect(gapsFor(2)).toEqual([null, 0, 1, 2]);
        expect(gapsFor(0)).toEqual([null, 0]);
    });

    it('says what an aim will do', () => {
        const item = stop('x', '2026-10-21T14:00:00.000');
        const at = day(2026, 10, 22);
        expect(describeAim(item, at, [nine, eleven], null)).toMatch(/^Thursday, Oct 22, keeping 2:00/);
        expect(describeAim(item, at, [nine, eleven], 1)).toMatch(/^Thursday, Oct 22, 10:00/);
        expect(describeAim(nine, at, [nine, eleven], 0)).toBe('Thursday, Oct 22, where it already is.');
    });
});

describe('cards and the form', () => {
    it('names the customer, populated or not', () => {
        expect(customerName(stop('a', '', { customerId: { _id: 'c1', company: 'Pacific Granite' } }))).toBe('Pacific Granite');
        expect(customerName(stop('a', '', { customerId: { _id: 'c1', contactName: 'Vlad' } }))).toBe('Vlad');
        expect(customerName(stop('a', '', { customerId: 'c1' }))).toBe('Unknown');
        expect(customerName(stop('a', ''))).toBe('Unknown');
    });

    it('colours and classes by activity type, Visit by default', () => {
        expect(activityModifier('Drop-off')).toBe('dropoff');
        expect(activityModifier(undefined)).toBe('visit');
        expect(activityColor('Call')).toBe('#3b82f6');
        expect(activityColor('Lunch')).toBe('#94a3b8');
    });

    it('flags visited stops and missed ones', () => {
        const now = day(2026, 10, 25);
        expect(visitFlag(stop('a', '2026-10-20T09:00:00.000', { status: 'Completed' }), now)).toBe('done');
        expect(visitFlag(stop('a', '2026-10-24T09:00:00.000', { status: 'Scheduled' }), now)).toBe('missed');
        expect(visitFlag(stop('a', '2026-10-25T09:00:00.000', { status: 'Scheduled' }), now)).toBeNull();
    });

    it('opens a new stop on the day clicked, with the first free start left to the form', () => {
        expect(initialFor(null, day(2030, 1, 2))).toEqual({ date: '2030-01-02', start: null, minutes: 30 });
    });

    it('opens a new stop from the New button on today, or tomorrow from 6 PM', () => {
        expect(initialFor(null, null, new Date(2026, 9, 29, 10, 0)).date).toBe('2026-10-29');
        expect(initialFor(null, null, new Date(2026, 9, 29, 18, 0)).date).toBe('2026-10-30');
    });

    it('opens the edit form with the stop as it is, its length from its end', () => {
        expect(initialFor(stop('a', '2026-10-22T09:00:00.000', { customerId: { _id: 'c1' }, notes: 'Bring samples', endTime: '2026-10-22T10:00:00.000' }), null))
            .toEqual({ customerId: 'c1', date: '2026-10-22', start: '09:00', minutes: 60, activityType: 'Visit', notes: 'Bring samples' });
        expect(initialFor(stop('a', '2026-10-22T09:00:00.000', { customerId: 'c2', activityType: 'Call' }), null))
            .toMatchObject({ customerId: 'c2', minutes: 30, activityType: 'Call' });
    });

    it('turns a stop into a row of "already booked"', () => {
        expect(bookedRowOf(stop('a', '2026-10-22T09:00:00.000', { customerId: { _id: 'c1', company: 'Pacific Granite' } })))
            .toEqual({ id: 'a', customerId: 'c1', startTime: '2026-10-22T09:00:00.000', endTime: undefined, label: 'Pacific Granite' });
    });

    it('groups by day in time order and skips unreadable times', () => {
        const map = groupByDay([stop('b', '2026-10-22T11:00:00.000'), stop('a', '2026-10-22T09:00:00.000'), stop('z', 'nope')]);
        expect([...map.keys()]).toEqual(['2026-10-22']);
        expect(map.get('2026-10-22')!.map(i => i._id)).toEqual(['a', 'b']);
    });
});

describe('the phone Day view', () => {
    it('splits a time for the card\'s time column', () => {
        expect(timeParts(new Date(2026, 9, 29, 9, 0))).toEqual({ clock: '9:00', period: 'AM' });
        expect(timeParts(new Date(2026, 9, 29, 13, 5))).toEqual({ clock: '1:05', period: 'PM' });
    });

    it('shortens the Day title for a phone', () => {
        expect(shortDayTitle(day(2026, 10, 29))).toBe('Thu, Oct 29');
    });

    it('names a length', () => {
        expect(durationText(15)).toBe('15 min');
        expect(durationText(60)).toBe('1 hr');
        expect(durationText(90)).toBe('1½ hr');
        expect(durationText(120)).toBe('2 hr');
        expect(durationText(50)).toBe('50 min');
    });

    it('shows a stop\'s length only when it saved an end', () => {
        expect(lengthOf(stop('a', '2026-10-22T09:00:00.000', { endTime: '2026-10-22T09:30:00.000' }))).toBe('30 min');
        expect(lengthOf(stop('a', '2026-10-22T09:00:00.000'))).toBe('');
        expect(lengthOf(stop('a', '2026-10-22T09:00:00.000', { endTime: '2026-10-22T08:00:00.000' }))).toBe('');
    });

    it('says today, tomorrow and yesterday, and nothing for other days', () => {
        const today = day(2026, 10, 29);
        expect(relativeDayLabel(day(2026, 10, 29), today)).toBe('Today');
        expect(relativeDayLabel(day(2026, 10, 30), today)).toBe('Tomorrow');
        expect(relativeDayLabel(day(2026, 10, 28), today)).toBe('Yesterday');
        expect(relativeDayLabel(day(2026, 11, 3), today)).toBeNull();
    });

    it('knows when the period on screen holds today', () => {
        const today = day(2026, 10, 29);
        expect(isCurrentPeriod(day(2026, 10, 29), 'day', today)).toBe(true);
        expect(isCurrentPeriod(day(2026, 10, 30), 'day', today)).toBe(false);
        expect(isCurrentPeriod(day(2026, 10, 26), 'week', today)).toBe(true);
        expect(isCurrentPeriod(day(2026, 11, 2), 'week', today)).toBe(false);
        expect(isCurrentPeriod(day(2026, 10, 1), 'month', today)).toBe(true);
        expect(isCurrentPeriod(day(2026, 11, 1), 'month', today)).toBe(false);
    });
});

describe('daySummary', () => {
    const at = (time: string, end?: string) => ({ startTime: `2026-11-18T${time}:00.000`, ...(end ? { endTime: `2026-11-18T${end}:00.000` } : {}) });
    it('says nothing about an empty day', () => {
        expect(daySummary([])).toEqual({ count: 0, span: '', fill: 0 });
    });
    it('gives the first start to the last end, whatever the order, and how full the day is', () => {
        const s = daySummary([at('13:00', '13:15'), at('09:30', '09:45'), at('11:00')]);
        expect(s.count).toBe(3);
        expect(s.span).toMatch(/9:30.*1:15/);
        expect(s.fill).toBe(Math.round((3 / DAY_LOAD_FULL) * 100));
    });
    it('is just the time for one stop and caps the bar at full', () => {
        expect(daySummary([at('14:16')]).span).toMatch(/2:16/);
        expect(daySummary([at('14:16')]).span).not.toMatch(/–/);
        expect(daySummary(Array.from({ length: 30 }, (_, i) => at(`${String(8 + (i % 10)).padStart(2, '0')}:00`))).fill).toBe(100);
    });
});
