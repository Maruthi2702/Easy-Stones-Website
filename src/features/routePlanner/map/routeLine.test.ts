import { describe, expect, it } from 'vitest';
import { decodePolyline, routesRequestBody } from './routeLine';

describe('decodePolyline', () => {
    it("decodes Google's documented example", () => {
        const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
        expect(pts).toEqual([
            { lat: 38.5, lng: -120.2 },
            { lat: 40.7, lng: -120.95 },
            { lat: 43.252, lng: -126.453 }
        ]);
    });
    it('is empty for nothing', () => expect(decodePolyline('')).toEqual([]));
});

describe('routesRequestBody', () => {
    it('keeps the stops in order and drives', () => {
        const body = routesRequestBody({
            origin: { lat: 1, lng: 2 }, destination: { lat: 5, lng: 6 },
            waypoints: [{ location: { lat: 3, lng: 4 } }]
        });
        expect(body.travelMode).toBe('DRIVE');
        expect(body.origin.location.latLng).toEqual({ latitude: 1, longitude: 2 });
        expect(body.intermediates).toHaveLength(1);
        expect(body.destination.location.latLng).toEqual({ latitude: 5, longitude: 6 });
    });
});
