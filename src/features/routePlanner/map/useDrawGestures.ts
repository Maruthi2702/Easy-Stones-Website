import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { milesBetween, pointInPolygon } from '../../../utils/routePlan';
import { smoothClosedPath } from './mapGeometry';
import type { DrawMode, LatLng, MapPin as Customer, SelectionShape } from '../types';

/** A finished or in-progress draw: the circle's centre, or the lasso's path so far. */
type DrawState = { center?: google.maps.LatLng; path?: google.maps.LatLng[] };

export type DrawGesturesDeps = {
    mapRef: MutableRefObject<google.maps.Map | null>;
    mapReady: boolean;
    drawMode: DrawMode;
    selectionShape: SelectionShape | null;
    onRadiusSelect: (center: LatLng, radiusMeters: number) => void;
    onLassoSelect: (path: LatLng[]) => void;
    selectedPins: Customer[];
    unselectedPins: Customer[];
};

/**
 * The Tools panel's draw gestures on the map: a dragged circle (Radius) or a
 * freehand outline (Lasso) while one is armed, the lasso's live count, and
 * the last finished draw's boundary kept on the map. Which pins fall inside
 * is decided upstream (onRadiusSelect / onLassoSelect).
 */
export function useDrawGestures({ mapRef, mapReady, drawMode, selectionShape, onRadiusSelect, onLassoSelect, selectedPins, unselectedPins }: DrawGesturesDeps) {
    // The Tools panel's draw-gesture overlays — independent Circle/Polygon
    // instances, live only while drawMode is 'radius'/'lasso' and a drag is
    // in progress (see the two effects below).
    const selectionCircleRef = useRef<google.maps.Circle | null>(null);
    const selectionPolygonRef = useRef<google.maps.Polygon | null>(null);
    const drawStateRef = useRef<DrawState | null>(null);
    // How many customers currently fall inside the in-progress lasso —
    // null while not dragging (no badge), a number from the first
    // three-vertex mousemove onward. Real-time feedback for "is this the
    // area I mean" instead of only finding out after releasing the mouse.
    const [lassoPreviewCount, setLassoPreviewCount] = useState<number | null>(null);

    // onRadiusSelect/onLassoSelect are recreated whenever `visible` changes
    // upstream in RoutePlannerV2 (new pins load, a filter toggles, etc.) —
    // keeping them out of the two draw effects' own dependency arrays below
    // means an unrelated re-render while a rep is mid-drag can't tear down
    // and rebuild the mousedown/mousemove/mouseup listeners underneath
    // them, which is exactly the kind of gap that leaves a preview shape
    // stranded on the map without its cleanup ever running. The effects
    // still always call the current callback, just via a ref instead of a
    // dependency.
    const onRadiusSelectRef = useRef(onRadiusSelect);
    const onLassoSelectRef = useRef(onLassoSelect);
    useEffect(() => { onRadiusSelectRef.current = onRadiusSelect; }, [onRadiusSelect]);
    useEffect(() => { onLassoSelectRef.current = onLassoSelect; }, [onLassoSelect]);

    // Same reasoning as above, for the lasso's live-count mousemove handler
    // below — selectedPins/unselectedPins are new arrays on most renders
    // (they're recomputed upstream whenever pins/filters change), so reading
    // them via ref keeps the drag listeners from being torn down and rebuilt
    // mid-drag by something unrelated to the draw gesture itself.
    const selectedPinsRef = useRef(selectedPins);
    const unselectedPinsRef = useRef(unselectedPins);
    useEffect(() => { selectedPinsRef.current = selectedPins; }, [selectedPins]);
    useEffect(() => { unselectedPinsRef.current = unselectedPins; }, [unselectedPins]);

    // Tools panel's Radius mode: while armed, a mousedown starts a live
    // preview circle, mousemove grows it to track the cursor, and mouseup
    // finalises the draw and hands the result up to onRadiusSelect (which
    // does the pin-in-circle sweep — this effect only owns the drawing
    // gesture itself, not which pins fall inside it). Panning is switched
    // off for the duration so a drag draws a circle instead of dragging the
    // map out from under it; distance is figured with the same great-circle
    // milesBetween() used elsewhere in this screen, converted to meters for
    // Circle.setRadius, rather than pulling in the Geometry library just for
    // this — see RoutePlannerV2.tsx's searchLeads() for why this screen
    // avoids requesting extra Maps libraries up front.
    useEffect(() => {
        if (!mapReady || !window.google || !mapRef.current) return;
        const map = mapRef.current;

        if (drawMode !== 'radius') return;

        map.setOptions({ draggable: false });

        const clearPreview = () => {
            selectionCircleRef.current?.setMap(null);
            selectionCircleRef.current = null;
            drawStateRef.current = null;
        };

        const mouseDownListener = map.addListener('mousedown', (e: google.maps.MapMouseEvent) => {
            drawStateRef.current = { center: e.latLng as google.maps.LatLng };
            selectionCircleRef.current = new window.google.maps.Circle({
                map,
                center: e.latLng,
                radius: 1,
                strokeColor: '#2a78d6',
                strokeOpacity: 0.9,
                strokeWeight: 2,
                fillColor: '#2a78d6',
                fillOpacity: 0.12,
                clickable: false
            });
        });

        const mouseMoveListener = map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
            if (!drawStateRef.current || !selectionCircleRef.current) return;
            const center = drawStateRef.current.center!;
            const meters = milesBetween(
                { lat: center.lat(), lng: center.lng() },
                { lat: e.latLng!.lat(), lng: e.latLng!.lng() }
            ) * 1609.34;
            selectionCircleRef.current.setRadius(Math.max(meters, 1));
        });

        // A plain click (no real drag) resolves to a near-zero radius —
        // ignored rather than selecting nothing but still disarming, so an
        // accidental tap doesn't silently end the draw with no feedback.
        const mouseUpListener = map.addListener('mouseup', () => {
            if (!drawStateRef.current) return;
            const center = drawStateRef.current.center!;
            const radiusMeters = selectionCircleRef.current?.getRadius() || 0;
            clearPreview();
            if (radiusMeters > 50) {
                onRadiusSelectRef.current({ lat: center.lat(), lng: center.lng() }, radiusMeters);
            }
        });

        return () => {
            window.google.maps.event.removeListener(mouseDownListener);
            window.google.maps.event.removeListener(mouseMoveListener);
            window.google.maps.event.removeListener(mouseUpListener);
            clearPreview();
            map.setOptions({ draggable: true });
        };
    }, [mapReady, drawMode, mapRef]);

    // Tools panel's Lasso mode: same drag-disables-panning shape as the
    // Radius effect above, but traces a freehand outline instead of a
    // circle — mousedown starts the path, mousemove appends the cursor's
    // every position to it (redrawn as a Polygon each time, and re-counts
    // how many customers currently fall inside it — see lassoPreviewCount
    // below), mouseup smooths the traced path (smoothClosedPath — a raw
    // mouse drag is coarse and angular, mousemove firing far less often
    // than the cursor actually moves) and hands the result up to
    // onLassoSelect (which does the point-in-polygon sweep, same division
    // of labour as onRadiusSelect: this effect only owns the drawing
    // gesture).
    useEffect(() => {
        if (!mapReady || !window.google || !mapRef.current) return;
        const map = mapRef.current;

        if (drawMode !== 'lasso') return;

        map.setOptions({ draggable: false });

        const clearPreview = () => {
            selectionPolygonRef.current?.setMap(null);
            selectionPolygonRef.current = null;
            drawStateRef.current = null;
            setLassoPreviewCount(null);
        };

        let countFrame = 0;
        const mouseDownListener = map.addListener('mousedown', (e: google.maps.MapMouseEvent) => {
            drawStateRef.current = { path: [e.latLng as google.maps.LatLng] };
            selectionPolygonRef.current = new window.google.maps.Polygon({
                map,
                paths: [e.latLng as google.maps.LatLng],
                strokeColor: '#2a78d6',
                strokeOpacity: 0.9,
                strokeWeight: 2,
                fillColor: '#2a78d6',
                fillOpacity: 0.12,
                clickable: false
            });
            setLassoPreviewCount(0);
        });

        const mouseMoveListener = map.addListener('mousemove', (e: google.maps.MapMouseEvent) => {
            if (!drawStateRef.current || !selectionPolygonRef.current) return;
            drawStateRef.current.path!.push(e.latLng as google.maps.LatLng);
            selectionPolygonRef.current.setPath(drawStateRef.current.path!);

            // Counting is a point-in-polygon sweep over every pin; at most once
            // per frame, however fast the mouse reports.
            if (drawStateRef.current.path!.length >= 3 && !countFrame) {
                countFrame = requestAnimationFrame(() => {
                    countFrame = 0;
                    if (!drawStateRef.current) return;
                    const livePath = drawStateRef.current.path!.map(latLng => ({ lat: latLng.lat(), lng: latLng.lng() }));
                    const count = [...selectedPinsRef.current, ...unselectedPinsRef.current]
                        .filter(p => pointInPolygon(p.coordinates, livePath)).length;
                    setLassoPreviewCount(count);
                });
            }
        });

        // Fewer than three vertices can't enclose anything — ignored rather
        // than selecting nothing but still disarming, same as a near-zero
        // radius click above.
        const mouseUpListener = map.addListener('mouseup', () => {
            if (!drawStateRef.current) return;
            const path = drawStateRef.current.path!;
            clearPreview();
            if (path.length >= 3) {
                const rawPath = path.map(latLng => ({ lat: latLng.lat(), lng: latLng.lng() }));
                onLassoSelectRef.current(smoothClosedPath(rawPath));
            }
        });

        return () => {
            window.google.maps.event.removeListener(mouseDownListener);
            window.google.maps.event.removeListener(mouseMoveListener);
            window.google.maps.event.removeListener(mouseUpListener);
            if (countFrame) cancelAnimationFrame(countFrame);
            clearPreview();
            map.setOptions({ draggable: true });
        };
    }, [mapReady, drawMode, mapRef]);

    // The last-finished draw's boundary, kept on the map after the gesture
    // ends — unlike selectionCircleRef/selectionPolygonRef above (which are
    // torn down the instant onRadiusSelect/onLassoSelect fires), this one
    // persists so "Selected Points" always has a visible answer for where
    // those customers came from. Replaced wholesale on a new draw, cleared
    // when selectionShape goes null (RoutePlannerV2.tsx's clearSelection).
    const selectionShapeRef = useRef<google.maps.Circle | google.maps.Polygon | null>(null);

    useEffect(() => {
        if (!mapReady || !window.google || !mapRef.current) return;

        selectionShapeRef.current?.setMap(null);
        selectionShapeRef.current = null;

        if (!selectionShape) return;

        const shapeOptions: google.maps.CircleOptions & google.maps.PolygonOptions = {
            strokeColor: '#2a78d6',
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: '#2a78d6',
            fillOpacity: 0.05,
            clickable: false
        };

        if (selectionShape.type === 'radius') {
            selectionShapeRef.current = new window.google.maps.Circle({
                map: mapRef.current,
                center: selectionShape.center,
                radius: selectionShape.radiusMeters,
                ...shapeOptions
            });
        } else if (selectionShape.type === 'lasso') {
            selectionShapeRef.current = new window.google.maps.Polygon({
                map: mapRef.current,
                paths: selectionShape.path,
                ...shapeOptions
            });
        }
    }, [mapReady, selectionShape, mapRef]);

    useEffect(() => () => {
        selectionShapeRef.current?.setMap(null);
        selectionShapeRef.current = null;
    }, []);


    return { lassoPreviewCount };
}
