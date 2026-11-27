import { describe, it, expect } from 'vitest';
import { insideShape, leadsInShape, shapeBounds } from './leadsInShape';
import type { Lead, SelectionShape } from './types';

const lead = (name: string, lat: number, lng: number): Lead => ({
    placeId: name, name, address: '', phone: '', types: [], coordinates: { lat, lng },
    addressParts: { street: '', city: '', state: '', zipCode: '' }
});

const circle: SelectionShape = { type: 'radius', center: { lat: 47.6, lng: -122.3 }, radiusMeters: 5000 };
const square: SelectionShape = {
    type: 'lasso',
    path: [{ lat: 47.0, lng: -123 }, { lat: 47.0, lng: -122 }, { lat: 48.0, lng: -122 }, { lat: 48.0, lng: -123 }]
};

describe('leadsInShape', () => {
    it('keeps the leads inside a radius, A–Z', () => {
        const near = lead('Zeta Tile', 47.61, -122.3);
        const nearer = lead('Alpha Stone', 47.6, -122.31);
        const far = lead('Far Away', 47.9, -122.3);
        expect(leadsInShape([near, far, nearer], circle).map(l => l.name)).toEqual(['Alpha Stone', 'Zeta Tile']);
    });

    it('keeps the leads inside a lasso outline', () => {
        const inside = lead('Inside', 47.5, -122.5);
        const outside = lead('Outside', 47.5, -121.5);
        expect(leadsInShape([inside, outside], square)).toEqual([inside]);
    });

    it('lists nothing before a shape is drawn', () => {
        expect(leadsInShape([lead('Any', 47.6, -122.3)], null)).toEqual([]);
    });

    it('insideShape answers a single point', () => {
        expect(insideShape({ lat: 47.6, lng: -122.3 }, circle)).toBe(true);
        expect(insideShape({ lat: 49, lng: -122.3 }, circle)).toBe(false);
    });
});

describe('shapeBounds', () => {
    it('is the lasso outline’s box', () => {
        expect(shapeBounds(square)).toEqual({ north: 48, south: 47, east: -122, west: -123 });
    });

    it('a radius’s box contains the whole circle and is centred on it', () => {
        const b = shapeBounds(circle);
        expect((b.north + b.south) / 2).toBeCloseTo(47.6, 6);
        expect((b.east + b.west) / 2).toBeCloseTo(-122.3, 6);
        // 5 km north / south is about 0.045° of latitude
        expect(b.north - 47.6).toBeCloseTo(5000 / 111_320, 4);
        // longitude degrees are shorter at this latitude, so the box is wider in degrees
        expect(b.east - -122.3).toBeGreaterThan(b.north - 47.6);
    });
});
