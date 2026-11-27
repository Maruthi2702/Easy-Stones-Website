import { describe, it, expect } from 'vitest';
import { leadLine, leadsHeading, mapMoved, milesText, MIN_LEAD_ZOOM, orderByDistance, tooFarOut, typeText } from './leadsPhoneRules.ts';
import type { Lead } from '../types.ts';

const lead = (name: string, lat: number, lng: number, types: string[] = [], city = ''): Lead => ({
    placeId: name, name, address: '', phone: '', types, coordinates: { lat, lng },
    addressParts: { street: '', city, state: '', zipCode: '' }
});
const centre = { lat: 47.6, lng: -122.3 };

describe('tooFarOut', () => {
    it('refuses a map wider than a town, and never a map whose zoom is unknown', () => {
        expect(tooFarOut(MIN_LEAD_ZOOM - 1)).toBe(true);
        expect(tooFarOut(MIN_LEAD_ZOOM)).toBe(false);
        expect(tooFarOut(15)).toBe(false);
        expect(tooFarOut(undefined)).toBe(false);
        expect(tooFarOut(null)).toBe(false);
    });
});

describe('orderByDistance', () => {
    it('numbers the leads nearest the map centre first', () => {
        const rows = orderByDistance([lead('Far', 47.7, -122.3), lead('Near', 47.601, -122.3), lead('Mid', 47.65, -122.3)], centre);
        expect(rows.map((r) => [r.n, r.lead.name])).toEqual([[1, 'Near'], [2, 'Mid'], [3, 'Far']]);
        expect(rows[0].miles).toBeLessThan(rows[1].miles);
    });
    it('breaks a tie by name and handles none', () => {
        const rows = orderByDistance([lead('B', 47.61, -122.3), lead('A', 47.61, -122.3)], centre);
        expect(rows.map((r) => r.lead.name)).toEqual(['A', 'B']);
        expect(orderByDistance([], centre)).toEqual([]);
    });
});

describe('words', () => {
    it('shortens distance', () => {
        expect(milesText(0.04)).toBe('Under 0.1 mi');
        expect(milesText(0.43)).toBe('0.4 mi');
        expect(milesText(12.6)).toBe('13 mi');
        expect(milesText(Infinity)).toBe('');
    });
    it('names the kind of place from the first useful type', () => {
        expect(typeText(lead('x', 0, 0, ['point_of_interest', 'kitchen_supply_store', 'establishment']))).toBe('Kitchen supply store');
        expect(typeText(lead('x', 0, 0, ['establishment']))).toBe('');
        expect(typeText(lead('x', 0, 0))).toBe('');
    });
    it('puts type, city and distance under a name, leaving out what is missing', () => {
        const [row] = orderByDistance([lead('Rainier', 47.602, -122.3, ['countertop_store'], 'Tukwila')], centre);
        expect(leadLine(row)).toBe('Countertop store · Tukwila · 0.1 mi');
        const [bare] = orderByDistance([lead('Rainier', 47.602, -122.3)], centre);
        expect(leadLine(bare)).toBe('0.1 mi');
    });
    it('counts leads', () => {
        expect(leadsHeading(1)).toBe('1 lead');
        expect(leadsHeading(12)).toBe('12 leads');
        expect(leadsHeading(0)).toBe('0 leads');
    });
});

describe('mapMoved', () => {
    const at = { center: centre, zoom: 13, widthMiles: 4 };
    it('is false for a nudge, true once the centre is a quarter of the width away', () => {
        expect(mapMoved({ ...at, center: { lat: 47.6005, lng: -122.3 } }, at)).toBe(false);
        expect(mapMoved({ ...at, center: { lat: 47.62, lng: -122.3 } }, at)).toBe(true);
    });
    it('is true when the zoom changes by a whole step', () => {
        expect(mapMoved({ ...at, zoom: 12 }, at)).toBe(true);
        expect(mapMoved({ ...at, zoom: 13.2 }, at)).toBe(false);
    });
});
