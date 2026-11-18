import { describe, expect, it } from 'vitest';
import { decodePolyline, joinPaths, routesRequestBody, splitRoute } from './routeLine';

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

describe('splitRoute', () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: i, lng: i }));
    it('is one request while it fits', () => {
        const r = splitRoute(pts(25));
        expect(r).toHaveLength(1);
        expect(r[0].waypoints).toHaveLength(23);
    });
    it('is nothing for under two points', () => expect(splitRoute(pts(1))).toEqual([]));
    it('chains requests end to start and covers every point once', () => {
        const points = pts(44); // 43 stops + origin
        const r = splitRoute(points);
        expect(r).toHaveLength(2);
        r.forEach(q => expect(q.waypoints.length).toBeLessThanOrEqual(23));
        expect(r[0].destination).toEqual(r[1].origin);
        expect(r[0].origin).toEqual(points[0]);
        expect(r[1].destination).toEqual(points[43]);
        const seen = r.flatMap((q, i) => [...(i ? [] : [q.origin]), ...q.waypoints.map(w => w.location), q.destination]);
        expect(seen).toEqual(points);
    });
});

describe('joinPaths', () => {
    it('drops the repeated joining point', () => {
        const a = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }];
        const b = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }];
        expect(joinPaths([a, b])).toEqual([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, { lat: 2, lng: 2 }]);
    });
});
