import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, Marker, DirectionsRenderer, TrafficLayer } from '@react-google-maps/api';
import { MapPin, Phone, X, Sparkles, Lasso, LocateFixed } from 'lucide-react';
import { FALLBACK_CENTER, RECENCY_DARK_TEXT, LEAD_PIN_COLOR, OPEN_PIN_COLOR, nameOf, typeColors, isNotInterested } from './helpers';
import { milesBetween, pointInPolygon } from '../../../utils/routePlan';
import FilterPanel from './FilterPanel';
import ToolsPanel from './ToolsPanel';
import CustomersPanel from './CustomersPanel';
import SchedulePanel from './SchedulePanel';
import './MapCanvas.css';

// Chaikin's corner-cutting: each pass replaces every edge with two points a
// quarter and three-quarters of the way along it, rounding every corner a
// little more each time. A fast mouse drag naturally produces a coarse,
// angular trace — mousemove only fires so often, so a quick sweep covers a
// lot of ground between points — and this is what turns that into a smooth
// closed curve without needing the rep to have drawn it slowly. Treated as
// a closed loop (wraps via `% path.length`) since a lasso selection is
// always a closed shape. 3 passes is enough to round it off without
// exploding the point count (roughly ×8 — a 6-point trace becomes ~48).
const smoothClosedPath = (points, iterations = 3) => {
    let path = points;
    for (let i = 0; i < iterations && path.length >= 3; i++) {
        const next = [];
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

// A classic map-pin silhouette (rounded head, pointed tail) in a 24x24
// viewBox — the head spans x:[5,19] y:[2,16], the tip sits at (12,22). Used
// only for the currently-selected route stops, matching Badger Maps'
// numbered pin look for "this is where I'm going"; everything else stays a
// plain dot, as it was before.
const PIN_PATH = 'M12,2C8.13,2,5,5.13,5,9c0,5.25,7,13,7,13s7,-7.75,7,-13C19,5.13,15.87,2,12,2z';

// The stop number used to be a separate google.maps.Marker `label` overlaid
// on top of this icon — two independently-rendered layers (a rasterized SVG
// image underneath, a DOM text node on top) that don't always align or
// anti-alias cleanly at this size, which is why bigger/smaller font sizes
// alone never made it crisp. Baking the digits into the SVG itself as real
// vector `<text>` (see markerIcon below) makes them one image, rendered by
// one engine, so they scale and align exactly like the pin shape does.
// Sized in the 24-unit viewBox, not CSS pixels — the head is ~14 units wide
// (x:[5,19]), so this keeps two- and three-digit stops from overflowing it.
const stopNumberFontSize = (order) => {
    const digits = String(order).length;
    if (digits >= 3) return 5.5;
    if (digits === 2) return 8;
    return 10;
};

/**
 * GoogleMap wrapper: the individually-numbered pins for the current Tools
 * panel selection, a plain pin for every other customer, the Tools panel's
 * own draw-gesture overlays (see the two effects below), and the customer
 * detail panel. Every customer gets its own always-clickable pin — no
 * cluster badges collapsing several into a count a rep can't act on — the
 * same "always individual pins" approach Badger Maps uses, since a rep
 * needs to be able to select or open any one customer regardless of how
 * many others sit near it on screen.
 */
// Lead-search results: same map-pin silhouette as a route stop, but a fixed
// teal (LEAD_PIN_COLOR, theme-independent) so a prospect never reads as an
// existing customer's recency colour or the blue "you are here" origin dot.
// Same fixed dark ring as every other pin now uses (see markerIcon's `ring`
// below) rather than a white one, so it doesn't stand out as a leftover
// from before that convention changed.
const leadMarkerIcon = () => {
    if (!window.google) return undefined;
    const size = 30;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
        `<path d="${PIN_PATH}" fill="${LEAD_PIN_COLOR}" stroke="#20201f" stroke-width="1.4"/>` +
        `</svg>`;
    return {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
        scaledSize: new window.google.maps.Size(size, size),
        anchor: new window.google.maps.Point(size / 2, size * (22 / 24))
    };
};

// The fill and number colour a pin wears: its customer type, or how long since
// the last visit, per the Filter's "colour pins by" switch.
const pinLook = (colors, colorMode, pin) => {
    if (colorMode === 'type') return typeColors(pin.customerType);
    return { color: colors[pin.recency.key], ink: RECENCY_DARK_TEXT.has(pin.recency.key) ? '#141414' : '#ffffff' };
};

const PIN_SIZE = 24;       // every customer
const OPEN_SIZE = 38;      // the one whose panel is open
const STOP_SIZE = 44;      // a numbered route stop — large enough to read the number

const svgIcon = (svg, size) => ({
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(size, size),
    // The tip (12,22 in the 24-unit viewBox) is the coordinate being marked,
    // not the icon's centre.
    anchor: new window.google.maps.Point(size / 2, size * (22 / 24))
});

// Builds one pin's icon (cached by markerIcon in MapCanvas). Every customer is
// a map pin in the type or visit colour; a route stop is the same pin, larger,
// with a white outline and its number; the open customer is coral with a ring.
const buildMarkerIcon = ({ color, ink }, order, isOpen) => {
    const ring = '#20201f';

    // The one pin whose detail panel is open — a fixed coral fill and a hollow
    // ring instead of a stop number, so it reads as "the one you have open"
    // whatever colour or stop number it would otherwise wear. Closing the
    // panel falls straight through to the cases below.
    if (isOpen) {
        return svgIcon(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${OPEN_SIZE}" height="${OPEN_SIZE}" viewBox="0 0 24 24">` +
            `<path d="${PIN_PATH}" fill="${OPEN_PIN_COLOR}" stroke="${ring}" stroke-width="1.4"/>` +
            `<circle cx="12" cy="9" r="3.3" fill="none" stroke="#ffffff" stroke-width="1.8"/>` +
            `</svg>`, OPEN_SIZE);
    }

    if (!order) {
        return svgIcon(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_SIZE}" height="${PIN_SIZE}" viewBox="0 0 24 24">` +
            `<path d="${PIN_PATH}" fill="${color}" stroke="${ring}" stroke-width="1.6"/>` +
            `<circle cx="12" cy="9" r="2.6" fill="${ring}" fill-opacity="0.45"/>` +
            `</svg>`, PIN_SIZE);
    }

    // The order number is real SVG text in the same image as the pin (see
    // stopNumberFontSize for why not a Marker `label`). (12, 9) is the round
    // head's centre in the 24-unit viewBox.
    return svgIcon(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${STOP_SIZE}" height="${STOP_SIZE}" viewBox="0 0 24 24">` +
        `<path d="${PIN_PATH}" fill="${color}" stroke="#ffffff" stroke-width="2.2"/>` +
        `<path d="${PIN_PATH}" fill="none" stroke="${ring}" stroke-width="0.9"/>` +
        `<text x="12" y="9" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="Arial, Helvetica, sans-serif" font-size="${stopNumberFontSize(order)}" ` +
        `font-weight="700" fill="${ink}">${order}</text>` +
        `</svg>`, STOP_SIZE);
};

// Gestures behave like the Google Maps app: one finger drags on a phone and the
// wheel zooms on a desktop. The default ("auto") treats a map inside a
// scrolling page as embedded and asks for Ctrl + scroll / two fingers.
// clickableIcons off: tapping Google's own shop/park icons while panning opened
// their popups. A constant, so the map isn't handed a new options object (and
// asked to re-apply it) on every render.
//
// VITE_GOOGLE_MAP_ID (a Google Cloud "Map ID" set to the Vector renderer) turns
// on the vector map: zoom glides between levels, pinch follows the fingers and
// the view pans without tile pop-in. Without it the map is the raster one it
// has always been. Tilt and rotate are switched off — a route planner stays
// north-up, and a stray two-finger twist shouldn't turn the map.
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID || '';
const MAP_OPTIONS = {
    streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
    gestureHandling: 'greedy', clickableIcons: false,
    ...(MAP_ID ? { mapId: MAP_ID, tiltInteractionEnabled: false, headingInteractionEnabled: false } : {})
};

// How far past the screen a pin is still drawn, so a small pan finds its pins
// already there instead of drawing them mid-drag.
const VIEW_PAD = 0.35;
const paddedBounds = (map) => {
    const b = map.getBounds();
    if (!b) return null;
    const ne = b.getNorthEast();
    const sw = b.getSouthWest();
    const dLat = (ne.lat() - sw.lat()) * VIEW_PAD;
    const dLng = (ne.lng() - sw.lng()) * VIEW_PAD;
    return { north: ne.lat() + dLat, south: sw.lat() - dLat, east: ne.lng() + dLng, west: sw.lng() - dLng };
};
const insideBounds = (b, c) => c.lat <= b.north && c.lat >= b.south && c.lng <= b.east && c.lng >= b.west;

/**
 * Every customer pin. Its own memoised component so the map's other state (the
 * lasso's live count, an open panel, the "You" dot, the route line) re-renders
 * MapCanvas without handing 1,000-5,000 markers new props and redrawing them.
 * Route stops always draw; the rest only while inside the padded viewport.
 */
const PinLayer = React.memo(({ selectedPins, unselectedPins, orderById, openId, bounds, iconFor, onSelect }) => {
    // No bounds yet = the map hasn't settled on its first view: draw none rather than all of them.
    const shown = bounds ? unselectedPins.filter((p) => insideBounds(bounds, p.coordinates)) : [];
    return (
        <>
            {selectedPins.map((pin) => (
                <Marker
                    key={pin._id}
                    position={pin.coordinates}
                    icon={iconFor(pin, orderById.get(pin._id), openId === pin._id)}
                    title={`${nameOf(pin)} — ${pin.recency.label}`}
                    opacity={isNotInterested(pin) && openId !== pin._id ? 0.4 : 1}
                    onClick={() => onSelect(pin)}
                />
            ))}
            {/* Every other customer, always its own clickable pin — no cluster
                badge standing in for several of them, so a rep can open or
                lasso/radius-select any individual customer. */}
            {shown.map((pin) => (
                <Marker
                    key={pin._id}
                    position={pin.coordinates}
                    icon={iconFor(pin, undefined, openId === pin._id)}
                    title={`${nameOf(pin)} — ${pin.recency.label}`}
                    opacity={isNotInterested(pin) && openId !== pin._id ? 0.4 : 1}
                    onClick={() => onSelect(pin)}
                />
            ))}
        </>
    );
});

const MapCanvas = ({
    mapRef, colors, colorMode = 'type', onColorModeChange, scopeNote, lastKnownPosition = null,
    isLoaded, loadError,
    showTraffic,
    origin,
    myPosition,
    unselectedPins, orderById,
    info, onSelectPin,
    leadResults, leadInfo, onSelectLead, onCloseLeadInfo, onSaveLead, savingLead, canSaveLead, leadError,
    replaceExisting, onReplaceExistingChange, onClearPlannedDay,
    showFilterPanel, onCloseFilterPanel,
    types, activeTypes, typeCounts, onToggleType, onToggleAllTypes,
    recencyBuckets, activeBuckets, recencyCounts, onToggleBucket,
    salesRepOptions, activeSalesReps, repCounts, onToggleSalesRep, onToggleAllSalesReps,
    date, onDateChange, startAt, onStartAtChange, stopMinutes, onStopMinutesChange,
    day, summary, onScheduleDay, saved,
    can, saving,
    loading, pinsCount, error,
    onMapClick,
    showToolsPanel, onCloseToolsPanel, drawMode, onArmRadius, onArmLasso, onLocateMe, onRadiusSelect, onLassoSelect,
    selectionShape,
    selectedPins, onRemoveSelectedPoint, onReorderStop,
    showCustomersPanel, onCloseCustomersPanel, allCustomers, onSelectCustomer,
    showSchedulePanel, onCloseSchedulePanel, visitsByDate, onSelectScheduledVisit, onScheduleMonthChange, onDeleteScheduledVisit, scheduleMonthLoading,
    customerOptions, onSaveScheduledVisit, savingVisit
}) => {
    // The Tools panel's draw-gesture overlays — independent Circle/Polygon
    // instances, live only while drawMode is 'radius'/'lasso' and a drag is
    // in progress (see the two effects below).
    const selectionCircleRef = useRef(null);
    const selectionPolygonRef = useRef(null);
    const drawStateRef = useRef(null);
    const [mapReady, setMapReady] = useState(false);
    // How many customers currently fall inside the in-progress lasso —
    // null while not dragging (no badge), a number from the first
    // three-vertex mousemove onward. Real-time feedback for "is this the
    // area I mean" instead of only finding out after releasing the mouse.
    const [lassoPreviewCount, setLassoPreviewCount] = useState(null);
    // The road-following route line — a real DirectionsService result,
    // rendered by <DirectionsRenderer> below. Distinct from the numbered
    // pins above, which only mark each stop's location; this is what draws
    // the actual driving path between them (see the effect below it).
    const [directions, setDirections] = useState(null);
    // Whether the Tools panel's inline scheduling section is open — lives
    // here rather than inside ToolsPanel since MapCanvas is what actually
    // renders the AreaScheduleSection block that toggling this shows.
    const [scheduleOpen, setScheduleOpen] = useState(false);
    // The padded area pins are drawn in; null until the map first reports its
    // bounds. Updated on 'idle' (the pan or zoom has settled — never mid-drag),
    // and only when the screen has actually left the area already drawn.
    const [drawBounds, setDrawBounds] = useState(null);
    const drawBoundsRef = useRef(null);
    // The map opens centred here and is never re-centred by a prop afterwards:
    // `center` used to follow `origin`, so the phone's location answer (up to
    // 8 s late) yanked the map out from under a rep who had already started
    // panning. See the effect below for the one allowed move.
    const [initialCenter] = useState(() => origin || lastKnownPosition || FALLBACK_CENTER);
    const userMovedRef = useRef(false);

    const handleLoad = (map) => {
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

    // The pins' click handler, stable across renders so the memoised PinLayer
    // isn't invalidated by it.
    const onSelectPinRef = useRef(onSelectPin);
    useEffect(() => { onSelectPinRef.current = onSelectPin; }, [onSelectPin]);
    const selectPin = useCallback((pin) => onSelectPinRef.current(pin), []);

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
    // this — see RoutePlannerV2.jsx's searchLeads() for why this screen
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

        const mouseDownListener = map.addListener('mousedown', (e) => {
            drawStateRef.current = { center: e.latLng };
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

        const mouseMoveListener = map.addListener('mousemove', (e) => {
            if (!drawStateRef.current || !selectionCircleRef.current) return;
            const center = drawStateRef.current.center;
            const meters = milesBetween(
                { lat: center.lat(), lng: center.lng() },
                { lat: e.latLng.lat(), lng: e.latLng.lng() }
            ) * 1609.34;
            selectionCircleRef.current.setRadius(Math.max(meters, 1));
        });

        // A plain click (no real drag) resolves to a near-zero radius —
        // ignored rather than selecting nothing but still disarming, so an
        // accidental tap doesn't silently end the draw with no feedback.
        const mouseUpListener = map.addListener('mouseup', () => {
            if (!drawStateRef.current) return;
            const center = drawStateRef.current.center;
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
        const mouseDownListener = map.addListener('mousedown', (e) => {
            drawStateRef.current = { path: [e.latLng] };
            selectionPolygonRef.current = new window.google.maps.Polygon({
                map,
                paths: [e.latLng],
                strokeColor: '#2a78d6',
                strokeOpacity: 0.9,
                strokeWeight: 2,
                fillColor: '#2a78d6',
                fillOpacity: 0.12,
                clickable: false
            });
            setLassoPreviewCount(0);
        });

        const mouseMoveListener = map.addListener('mousemove', (e) => {
            if (!drawStateRef.current || !selectionPolygonRef.current) return;
            drawStateRef.current.path.push(e.latLng);
            selectionPolygonRef.current.setPath(drawStateRef.current.path);

            // Counting is a point-in-polygon sweep over every pin; at most once
            // per frame, however fast the mouse reports.
            if (drawStateRef.current.path.length >= 3 && !countFrame) {
                countFrame = requestAnimationFrame(() => {
                    countFrame = 0;
                    if (!drawStateRef.current) return;
                    const livePath = drawStateRef.current.path.map(latLng => ({ lat: latLng.lat(), lng: latLng.lng() }));
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
            const path = drawStateRef.current.path;
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
    // when selectionShape goes null (RoutePlannerV2.jsx's clearSelection).
    const selectionShapeRef = useRef(null);

    useEffect(() => {
        if (!mapReady || !window.google || !mapRef.current) return;

        selectionShapeRef.current?.setMap(null);
        selectionShapeRef.current = null;

        if (!selectionShape) return;

        const shapeOptions = {
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
    const directionsRequest = useMemo(() => {
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

    // Builds this pin's icon. Stable across renders unless colors/theme
    // actually change, so the clustering effect below can depend on it
    // without re-running (and rebuilding every marker) on every unrelated
    // render.
    //
    // Only route stops (currently selected, numbered by order) get the
    // map-pin silhouette — everything unselected goes back to the plain dot
    // it used to be. A gold ring was tried on the pin to mark it as "on
    // your plan" but didn't read well against the recency fill, so every
    // pin/dot now gets the same ring regardless of type.
    //
    // That ring is always dark now rather than flipping white-on-dark-theme
    // — the thing it has to contrast against is the map underneath it,
    // which doesn't change with the app's theme, and a dark outline is what
    // gives an icon its "printed, deliberate" look on a map (see how every
    // pin in the Badger Maps reference has one, regardless of anything else
    // about the app around it).
    // Icons are cached per look (fill × number colour × stop number × open): the
    // same object every render, so Google isn't told "new icon" for every pin
    // each time anything changes. Keyed by the look itself, so a theme or
    // colour-mode change needs no invalidation.
    const iconCache = useRef(new Map());
    const markerIcon = useCallback((pin, order, isOpen = false) => {
        if (!window.google) return undefined;
        const look = pinLook(colors, colorMode, pin);
        const key = `${look.color}|${look.ink}|${order || ''}|${isOpen ? 1 : 0}`;
        const hit = iconCache.current.get(key);
        if (hit) return hit;
        const made = buildMarkerIcon(look, order, isOpen);
        iconCache.current.set(key, made);
        return made;
    }, [colors, colorMode]);

    return (
        <div className="rpv2-map">
            {loadError && <div className="rpv2-map-empty"><p>Google Maps failed to load: {loadError.message}</p></div>}
            {!loadError && !isLoaded && <div className="rpv2-map-empty"><p>Loading the map…</p></div>}

            {loading && <div className="rpv2-badge">Loading customers…</div>}
            {!loading && !error && pinsCount === 0 && (
                <div className="rpv2-badge rpv2-badge-warn">
                    No customer has coordinates yet — run <code>node scripts/geocode-customers.js --apply</code>
                </div>
            )}
            {leadError && <div className="rpv2-badge rpv2-badge-warn">{leadError}</div>}
            {/* General action errors (schedule/clear/edit/delete/add-remove
                calendar) used to surface in the run drawer's expanded view —
                removed along with that view, so this is now their one
                reachable spot rather than being silently set and never shown. */}
            {error && <div className="rpv2-badge rpv2-badge-warn">{error}</div>}
            {drawMode === 'lasso' && lassoPreviewCount !== null && (
                <div className="rpv2-badge">
                    {lassoPreviewCount} customer{lassoPreviewCount === 1 ? '' : 's'} inside
                </div>
            )}

            {/* Mobile-only shortcuts (see .rpv2-map-fabs), floating directly
                on the map the way a phone map app puts them, for a
                one-handed reach instead of a trip to the drawer. Lasso only
                arms drawing here — it deliberately does NOT open Tools, so
                a rep can trace the outline first and open Tools afterward to
                review the selection and schedule it, rather than the panel
                popping up (and eating map space) before they've drawn
                anything. Desktop already has both one click away in the
                side rail, so this stays hidden there. */}
            {isLoaded && !loadError && (
                <div className="rpv2-map-fabs">
                    <button
                        type="button"
                        className={`rpv2-map-fab ${drawMode === 'lasso' ? 'is-on' : ''}`}
                        onClick={onArmLasso}
                        title="Lasso-select customers"
                        aria-label="Lasso-select customers"
                        aria-pressed={drawMode === 'lasso'}
                    >
                        <Lasso size={20} />
                    </button>
                    <button
                        type="button"
                        className="rpv2-map-fab"
                        onClick={onLocateMe}
                        title="Centre the map on my location"
                        aria-label="Centre the map on my location"
                    >
                        <LocateFixed size={20} />
                    </button>
                </div>
            )}

            {isLoaded && !loadError && (
                <GoogleMap
                    mapContainerClassName={`rpv2-map-canvas ${drawMode ? 'is-drawing' : ''}`}
                    center={initialCenter}
                    zoom={10}
                    onLoad={handleLoad}
                    onClick={onMapClick}
                    options={MAP_OPTIONS}
                >
                    {(myPosition || origin) && (
                        <Marker
                            position={myPosition || origin}
                            title="You"
                            icon={{
                                path: window.google.maps.SymbolPath.CIRCLE,
                                scale: 7,
                                fillColor: '#2a78d6',
                                fillOpacity: 1,
                                strokeColor: '#ffffff',
                                strokeWeight: 3
                            }}
                        />
                    )}

                    {/* Google's own live-conditions overlay — colours road
                        segments by current congestion. Purely a display
                        toggle (showTraffic), independent of the route line
                        below it. */}
                    {showTraffic && <TrafficLayer />}

                    {/* Gated on directionsRequest too, not just directions —
                        directions itself only ever updates from inside the
                        effect's async callback, so the instant the request
                        goes invalid (day cleared, etc.) it would otherwise
                        still be holding the previous route's stale result
                        for a render or two. suppressMarkers: we already draw
                        our own numbered/recency-coloured pins for every
                        stop; Google's own A/B/C markers would just
                        duplicate them. preserveViewport: a route
                        recomputing (adding/dropping a stop) shouldn't yank
                        the map back to fit the new line — the rep's own
                        pan/zoom wins. */}
                    {directions && directionsRequest && (
                        <DirectionsRenderer
                            directions={directions}
                            options={{
                                suppressMarkers: true,
                                preserveViewport: true,
                                polylineOptions: { strokeColor: '#2a78d6', strokeWeight: 4, strokeOpacity: 0.85 }
                            }}
                        />
                    )}

                    <PinLayer
                        selectedPins={selectedPins}
                        unselectedPins={unselectedPins}
                        orderById={orderById}
                        openId={info?._id}
                        bounds={drawBounds}
                        iconFor={markerIcon}
                        onSelect={selectPin}
                    />

                    {/* Lead-search results — a small, transient set, never
                        merged into selectedPins/unselectedPins since these
                        aren't CRM data until someone actually saves one. */}
                    {leadResults?.map(place => (
                        <Marker
                            key={place.placeId}
                            position={place.coordinates}
                            icon={leadMarkerIcon()}
                            title={place.name}
                            onClick={() => onSelectLead(place)}
                        />
                    ))}
                </GoogleMap>
            )}

            {/* The open customer's panel is the Customers tab's own, drawn by
                RoutePlannerV2 (CustomerDrawer) — not here. */}

            {/* Same fixed right-column shell as the customer panel above —
                a lead result isn't a Customer yet, so it gets its own
                lightweight variant. */}
            {leadInfo && (
                <div className="rpv2-panel" data-dialog="lead">
                    <div className="rpv2-panel-head" style={{ background: LEAD_PIN_COLOR }}>
                        <Sparkles size={14} />
                        <span className="rpv2-panel-head-title">New lead</span>
                        <button type="button" className="rpv2-panel-close" onClick={onCloseLeadInfo} aria-label="Close">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="rpv2-panel-body">
                        <strong className="rpv2-panel-name">{leadInfo.name}</strong>
                        {leadInfo.types?.length > 0 && (
                            <div className="rpv2-panel-sub">
                                {leadInfo.types.slice(0, 3).map(t => t.replace(/_/g, ' ')).join(' · ')}
                            </div>
                        )}

                        <div className="rpv2-panel-contact">
                            {leadInfo.address ? (
                                <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(leadInfo.address)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <MapPin size={14} />
                                    <span>{leadInfo.address}</span>
                                </a>
                            ) : (
                                <span className="rpv2-panel-muted"><MapPin size={14} /> No address on record</span>
                            )}
                            {leadInfo.phone && (
                                <a href={`tel:${leadInfo.phone}`}><Phone size={14} /><span>{leadInfo.phone}</span></a>
                            )}
                        </div>

                        <p className="rpv2-panel-sub" style={{ marginTop: '0.85rem' }}>
                            Not in your CRM yet — from a map search, not a saved account.
                        </p>
                    </div>

                    {canSaveLead && (
                        <div className="rpv2-panel-actions">
                            <button className="is-primary" disabled={savingLead} onClick={() => onSaveLead(leadInfo)}>
                                {savingLead ? 'Saving…' : 'Save as lead'}
                            </button>
                        </div>
                    )}
                </div>
            )}


            {showToolsPanel && (
                <ToolsPanel
                    onClose={onCloseToolsPanel}
                    mode={drawMode}
                    onArmRadius={onArmRadius}
                    onArmLasso={onArmLasso}
                    selectedPins={selectedPins}
                    orderById={orderById}
                    colors={colors}
                    onRemovePoint={onRemoveSelectedPoint}
                    onReorderStop={onReorderStop}
                    onSelectPin={onSelectPin}
                    can={can}
                    saving={saving}
                    date={date}
                    onDateChange={onDateChange}
                    startAt={startAt}
                    onStartAtChange={onStartAtChange}
                    stopMinutes={stopMinutes}
                    onStopMinutesChange={onStopMinutesChange}
                    day={day}
                    summary={summary}
                    onScheduleDay={onScheduleDay}
                    replaceExisting={replaceExisting}
                    onReplaceExistingChange={onReplaceExistingChange}
                    onClearPlannedDay={onClearPlannedDay}
                    saved={saved}
                    scheduleOpen={scheduleOpen}
                    onToggleSchedule={() => setScheduleOpen(v => !v)}
                />
            )}

            {showCustomersPanel && (
                <CustomersPanel
                    onClose={onCloseCustomersPanel}
                    pins={allCustomers}
                    onSelectCustomer={onSelectCustomer}
                />
            )}

            {showFilterPanel && (
                <FilterPanel
                    onClose={onCloseFilterPanel}
                    types={types}
                    activeTypes={activeTypes}
                    typeCounts={typeCounts}
                    onToggleType={onToggleType}
                    onToggleAllTypes={onToggleAllTypes}
                    recencyBuckets={recencyBuckets}
                    colors={colors}
                    activeBuckets={activeBuckets}
                    recencyCounts={recencyCounts}
                    onToggleBucket={onToggleBucket}
                    salesRepOptions={salesRepOptions}
                    activeSalesReps={activeSalesReps}
                    repCounts={repCounts}
                    onToggleSalesRep={onToggleSalesRep}
                    onToggleAllSalesReps={onToggleAllSalesReps}
                    colorMode={colorMode}
                    onColorModeChange={onColorModeChange}
                    scopeNote={scopeNote}
                />
            )}

            {showSchedulePanel && (
                <SchedulePanel
                    onClose={onCloseSchedulePanel}
                    visitsByDate={visitsByDate}
                    onSelectVisit={onSelectScheduledVisit}
                    onMonthChange={onScheduleMonthChange}
                    onDeleteVisit={onDeleteScheduledVisit}
                    monthLoading={scheduleMonthLoading}
                    customerOptions={customerOptions}
                    onSaveVisit={onSaveScheduledVisit}
                    savingVisit={savingVisit}
                />
            )}
        </div>
    );
};

export default MapCanvas;
