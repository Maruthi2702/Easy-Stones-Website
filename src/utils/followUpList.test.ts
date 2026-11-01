import { describe, it, expect } from 'vitest';
import {
    DEFAULT_FOLLOW_UP_FILTERS, dueDayOf, followUpState, dueBucketOf, doneOnTime, rangeBounds, followUpsInView, withStatus, withDue,
    followUpCounts, doneThisWeek, searchFollowUps, sortFollowUps, groupFollowUps, pageOfGroups, shortDay, whenText, snoozeChoices,
    followUpTags, withoutTag, followUpExportRows, followUpUpdate, snoozesOf, firstDueOf, snoozeText
} from './followUpList';
import type { FollowUpRow } from './followUpList';

// Saturday; this week (Monday first) is Oct 26 – Nov 1, last week Oct 19 – 25.
const TODAY = '2026-10-31';
const fu = (over: FollowUpRow = {}): FollowUpRow => ({ _id: Math.random().toString(36).slice(2), date: '2026-10-01', followUp: 'Call back', ...over });
const done = (doneOn: string, over: FollowUpRow = {}): FollowUpRow => fu({ followUpDoneAt: `${doneOn}T10:00:00.000`, followUpDoneOn: doneOn, ...over });

describe('due day and state', () => {
    it('is due on its follow-up date, else the visit day', () => {
        expect(dueDayOf(fu({ followUpDate: '2026-11-03' }))).toBe('2026-11-03');
        expect(dueDayOf(fu({ followUpDate: '' }))).toBe('2026-10-01');
        expect(dueDayOf(fu({ date: '', followUpDate: '' }))).toBe('');
    });
    it('is done, overdue or pending', () => {
        expect(followUpState(done('2026-10-30'), TODAY)).toBe('done');
        expect(followUpState(fu({ followUpDate: '2026-10-30' }), TODAY)).toBe('overdue');
        expect(followUpState(fu({ followUpDate: TODAY }), TODAY)).toBe('pending');
    });
    it('sorts pending ones into overdue / today / next 7 days / later', () => {
        expect(dueBucketOf(fu({ followUpDate: '2026-10-30' }), TODAY)).toBe('overdue');
        expect(dueBucketOf(fu({ followUpDate: TODAY }), TODAY)).toBe('today');
        expect(dueBucketOf(fu({ followUpDate: '2026-11-07' }), TODAY)).toBe('next7');
        expect(dueBucketOf(fu({ followUpDate: '2026-11-08' }), TODAY)).toBe('later');
    });
    it('is on time when ticked on or before the due day', () => {
        expect(doneOnTime(done('2026-10-24', { followUpDate: '2026-10-24' }))).toBe(true);
        expect(doneOnTime(done('2026-10-28', { followUpDate: '2026-10-24' }))).toBe(false);
    });
});

describe('the Date range', () => {
    it('counts back from today, today included', () => {
        expect(rangeBounds('7days', TODAY)).toEqual({ start: '2026-10-25', end: TODAY });
        expect(rangeBounds('90days', TODAY)).toEqual({ start: '2026-08-03', end: TODAY });
        expect(rangeBounds('year', TODAY)).toEqual({ start: '2026-01-01', end: TODAY });
        expect(rangeBounds('1day', TODAY)).toEqual({ start: TODAY, end: TODAY });
        expect(rangeBounds('all', TODAY)).toBeNull();
    });
    it('takes a custom range either way round, or half open', () => {
        expect(rangeBounds('custom', TODAY, '2026-10-20', '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-10-20' });
        expect(rangeBounds('custom', TODAY, '2026-10-01', '')).toEqual({ start: '2026-10-01', end: '' });
        expect(rangeBounds('custom', TODAY, 'junk', '')).toBeNull();
    });
    const rows = [
        fu({ followUpDate: '2026-08-02' }),
        done('2026-08-01', { followUpDate: '2026-07-30' }),
        fu({ followUpDate: '2026-08-03' }),
        done('2026-10-30', { followUpDate: '2026-10-29' }),
        fu({ followUpDate: TODAY }),
        fu({ followUpDate: '2026-11-02' }),
        fu({ followUp: '', followUpDate: '' })
    ];
    const q = (range: Parameters<typeof rangeBounds>[0]) => ({ range, from: '', to: '' });
    it('lists by due day only, done or not, never a visit with no follow-up', () => {
        // 90 days back from Oct 31 starts Aug 3: the one due Aug 2 drops off, overdue or not.
        expect(followUpsInView(rows, q('90days'), TODAY).map(dueDayOf)).toEqual(['2026-08-03', '2026-10-29', TODAY]);
        expect(followUpsInView(rows, q('7days'), TODAY).map(dueDayOf)).toEqual(['2026-10-29', TODAY]);
        expect(followUpsInView(rows, q('all'), TODAY)).toHaveLength(6);
    });
    it('Today is due today and every day after; looking back never lists upcoming ones', () => {
        expect(followUpsInView(rows, q('1day'), TODAY).map(dueDayOf)).toEqual([TODAY, '2026-11-02']);
        expect(followUpsInView(rows, q('30days'), TODAY).map(dueDayOf)).not.toContain('2026-11-02');
        expect(followUpsInView([done(TODAY, { followUpDate: '2026-11-05' })], q('1day'), TODAY)).toHaveLength(1);
    });
    it('goes by the day it was due, not the day it was ticked', () => {
        const tickedToday = done(TODAY, { followUpDate: '2026-10-20' });
        expect(followUpsInView([tickedToday], q('1day'), TODAY)).toHaveLength(0);
        expect(followUpsInView([tickedToday], q('7days'), TODAY)).toHaveLength(0);
        expect(followUpsInView([tickedToday], q('30days'), TODAY)).toHaveLength(1);
    });
    it('a Custom range is the ones due in it', () => {
        expect(followUpsInView(rows, { range: 'custom', from: '2026-10-01', to: '2026-11-30' }, TODAY).map(dueDayOf)).toEqual(['2026-10-29', TODAY, '2026-11-02']);
    });
});

describe('status, due and counts', () => {
    const rows = [
        done('2026-10-30', { followUpDate: '2026-10-29' }),
        done('2026-10-20', { followUpDate: '2026-10-24' }),
        fu({ followUpDate: '2026-10-28' }),
        fu({ followUpDate: TODAY }),
        fu({ followUpDate: '2026-11-03' }),
        fu({ followUpDate: '2026-12-01' })
    ];
    it('filters by status and by when it is due', () => {
        expect(withStatus(rows, 'done')).toHaveLength(2);
        expect(withStatus(rows, 'pending')).toHaveLength(4);
        expect(withStatus(rows, 'all')).toHaveLength(6);
        expect(withDue(rows, 'overdue', TODAY)).toHaveLength(1);
        expect(withDue(rows, 'later', TODAY)).toHaveLength(1);
    });
    it('totals what the tiles show', () => {
        expect(followUpCounts(rows, TODAY)).toEqual({ all: 6, done: 2, doneOnTime: 1, pending: 4, overdue: 1, today: 1, next7: 1, later: 1 });
    });
    it('counts the ones ticked done this week', () => {
        expect(doneThisWeek(rows, TODAY)).toBe(1);
    });
    it('searches customer, note, what happened and rep', () => {
        const list = [fu({ company: 'Harbor Design' }), fu({ followUp: 'quartz quote' }), done('2026-10-30', { followUpOutcome: 'Won the bid' }), fu({ createdByName: 'Maya R.' })];
        expect(searchFollowUps(list, 'harbor')).toHaveLength(1);
        expect(searchFollowUps(list, 'QUARTZ')).toHaveLength(1);
        expect(searchFollowUps(list, 'won')).toHaveLength(1);
        expect(searchFollowUps(list, 'maya')).toHaveLength(1);
        expect(searchFollowUps(list, ' ')).toHaveLength(4);
    });
});

describe('order and headings', () => {
    it('lists pending soonest first, grouped Overdue / Today / Next 7 days / Later', () => {
        const rows = sortFollowUps([
            fu({ followUpDate: '2026-11-20' }), fu({ followUpDate: TODAY }), fu({ followUpDate: '2026-10-24' }), fu({ followUpDate: '2026-11-02' }), fu({ followUpDate: '2026-10-28' })
        ], 'pending', TODAY);
        expect(rows.map(dueDayOf)).toEqual(['2026-10-24', '2026-10-28', TODAY, '2026-11-02', '2026-11-20']);
        const groups = groupFollowUps(rows, 'pending', TODAY);
        expect(groups.map((g) => [g.label, g.rows.length, g.late])).toEqual([
            ['Overdue', 2, true], ['Today', 1, false], ['Next 7 days', 1, false], ['Later', 1, false]
        ]);
    });
    it('lists done ones last ticked first: This week, Last week, then by month', () => {
        const rows = sortFollowUps([done('2026-09-12'), done('2026-10-30'), done('2026-10-21'), done('2026-10-27')], 'done', TODAY);
        const groups = groupFollowUps(rows, 'done', TODAY);
        expect(groups.map((g) => [g.label, g.rows.length])).toEqual([['This week', 2], ['Last week', 1], ['September 2026', 1]]);
    });
    it('lists Status: All today and upcoming soonest first, then the past newest first, counting done and pending', () => {
        const rows = sortFollowUps([
            fu({ followUpDate: '2026-10-28' }), fu({ followUpDate: '2026-11-20' }), done('2026-10-30', { followUpDate: '2026-10-29' }),
            fu({ followUpDate: '2026-09-15' }), done(TODAY, { followUpDate: TODAY }), fu({ followUpDate: '2026-11-02' }), fu({ followUpDate: '2026-10-21' })
        ], 'all', TODAY);
        expect(rows.map(dueDayOf)).toEqual([TODAY, '2026-11-02', '2026-11-20', '2026-10-29', '2026-10-28', '2026-10-21', '2026-09-15']);
        const groups = groupFollowUps(rows, 'all', TODAY);
        expect(groups.map((g) => [g.label, g.done, g.pending])).toEqual([
            ['Today', 1, 0], ['Next 7 days', 0, 1], ['Later', 0, 1], ['Earlier this week', 1, 1], ['Last week', 0, 1], ['September 2026', 0, 1]
        ]);
        expect(groups.some((g) => g.late)).toBe(false);
    });
    it('cuts a page out of the groups, each heading keeping its full count', () => {
        const rows = sortFollowUps(Array.from({ length: 5 }, (_, i) => fu({ followUpDate: `2026-10-2${i}` })).concat([fu({ followUpDate: TODAY }), fu({ followUpDate: TODAY })]), 'pending', TODAY);
        const groups = groupFollowUps(rows, 'pending', TODAY);
        const page2 = pageOfGroups(groups, 2, 4);
        expect(page2.map((g) => [g.label, g.rows.length, g.total])).toEqual([['Overdue', 1, 5], ['Today', 2, 2]]);
        expect(pageOfGroups(groups, 3, 4)).toEqual([]);
    });
});

describe('words', () => {
    it('writes a short day, with the year only when it is another year', () => {
        expect(shortDay('2026-10-24', TODAY)).toBe('Oct 24');
        expect(shortDay('2025-12-03', TODAY)).toBe('Dec 3, 2025');
        expect(shortDay('', TODAY)).toBe('—');
    });
    it('says how late or soon it is', () => {
        expect(whenText(fu({ followUpDate: '2026-10-24' }), TODAY)).toBe('7 days late');
        expect(whenText(fu({ followUpDate: '2026-10-30' }), TODAY)).toBe('Yesterday');
        expect(whenText(fu({ followUpDate: TODAY }), TODAY)).toBe('Today');
        expect(whenText(fu({ followUpDate: '2026-11-01' }), TODAY)).toBe('Tomorrow');
        expect(whenText(fu({ followUpDate: '2026-11-03' }), TODAY)).toBe('Tuesday');
        expect(whenText(fu({ followUpDate: '2026-11-20' }), TODAY)).toBe('');
        expect(whenText(done('2026-10-28', { followUpDate: '2026-10-24' }), TODAY)).toBe('4 days late');
        expect(whenText(done('2026-10-24', { followUpDate: '2026-10-24' }), TODAY)).toBe('On time');
    });
    it('offers tomorrow, Monday and next week to snooze to', () => {
        expect(snoozeChoices(TODAY)).toEqual([
            { label: 'Tomorrow', value: '2026-11-01' }, { label: 'Monday', value: '2026-11-02' }, { label: 'Next week', value: '2026-11-07' }
        ]);
    });
    it('shows a tag for each filter off its default, and removes it', () => {
        expect(followUpTags(DEFAULT_FOLLOW_UP_FILTERS)).toEqual([]);
        expect(DEFAULT_FOLLOW_UP_FILTERS.status).toBe('all');
        expect(followUpTags({ status: 'done', due: 'all' }).map((t) => t.label)).toEqual(['Status: Done']);
        expect(followUpTags({ status: 'pending', due: 'overdue' }).map((t) => t.label)).toEqual(['Status: Pending', 'Due: Overdue']);
        expect(withoutTag({ status: 'done', due: 'all' }, 'status').status).toBe('all');
        expect(withoutTag({ status: 'pending', due: 'today' }, 'due').due).toBe('all');
    });
    it('keeps the snoozes: how many, and the day it was first due', () => {
        const snoozed = fu({ followUpDate: '2026-11-09', followUpHistory: [
            { action: 'snooze', at: 'x', on: '2026-10-24', by: 'u1', byName: 'Rita', from: '2026-10-24', to: '2026-11-02' },
            { action: 'done', at: 'x', on: '2026-10-30', by: 'u1', byName: 'Rita' },
            { action: 'snooze', at: 'x', on: '2026-11-01', by: 'u1', byName: 'Rita', from: '2026-11-02', to: '2026-11-09' }
        ] });
        expect(snoozesOf(snoozed)).toHaveLength(2);
        expect(firstDueOf(snoozed)).toBe('2026-10-24');
        expect(snoozeText(snoozed, TODAY)).toBe('Snoozed 2× · first due Oct 24');
        expect(snoozeText(fu({ followUpDate: '2026-11-02', followUpHistory: [snoozed.followUpHistory![0]] }), TODAY)).toBe('Snoozed from Oct 24');
        expect(snoozeText(fu(), TODAY)).toBe('');
        expect(firstDueOf(fu({ followUpDate: '2026-10-20' }))).toBe('2026-10-20');
    });
    it('exports status, days, who and what happened', () => {
        const [row] = followUpExportRows([done('2026-10-28', { followUpDate: '2026-10-24', company: 'Puget', contactName: 'Ann', followUpDoneByName: 'Rita', followUpOutcome: 'Won' })], TODAY);
        expect(row).toMatchObject({ Status: 'Done', Due: '2026-10-24', 'First due': '2026-10-24', 'Times snoozed': '0', 'Done on': '2026-10-28', 'Done by': 'Rita', Company: 'Puget', Contact: 'Ann', 'What happened': 'Won' });
    });
});

describe('what a tick, reopen, snooze or note writes', () => {
    const ctx = { now: '2026-10-31T09:00:00.000', today: TODAY, userId: 'u1', userName: 'Rita' };
    it('marks it done today (or on the day the screen says), by whom, with what happened', () => {
        const r = followUpUpdate(fu(), { action: 'done', outcome: '  Sent quote  ' }, ctx);
        expect(r).toEqual({
            ok: true,
            set: { followUpDoneAt: ctx.now, followUpDoneOn: TODAY, followUpDoneBy: 'u1', followUpDoneByName: 'Rita', followUpOutcome: 'Sent quote' },
            event: { action: 'done', at: ctx.now, on: TODAY, by: 'u1', byName: 'Rita' }
        });
        const r2 = followUpUpdate(fu(), { action: 'done', doneOn: '2026-10-30' }, ctx);
        expect(r2.ok && r2.set.followUpDoneOn).toBe('2026-10-30');
    });
    it('reopens by clearing every done field', () => {
        const r = followUpUpdate(done('2026-10-30'), { action: 'reopen' }, ctx);
        expect(r).toMatchObject({ ok: true, set: { followUpDoneAt: '', followUpDoneOn: '', followUpDoneBy: '', followUpDoneByName: '', followUpOutcome: '' }, event: { action: 'reopen', by: 'u1' } });
    });
    it('snoozes to a real day, today or later, and reopens it', () => {
        const r = followUpUpdate(done('2026-10-30', { followUpDate: '2026-10-24' }), { action: 'snooze', until: '2026-11-02' }, ctx);
        expect(r.ok && r.set).toMatchObject({ followUpDate: '2026-11-02', followUpDoneAt: '' });
        expect(r.ok && r.event).toEqual({ action: 'snooze', at: ctx.now, on: TODAY, by: 'u1', byName: 'Rita', from: '2026-10-24', to: '2026-11-02' });
        expect(followUpUpdate(fu(), { action: 'snooze', until: '2026-10-30' }, ctx)).toMatchObject({ ok: false, status: 400 });
        expect(followUpUpdate(fu(), { action: 'snooze', until: 'soon' }, ctx)).toMatchObject({ ok: false, status: 400 });
    });
    it('adds what happened only to a done one', () => {
        expect(followUpUpdate(done('2026-10-30'), { action: 'note', outcome: 'Won' }, ctx)).toEqual({ ok: true, set: { followUpOutcome: 'Won' } });
        expect(followUpUpdate(fu(), { action: 'note', outcome: 'Won' }, ctx)).toMatchObject({ ok: false, status: 400 });
    });
    it('refuses a visit with no follow-up, a missing visit, an unknown action and a long note', () => {
        expect(followUpUpdate(fu({ followUp: '', followUpDate: '' }), { action: 'done' }, ctx)).toMatchObject({ ok: false, status: 400 });
        expect(followUpUpdate(null, { action: 'done' }, ctx)).toMatchObject({ ok: false, status: 404 });
        expect(followUpUpdate(fu(), { action: 'archive' }, ctx)).toMatchObject({ ok: false, status: 400 });
        expect(followUpUpdate(fu(), { action: 'done', outcome: 'x'.repeat(1001) }, ctx)).toMatchObject({ ok: false, status: 400 });
    });
});
