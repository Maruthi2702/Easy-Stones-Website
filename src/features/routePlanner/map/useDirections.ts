import { useEffect, useMemo, useState } from 'react';
import { ROUTES_URL, decodePolyline, joinPaths, routesRequestBody, splitRoute } from './routeLine';
import type { RouteRequest } from './routeLine';
import type { DayStop, LatLng } from '../types';

/**
 * The road-following route line for the day being planned: a Routes API
 * (computeRoutes) answer decoded to points and drawn as a <Polyline> in
 * MapCanvas. The Directions API this used to call can't be enabled on new
 * Google Cloud projects. The browser key (VITE_GOOGLE_MAPS_API_KEY) needs
 * "Routes API" enabled and in its API restriction list.
 */
export function useDirections({ day, origin, mapReady }: { day: DayStop[]; origin: LatLng | null; mapReady: boolean }) {
    // Distinct from the numbered pins, which only mark each stop's location;
    // this is the actual driving path between them.
    const [path, setPath] = useState<LatLng[] | null>(null);

    // What a request for `day`'s stops would look like, derived from props
    // alone and kept apart from the effect that sends it, so the effect never
    // has to reset state when the params go invalid — the render is gated on
    // this instead. Same order as the numbered pins; stops are never
    // re-sequenced, which would desync the line from the numbers on top of it.
    const directionsRequest = useMemo((): RouteRequest[] | null => {
        if (day.length === 0 || (!origin && day.length < 2)) return null;

        const points = origin ? [origin, ...day.map(s => s.coordinates)] : day.map(s => s.coordinates);
        // One call holds 25 intermediates, so a big day goes as chained
        // requests (each ends where the next starts) and the lines are joined.
        return splitRoute(points);
    }, [day, origin]);

    useEffect(() => {
        const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
        if (!mapReady || !directionsRequest || !key) return;

        let cancelled = false;
        (async () => {
            try {
                const paths = await Promise.all(directionsRequest.map(async request => {
                    const res = await fetch(ROUTES_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Goog-Api-Key': key,
                            'X-Goog-FieldMask': 'routes.polyline.encodedPolyline'
                        },
                        body: JSON.stringify(routesRequestBody(request))
                    });
                    const data = res.ok ? await res.json() : null;
                    const encoded: string | undefined = data?.routes?.[0]?.polyline?.encodedPolyline;
                    return encoded ? decodePolyline(encoded) : null;
                }));
                // All or nothing: a line with a gap would look like a real route.
                const whole = paths.every((p): p is LatLng[] => p !== null);
                if (!cancelled) setPath(whole ? joinPaths(paths as LatLng[][]) : null);
            } catch {
                if (!cancelled) setPath(null);
            }
        })();

        return () => { cancelled = true; };
    }, [mapReady, directionsRequest]);

    return { path, directionsRequest };
}
