import { describe, it, expect } from 'vitest';
import { visitExportRows } from './visitExport';

const visit = (over = {}) => ({ _id: 'v1', date: '2026-11-19', company: 'Stone River', contactName: 'Max', location: 'Seattle', purpose: 'Formal Presentation', createdByName: 'Rita', notes: 'hi', ...over });
const reading = (over = {}) => ({ lat: 1, lng: 1, accuracyM: 20, readAt: 'x', distanceM: 160, mark: 'onSite', device: 'phone', approximate: false, ...over }) as never;

describe('visitExportRows', () => {
    it('keeps the old columns exactly when the viewer may not see where visits were logged', () => {
        const [row] = visitExportRows([visit()]);
        expect(Object.keys(row)).toEqual(['Date', 'Company', 'Contact', 'Location', 'Visit Type', 'Logged By', 'Notes', 'Follow-up Date', 'Follow-up Notes', 'Outcome']);
    });
    it('adds Where Logged, Distance and Logged From for a viewer who may', () => {
        const rows = visitExportRows(
            [visit(), visit({ _id: 'v2' }), visit({ _id: 'v3', purpose: 'Important Remote Meeting/Call' }), visit({ _id: 'v4' })],
            { v1: reading(), v2: reading({ mark: 'away', distanceM: 29000, device: 'computer', approximate: true }), v3: reading({ mark: 'recorded', distanceM: null }) }
        );
        expect(rows.map((r) => [r['Where Logged'], r['Distance From Customer'], r['Logged From']])).toEqual([
            ['On site', '0.1 mi', 'Phone'],
            ['18 mi away · approx.', '18 mi', 'Computer (approximate)'],
            ['Location recorded', '-', 'Phone'],
            ['-', '-', '-']
        ]);
    });
});
