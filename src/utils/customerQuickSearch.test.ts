// Dashboard → Find a customer: its search, highlight and recent-list rules.
import { describe, expect, it } from 'vitest';
import { toCustomerOptions } from './customerOptions';
import {
    findCustomers, highlightParts, initialsOf, recentCustomers, recentKey, rememberRecent, rowDetail, RECENT_LIMIT
} from './customerQuickSearch';

const options = toCustomerOptions([
    { _id: '1', company: 'Harbor Stone Works', contactName: 'Mike Tran', city: 'Seattle' },
    { _id: '2', company: 'Cascade Surfaces', contactName: 'Tom Harper', city: 'Kent' },
    { _id: '3', company: 'Harrison Kitchen', contactName: 'Lisa Harrison', city: 'Tacoma' },
    { _id: '4', company: 'Sound Kitchens', contactName: 'Mike Dunn', city: 'Tacoma' },
    { _id: '5', contactName: 'Kara Lee', city: 'Puyallup' }
]);

describe('findCustomers', () => {
    it('blank finds nothing (the recent list shows instead)', () => {
        expect(findCustomers(options, '  ')).toEqual({ rows: [], total: 0 });
    });
    it('names that start with it first, then the other matches, each A–Z', () => {
        // Cascade matches on its contact (Tom Harper), after the two names starting "Har".
        expect(findCustomers(options, 'har').rows.map((o) => o.label)).toEqual(['Harbor Stone Works', 'Harrison Kitchen', 'Cascade Surfaces']);
    });
    it('finds by contact and by city, ignoring case', () => {
        expect(findCustomers(options, 'MIKE').rows.map((o) => o.value)).toEqual(['1', '4']);
        expect(findCustomers(options, 'tacoma').rows.map((o) => o.value)).toEqual(['3', '4']);
    });
    it('caps the rows but counts every match', () => {
        const { rows, total } = findCustomers(options, 'a', 2);
        expect(rows).toHaveLength(2);
        expect(total).toBe(5);
    });
});

describe('highlightParts', () => {
    it('cuts the text around the first match', () => {
        expect(highlightParts('Harbor Stone', 'stone')).toEqual([{ text: 'Harbor ', hit: false }, { text: 'Stone', hit: true }]);
    });
    it('no match or nothing typed → the text whole', () => {
        expect(highlightParts('Kent', 'xyz')).toEqual([{ text: 'Kent', hit: false }]);
        expect(highlightParts('Kent', '')).toEqual([{ text: 'Kent', hit: false }]);
        expect(highlightParts('', 'a')).toEqual([]);
    });
});

describe('recent customers', () => {
    it('opening one moves it to the front, without repeats, at most five', () => {
        expect(rememberRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
        expect(rememberRecent(['1', '2', '3', '4', '5'], '6')).toEqual(['6', '1', '2', '3', '4']);
        expect(rememberRecent('junk', 'x')).toEqual(['x']);
        expect(RECENT_LIMIT).toBe(5);
    });
    it('reads back only customers still on the list, in the order opened', () => {
        expect(recentCustomers(options, ['4', 'gone', '1']).map((o) => o.value)).toEqual(['4', '1']);
        expect(recentCustomers(options, null)).toEqual([]);
    });
    it('is kept per person', () => {
        expect(recentKey('u1')).not.toBe(recentKey('u2'));
    });
});

describe('row text', () => {
    it('initials from the name', () => {
        expect(initialsOf('Harbor Stone Works')).toBe('HS');
        expect(initialsOf('Kara Lee')).toBe('KL');
        expect(initialsOf('& Co')).toBe('C');
        expect(initialsOf('')).toBe('');
    });
    it('city, then the contact when they are not the name', () => {
        expect(rowDetail(options.find((o) => o.value === '1')!)).toBe('Seattle · Mike Tran');
        // Kara Lee is the name shown, so the line is only the city.
        expect(rowDetail(options.find((o) => o.value === '5')!)).toBe('Puyallup');
    });
});
