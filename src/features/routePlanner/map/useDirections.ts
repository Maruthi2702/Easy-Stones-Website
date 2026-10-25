import { useEffect, useMemo, useState } from 'react';
import type { DayStop, LatLng } from '../types';

/**
 * The road-following route line for the day being planned — a real
 * DirectionsService result, drawn by <DirectionsRenderer> in MapCanvas.
 */
export function useDirections({ day, origin, mapReady }: { day: DayStop[]; origin: LatLng | null; mapReady: boolean }) {
    // The road-following route line — a real DirectionsService result,
    // rendered by <DirectionsRenderer> below. Distinct from the numbered
    // pins above, which only mark each stop's location; this is what draws
    // the actual driving path between them (see the effect below it).
    const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);

    // What a Directions request for `day`'s stops would look like — a plain
    // derived value, computed synchronously from props/state alone, kept
    // separate from the effect below that actually fires it. This is what
    // lets that effect skip ever calling setDirections(null) itself to
    // reflect the params going invalid (day cleared, too few stops, over
    // the API's waypoint cap): with the render gated on this instead (see
    // the DirectionsRenderer below), a stale `directions` value sitting
    // unused in state when the request is null is harmless — nothing ever
    // reads it — rather than needing to be actively reset. Same order as
    // the numbered pins (day[i].order === orderById's values, both from the
    // same orderStops() call upstream); optimizeWaypoints is off on purpose
    // — that order is already ours, and letting Google re-sequence the
    // waypoints would desync the line from the numbers sitting on top of it.
    const directionsRequest = useMemo((): Pick<google.maps.DirectionsRequest, 'origin' | 'destination' | 'waypoints'> | null => {
        if (day.length === 0 || (!origin && day.length < 2)) return null;

        const routeOrigin = origin || day[0].coordinates;
        const routeStops = origin ? day : day.slice(1);
        const destination = routeStops[routeStops.length - 1].coordinates;
        const waypoints = routeStops.slice(0, -1).map(stop => ({ location: stop.coordinates, stopover: true }));

        // The Directions API caps a single request at 25 points (origin +
        // destination + 23 waypoints) — bail instead of silently dropping
        // stops off an unusually large day.
        if (waypoints.length > 23) return null;

        return { origin: routeOrigin, destination, waypoints };
    }, [day, origin]);

    // The only genuinely async part — everything about whether to request
    // at all already lives in directionsRequest above, so this effect's one
    // job is making the call and recording its result.
    useEffect(() => {
        if (!mapReady || !window.google || !directionsRequest) return;

        let cancelled = false;
        new window.google.maps.DirectionsService().route({
            ...directionsRequest,
            optimizeWaypoints: false,
            travelMode: window.google.maps.TravelMode.DRIVING
        }, (result, status) => {
            if (!cancelled) setDirections(status === 'OK' ? result : null);
        });

        return () => { cancelled = true; };
    }, [mapReady, directionsRequest]);


    return { directions, directionsRequest };
}
