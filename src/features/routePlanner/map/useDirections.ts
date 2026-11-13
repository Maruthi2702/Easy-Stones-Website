import { useEffect, useMemo, useState } from 'react';
import { ROUTES_URL, decodePolyline, routesRequestBody } from './routeLine';
import type { DayStop, LatLng } from '../types';

type RouteRequest = { origin: LatLng; destination: LatLng; waypoints: { location: LatLng }[] };

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
    const directionsRequest = useMemo((): RouteRequest | null => {
        if (day.length === 0 || (!origin && day.length < 2)) return null;

        const routeOrigin = origin || day[0].coordinates;
        const routeStops = origin ? day : day.slice(1);
        const destination = routeStops[routeStops.length - 1].coordinates;
        const waypoints = routeStops.slice(0, -1).map(stop => ({ location: stop.coordinates }));

        // A single request holds up to 25 intermediates; bail instead of
        // silently dropping stops off an unusually large day. (Kept at the
        // old 23 so nothing about which days draw a line changes.)
        if (waypoints.length > 23) return null;

        return { origin: routeOrigin, destination, waypoints };
    }, [day, origin]);

    useEffect(() => {
        const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
        if (!mapReady || !directionsRequest || !key) return;

        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(ROUTES_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': key,
                        'X-Goog-FieldMask': 'routes.polyline.encodedPolyline'
                    },
                    body: JSON.stringify(routesRequestBody(directionsRequest))
                });
                const data = res.ok ? await res.json() : null;
                const encoded: string | undefined = data?.routes?.[0]?.polyline?.encodedPolyline;
                if (!cancelled) setPath(encoded ? decodePolyline(encoded) : null);
            } catch {
                if (!cancelled) setPath(null);
            }
        })();

        return () => { cancelled = true; };
    }, [mapReady, directionsRequest]);

    return { path, directionsRequest };
}
