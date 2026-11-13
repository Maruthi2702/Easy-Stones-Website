import type { LatLng } from '../types';

/**
 * The road-following route line, from Google's Routes API (the Directions API
 * that used to draw it can't be enabled on new Google Cloud projects). Pure
 * helpers: the request body, and the encoded polyline decoded to points.
 */

export const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const waypoint = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

/** Origin → stops in our order (never re-sequenced) → destination, by car. */
export function routesRequestBody({ origin, destination, waypoints }: { origin: LatLng; destination: LatLng; waypoints: { location: LatLng }[] }) {
    return {
        origin: waypoint(origin),
        destination: waypoint(destination),
        intermediates: waypoints.map(w => waypoint(w.location)),
        travelMode: 'DRIVE'
    };
}

/** Google's encoded polyline (precision 5) → points. */
export function decodePolyline(encoded: string): LatLng[] {
    const points: LatLng[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    const next = () => {
        let result = 0;
        let shift = 0;
        let byte: number;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20 && index <= encoded.length);
        return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (index < encoded.length) {
        lat += next();
        lng += next();
        points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return points;
}
