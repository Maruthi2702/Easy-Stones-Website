import { describe, expect, it } from 'vitest';
import {
    typeInfoFrom, typeFacets, loggerFacets, applyResourceFilters, activeFilterCount, weekHeading, groupByWeek,
    customerParts, resourceDay, shortDay, resourceExportRows
} from './resourceList';

const r = (over: Record<string, unknown>) => ({ _id: Math.random().toString(36), ...over });

const LIST = [
    { name: '2025V3 Moda Tower', label: '2025V3 Moda Tower', order: 0, family: 'tower' as const },
    { name: 'Moda Sample Binder NorthWest V1 12', label: 'NW binder', order: 1, family: 'binder' as const },
    { name: 'Moda Misc. Samples', label: 'Moda Misc. Samples', order: 2, family: 'samples' as const }
];
const info = typeInfoFrom(LIST);

describe('typeInfoFrom', () => {
    it('reads the family, label and order a manager set', () => {
        expect(info('2025V3 Moda Tower')).toEqual({ family: 'tower', label: '2025V3 Moda Tower', order: 0 });
        expect(info('Moda Sample Binder NorthWest V1 12').label).toBe('NW binder');
    });
    it('a type not in the list is Other and shows as stored', () => {
        expect(info('Old thing')).toMatchObject({ family: 'other', label: 'Old thing' });
        expect(info('')).toMatchObject({ family: 'other', label: '' });
    });
});

describe('the Filters panel', () => {
    const rows = [
        r({ resourceType: '2025V3 Moda Tower', uploadedByName: 'Krish' }),
        r({ resourceType: '2025V3 Moda Tower', uploadedByName: 'Dave' }),
        r({ resourceType: 'Moda Sample Binder NorthWest V1 12', uploadedByName: 'Krish' }),
        r({ title: 'Moda Misc. Samples', uploadedByName: '' })
    ];

    it('groups types by family with counts, families in order', () => {
        expect(typeFacets(rows, info)).toEqual([
            { family: 'tower', label: 'Display towers', types: [{ type: '2025V3 Moda Tower', label: '2025V3 Moda Tower', count: 2 }] },
            { family: 'binder', label: 'Sample binders', types: [{ type: 'Moda Sample Binder NorthWest V1 12', label: 'NW binder', count: 1 }] },
            { family: 'samples', label: 'Samples', types: [{ type: 'Moda Misc. Samples', label: 'Moda Misc. Samples', count: 1 }] }
        ]);
    });

    it('lists who logged them A–Z with Unknown last', () => {
        expect(loggerFacets(rows)).toEqual([{ name: 'Dave', count: 1 }, { name: 'Krish', count: 2 }, { name: 'Unknown', count: 1 }]);
    });

    it('nothing ticked in a group keeps all of it; ticks in both groups must both match', () => {
        expect(applyResourceFilters(rows, { types: [], loggedBy: [] })).toHaveLength(4);
        expect(applyResourceFilters(rows, { types: ['2025V3 Moda Tower'], loggedBy: [] })).toHaveLength(2);
        expect(applyResourceFilters(rows, { types: ['2025V3 Moda Tower'], loggedBy: ['Krish'] })).toHaveLength(1);
        expect(applyResourceFilters(rows, { types: [], loggedBy: ['Unknown'] })).toHaveLength(1);
        expect(activeFilterCount({ types: ['a'], loggedBy: ['b', 'c'] })).toBe(3);
    });
});

describe('week headings (Monday-first)', () => {
    const today = '2026-10-30'; // a Friday
    it('this week, last week, earlier this month, then the month', () => {
        expect(weekHeading('2026-10-26', today)).toBe('This week');
        expect(weekHeading('2026-10-25', today)).toBe('Last week');
        expect(weekHeading('2026-10-19', today)).toBe('Last week');
        expect(weekHeading('2026-10-13', today)).toBe('Earlier in October');
        expect(weekHeading('2026-09-30', today)).toBe('September 2026');
        expect(weekHeading('', today)).toBe('No date');
    });
    it('groups consecutive rows under one heading', () => {
        const rows = [r({ date: '2026-10-27' }), r({ date: '2026-10-13' }), r({ date: '2026-10-07' }), r({ date: '2026-09-30' })];
        expect(groupByWeek(rows, today).map((g) => [g.heading, g.rows.length])).toEqual([
            ['This week', 1], ['Earlier in October', 2], ['September 2026', 1]
        ]);
    });
});

describe('row details', () => {
    it('splits the customer into company and contact', () => {
        expect(customerParts({ company: 'TopLine Counters', contactName: 'Gabe Allam' })).toEqual({ company: 'TopLine Counters', contact: 'Gabe Allam' });
        expect(customerParts({ contactName: 'Anna' })).toEqual({ company: 'Anna', contact: '' });
        expect(customerParts({ customerName: 'Seattle Granite - Jarren Cheha' })).toEqual({ company: 'Seattle Granite', contact: 'Jarren Cheha' });
    });
    it('reads the day from ISO and US dates', () => {
        expect(resourceDay({ date: '2026-10-13' })).toBe('2026-10-13');
        expect(resourceDay({ date: '10/9/2026' })).toBe('2026-10-09');
        expect(resourceDay({ createdAt: '2026-10-08T10:00:00.000Z' })).toBe('2026-10-08');
        expect(shortDay('2026-10-13', '2026-10-30')).toBe('Oct 13');
        expect(shortDay('2025-12-01', '2026-10-30')).toBe('Dec 1, 2025');
    });
    it('Excel rows carry the qty (1 for old resources) and who logged it', () => {
        const [row] = resourceExportRows([r({ date: '2026-10-09', company: 'TopLine', resourceType: 'Binder', uploadedByName: 'Krish' })]);
        expect(row).toMatchObject({ Date: '2026-10-09', Customer: 'TopLine', Resource: 'Binder', Qty: 1, 'Logged by': 'Krish', Status: 'Active' });
    });
});
