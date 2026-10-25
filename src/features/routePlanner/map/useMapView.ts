import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { FALLBACK_CENTER } from '../helpers';
import { insideBounds, paddedBounds } from './mapGeometry';
import type { Bounds } from './mapGeometry';
import type { LatLng } from '../types';

/** The map's own flag: its first 'idle' has fired, so a zoom from now on is the person's. */
type ReadyMap = google.maps.Map & { __ready?: boolean };

export type MapViewDeps = {
    mapRef: MutableRefObject<google.maps.Map | null>;
    origin: LatLng | null;
    lastKnownPosition: LatLng | null;
};

/**
 * The map itself: where it opens, the area pins are drawn in (updated when a
 * pan or zoom settles), and the one move it makes on its own — to the phone's
 * location, if nobody has touched the map yet.
 */
export function useMapView({ mapRef, origin, lastKnownPosition }: MapViewDeps) {
    const [mapReady, setMapReady] = useState(false);
    // The padded area pins are drawn in; null until the map first reports its
    // bounds. Updated on 'idle' (the pan or zoom has settled — never mid-drag),
    // and only when the screen has actually left the area already drawn.
    const [drawBounds, setDrawBounds] = useState<Bounds | null>(null);
    const drawBoundsRef = useRef<Bounds | null>(null);
    // The map opens centred here and is never re-centred by a prop afterwards:
    // `center` used to follow `origin`, so the phone's location answer (up to
    // 8 s late) yanked the map out from under a rep who had already started
    // panning. See the effect below for the one allowed move.
    const [initialCenter] = useState<LatLng>(() => origin || lastKnownPosition || FALLBACK_CENTER);
    const userMovedRef = useRef(false);

    const handleLoad = (map: ReadyMap) => {
        mapRef.current = map;
        map.addListener('dragstart', () => { userMovedRef.current = true; });
        map.addListener('zoom_changed', () => { if (map.__ready) userMovedRef.current = true; });
        map.addListener('idle', () => {
            map.__ready = true;
            const view = map.getBounds();
            const drawn = drawBoundsRef.current;
            if (view && drawn) {
                const ne = view.getNorthEast();
                const sw = view.getSouthWest();
                const contained = insideBounds(drawn, { lat: ne.lat(), lng: ne.lng() }) && insideBounds(drawn, { lat: sw.lat(), lng: sw.lng() });
                // Within the drawn area and not zoomed far in from it: keep it.
                if (contained && (drawn.north - drawn.south) < (ne.lat() - sw.lat()) * 4) return;
            }
            const next = paddedBounds(map);
            drawBoundsRef.current = next;
            setDrawBounds(next);
        });
        setMapReady(true);
    };

    // The phone's location arriving is the only time the map moves itself, and
    // only if nobody has touched the map yet.
    useEffect(() => {
        if (!mapReady || !origin || userMovedRef.current || !mapRef.current) return;
        mapRef.current.panTo(origin);
    }, [mapReady, origin, mapRef]);


    return { mapReady, drawBounds, initialCenter, handleLoad };
}
