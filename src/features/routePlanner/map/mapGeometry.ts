// The map's plain geometry: smoothing a lasso trace, and the padded area pins are drawn in.
import type { LatLng } from '../types';

// Chaikin's corner-cutting: each pass replaces every edge with two points a
// quarter and three-quarters of the way along it, rounding every corner a
// little more each time. A fast mouse drag naturally produces a coarse,
// angular trace — mousemove only fires so often, so a quick sweep covers a
// lot of ground between points — and this is what turns that into a smooth
// closed curve without needing the rep to have drawn it slowly. Treated as
// a closed loop (wraps via `% path.length`) since a lasso selection is
// always a closed shape. 3 passes is enough to round it off without
// exploding the point count (roughly ×8 — a 6-point trace becomes ~48).
export const smoothClosedPath = (points: LatLng[], iterations = 3): LatLng[] => {
    let path = points;
    for (let i = 0; i < iterations && path.length >= 3; i++) {
        const next: LatLng[] = [];
        for (let j = 0; j < path.length; j++) {
            const p0 = path[j];
            const p1 = path[(j + 1) % path.length];
            next.push({ lat: p0.lat * 0.75 + p1.lat * 0.25, lng: p0.lng * 0.75 + p1.lng * 0.25 });
            next.push({ lat: p0.lat * 0.25 + p1.lat * 0.75, lng: p0.lng * 0.25 + p1.lng * 0.75 });
        }
        path = next;
    }
    return path;
};

// How far past the screen a pin is still drawn, so a small pan finds its pins
// already there instead of drawing them mid-drag.
export const VIEW_PAD = 0.35;
export type Bounds = { north: number; south: number; east: number; west: number };
export const paddedBounds = (map: google.maps.Map): Bounds | null => {
    const b = map.getBounds();
    if (!b) return null;
    const ne = b.getNorthEast();
    const sw = b.getSouthWest();
    const dLat = (ne.lat() - sw.lat()) * VIEW_PAD;
    const dLng = (ne.lng() - sw.lng()) * VIEW_PAD;
    return { north: ne.lat() + dLat, south: sw.lat() - dLat, east: ne.lng() + dLng, west: sw.lng() - dLng };
};
export const insideBounds = (b: Bounds, c: LatLng) => c.lat <= b.north && c.lat >= b.south && c.lng <= b.east && c.lng >= b.west;
