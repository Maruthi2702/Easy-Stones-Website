import { describe, it, expect } from 'vitest';
import { repBreakdown, repTotals, NOT_RECORDED } from './repBreakdown';

const people = [
    { value: 'me', id: 'me', label: 'Krish', location: 'Seattle', locations: ['Seattle'], inactive: false },
    { value: 'j', id: 'j', label: 'Jesus B.', location: 'Seattle', locations: ['Seattle'], inactive: false },
    { value: 'd', id: 'd', label: 'Dana', location: 'Kent', locations: ['Kent', 'Seattle'], inactive: false },
    { value: 'q', id: 'q', label: 'Quiet Quinn', location: 'Kent', locations: ['Kent'], inactive: false },
    { value: 'old', id: 'old', label: 'Old Rep', location: 'Seattle', locations: ['Seattle'], inactive: true }
];
const base = { people, selection: [] as string[], location: '', me: 'me', today: '2026-10-31' };

describe('repBreakdown', () => {
    it('counts each list per person, late follow-ups included, busiest first', () => {
        const rows = repBreakdown({
            ...base,
            visits: [{ createdBy: 'j' }, { createdBy: 'j' }, { createdBy: 'me' }],
            resources: [{ uploadedBy: 'me' }, { createdBy: 'j' }],
            followUps: [{ createdBy: 'j', followUpDate: '2026-10-20' }, { createdBy: 'j', followUpDate: '2026-11-02' }, { createdBy: 'me', followUpDate: '2026-10-31' }]
        });
        expect(rows.map((r) => [r.name, r.visits, r.resources, r.followUps, r.late])).toEqual([
            ['Jesus B.', 2, 1, 2, 1],
            ['Krish', 1, 1, 1, 0],
            ['Dana', 0, 0, 0, 0],
            ['Quiet Quinn', 0, 0, 0, 0]
        ]);
        expect(rows[1].you).toBe(true);
    });

    it('gives every active rep in view a row, and a deactivated one only with activity', () => {
        expect(repBreakdown({ ...base, visits: [], resources: [], followUps: [] }).map((r) => r.id)).toEqual(['d', 'j', 'me', 'q']);
        const rows = repBreakdown({ ...base, visits: [{ createdBy: 'old' }], resources: [], followUps: [] });
        expect(rows[0]).toMatchObject({ id: 'old', inactive: true, visits: 1 });
    });

    it('narrows the zero rows to the location, or to the people picked', () => {
        expect(repBreakdown({ ...base, location: 'Kent', visits: [], resources: [], followUps: [] }).map((r) => r.id)).toEqual(['d', 'q']);
        expect(repBreakdown({ ...base, selection: ['j', 'q'], visits: [], resources: [], followUps: [] }).map((r) => r.id)).toEqual(['j', 'q']);
    });

    it("names someone not offered from the row itself, and puts no-one-recorded last", () => {
        const rows = repBreakdown({
            ...base, selection: ['me'],
            visits: [{ createdBy: 'csr1', createdByName: 'Casey CSR' }, {}, { createdBy: 'csr1' }],
            resources: [{ uploadedBy: 'csr2', uploadedByName: 'Robin' }],
            followUps: []
        });
        expect(rows.map((r) => [r.id, r.name, r.visits, r.resources])).toEqual([
            ['csr1', 'Casey CSR', 2, 0],
            ['csr2', 'Robin', 0, 1],
            ['me', 'Krish', 0, 0],
            [NOT_RECORDED, 'Not recorded', 1, 0]
        ]);
    });

    it('adds up to the same totals as the lists', () => {
        const rows = repBreakdown({
            ...base,
            visits: [{ createdBy: 'j' }, { createdBy: 'x' }],
            resources: [{ uploadedBy: 'j' }],
            followUps: [{ createdBy: 'me', followUpDate: '10/01/2026' }, { createdBy: 'j', followUpDate: '2026-10-01' }]
        });
        expect(repTotals(rows)).toEqual({ visits: 2, resources: 1, followUps: 2, late: 1, todayStops: 0 });
    });

    it("counts today's stops on each person's calendar, not cancelled ones or other days", () => {
        const rows = repBreakdown({
            ...base, selection: ['j', 'me'], visits: [], resources: [], followUps: [],
            schedules: [
                { userId: 'j', startTime: '2026-10-31T09:00:00.000' },
                { userId: 'j', startTime: '2026-10-31T13:30:00.000' },
                { userId: 'j', startTime: '2026-10-31T15:00:00.000', status: 'Cancelled' },
                { userId: 'me', startTime: '2026-11-01T09:00:00.000' },
                { userId: 'csr', ownerName: 'Casey', startTime: '2026-10-31T10:00:00.000' }
            ]
        });
        expect(rows.map((r) => [r.name, r.todayStops])).toEqual([['Casey', 1], ['Jesus B.', 2], ['Krish', 0]]);
    });
});
