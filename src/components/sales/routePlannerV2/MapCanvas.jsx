import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleMap, Marker, DirectionsRenderer, TrafficLayer } from '@react-google-maps/api';
import { MapPin, Phone, Mail, AlertTriangle, Calendar, X, Sparkles, Pencil, Trash2, Copy, Check } from 'lucide-react';
import { FALLBACK_CENTER, RECENCY_DARK_TEXT, LEAD_PIN_COLOR, whenLabel, real, nameOf, isPlaceholderEmail } from './helpers';
import { isRoutablePrecision, milesBetween, pointInPolygon } from '../../../utils/routePlan';
import FilterPanel from './FilterPanel';
import ToolsPanel from './ToolsPanel';
import './MapCanvas.css';

const hexToRgba = (hex, alpha) => {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const value = parseInt(full, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

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

const MapCanvas = ({
    mapRef, theme, colors,
    isLoaded, loadError,
    showTraffic,
    origin,
    unselectedPins, orderById,
    info, onSelectPin, onCloseInfo, onEditCustomer, loadingEditCustomer, onDeleteCustomer,
    leadResults, leadInfo, onSelectLead, onCloseLeadInfo, onSaveLead, savingLead, canSaveLead, leadError,
    replaceExisting, onReplaceExistingChange, onClearPlannedDay,
    showFilterPanel, onCloseFilterPanel,
    types, activeTypes, typeCounts, onToggleType, onToggleAllTypes,
    recencyBuckets, activeBuckets, recencyCounts, onToggleBucket,
    salesRepOptions, activeSalesReps, repCounts, onToggleSalesRep, onToggleAllSalesReps,
    date, onDateChange, startAt, onStartAtChange, stopMinutes, onStopMinutesChange,
    day, summary, onScheduleDay, saved,
    scheduled, can, saving, onAddOne, onRemoveOne, onOpenCustomer,
    loading, pinsCount, error,
    onMapClick,
    showToolsPanel, onCloseToolsPanel, drawMode, onArmRadius, onArmLasso, onRadiusSelect, onLassoSelect,
    selectionShape,
    selectedPins, onRemoveSelectedPoint
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
    // Which field's copy button last fired, so its icon can flip to a
    // checkmark briefly — a single field rather than a per-field boolean
    // since only one copy can meaningfully be "just done" at a time.
    const [copiedField, setCopiedField] = useState(null);

    const handleCopy = useCallback((field, value) => {
        if (!value || !navigator.clipboard) return;
        navigator.clipboard.writeText(value)
            .then(() => {
                setCopiedField(field);
                setTimeout(() => setCopiedField(prev => (prev === field ? null : prev)), 1800);
            })
            .catch(() => {});
    }, []);

    const handleLoad = (map) => {
        mapRef.current = map;
        setMapReady(true);
    };

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

            if (drawStateRef.current.path.length >= 3) {
                const livePath = drawStateRef.current.path.map(latLng => ({ lat: latLng.lat(), lng: latLng.lng() }));
                const count = [...selectedPinsRef.current, ...unselectedPinsRef.current]
                    .filter(p => pointInPolygon(p.coordinates, livePath)).length;
                setLassoPreviewCount(count);
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

    // Requests the actual driving route through `day`'s stops, in the same
    // order as their numbered pins (day[i].order === orderById's values —
    // both come from the same orderStops() call upstream). optimizeWaypoints
    // is off on purpose: that order is already ours, and letting Google
    // re-sequence the waypoints would desync the line from the numbers
    // sitting on top of it.
    useEffect(() => {
        if (!mapReady || !window.google) { setDirections(null); return; }

        if (day.length === 0 || (!origin && day.length < 2)) {
            setDirections(null);
            return;
        }

        const routeOrigin = origin || day[0].coordinates;
        const routeStops = origin ? day : day.slice(1);
        const destination = routeStops[routeStops.length - 1].coordinates;
        const waypoints = routeStops.slice(0, -1).map(stop => ({ location: stop.coordinates, stopover: true }));

        // The Directions API caps a single request at 25 points (origin +
        // destination + 23 waypoints) — bail instead of silently dropping
        // stops off an unusually large day.
        if (waypoints.length > 23) { setDirections(null); return; }

        let cancelled = false;
        new window.google.maps.DirectionsService().route({
            origin: routeOrigin,
            destination,
            waypoints,
            optimizeWaypoints: false,
            travelMode: window.google.maps.TravelMode.DRIVING
        }, (result, status) => {
            if (!cancelled) setDirections(status === 'OK' ? result : null);
        });

        return () => { cancelled = true; };
    }, [mapReady, day, origin]);

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
    const markerIcon = useCallback((pin, order) => {
        if (!window.google) return undefined;
        const inRoute = Boolean(order);
        const ring = '#20201f';

        if (!inRoute) {
            return {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: pin.recency.key === 'recent' ? 5 : 7,
                fillColor: colors[pin.recency.key],
                fillOpacity: 1,
                strokeColor: ring,
                strokeWeight: 2
            };
        }

        const size = 34;
        // The order number is drawn as real SVG text, not a separate
        // google.maps.Marker `label` — see stopNumberFontSize's comment for
        // why. (12, 9) is the round head's centre in the 24-unit viewBox;
        // dominant-baseline="central" centres the glyphs on that point
        // vertically the same way text-anchor="middle" does horizontally.
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
            `<path d="${PIN_PATH}" fill="${colors[pin.recency.key]}" stroke="${ring}" stroke-width="1.4"/>` +
            `<text x="12" y="9" text-anchor="middle" dominant-baseline="central" ` +
            `font-family="Arial, Helvetica, sans-serif" font-size="${stopNumberFontSize(order)}" ` +
            `font-weight="700" fill="#ffffff">${order}</text>` +
            `</svg>`;
        return {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new window.google.maps.Size(size, size),
            // The tip (12,22 in the 24-unit viewBox) is the actual
            // coordinate being marked, not the icon's centre.
            anchor: new window.google.maps.Point(size / 2, size * (22 / 24))
        };
    }, [colors]);

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

            {isLoaded && !loadError && (
                <GoogleMap
                    mapContainerClassName={`rpv2-map-canvas ${drawMode ? 'is-drawing' : ''}`}
                    center={origin || FALLBACK_CENTER}
                    zoom={10}
                    onLoad={handleLoad}
                    onClick={onMapClick}
                    options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
                >
                    {origin && (
                        <Marker
                            position={origin}
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

                    {/* suppressMarkers: we already draw our own numbered/
                        recency-coloured pins for every stop; Google's own
                        A/B/C markers would just duplicate them.
                        preserveViewport: a route recomputing (adding/
                        dropping a stop) shouldn't yank the map back to fit
                        the new line — the rep's own pan/zoom wins. */}
                    {directions && (
                        <DirectionsRenderer
                            directions={directions}
                            options={{
                                suppressMarkers: true,
                                preserveViewport: true,
                                polylineOptions: { strokeColor: '#2a78d6', strokeWeight: 4, strokeOpacity: 0.85 }
                            }}
                        />
                    )}

                    {selectedPins.map(pin => {
                        const order = orderById.get(pin._id);
                        return (
                            <Marker
                                key={pin._id}
                                position={pin.coordinates}
                                icon={markerIcon(pin, order)}
                                title={`${nameOf(pin)} — ${pin.recency.label}`}
                                onClick={() => onSelectPin(pin)}
                            />
                        );
                    })}

                    {/* Every other customer, always its own clickable pin —
                        no cluster badge standing in for several of them, so
                        a rep can open or lasso/radius-select any individual
                        customer regardless of how many others sit nearby. */}
                    {unselectedPins.map(pin => (
                        <Marker
                            key={pin._id}
                            position={pin.coordinates}
                            icon={markerIcon(pin)}
                            title={`${nameOf(pin)} — ${pin.recency.label}`}
                            onClick={() => onSelectPin(pin)}
                        />
                    ))}

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

            {/* A fixed panel on the right rather than a popup anchored to the
                pin (the old approach, via <InfoWindow>) — always in the same
                place regardless of where on the map the pin sits, matching
                Badger Maps' "lead details" panel. */}
            {info && (
                <div className="rpv2-panel" data-dialog="customer">
                    {/* The wash fades top-to-bottom from the recency colour
                        to nothing, rather than a flat tint — it's the org
                        name/subtitle's backdrop as much as the badge row's,
                        so it needs to still read as plain panel background
                        by the time it reaches the body below. The badge
                        pill itself carries the colour at full strength;
                        this is just the header's "whose context is this"
                        cue behind it. */}
                    <div
                        className="rpv2-panel-head"
                        style={{
                            background: `linear-gradient(180deg, ${hexToRgba(colors[info.recency.key], theme === 'light' ? 0.1 : 0.35)}, ${hexToRgba(colors[info.recency.key], 0)})`
                        }}
                    >
                        <div className="rpv2-panel-head-top">
                            <span
                                className={`rpv2-panel-badge ${RECENCY_DARK_TEXT.has(info.recency.key) ? 'is-dark-text' : ''}`}
                                style={{ background: colors[info.recency.key] }}
                            >
                                {info.recency.key === 'never' ? 'Never visited' : info.recency.label}
                            </span>
                            {orderById.has(info._id) && (
                                <span className="rpv2-panel-stop">Stop {orderById.get(info._id)}</span>
                            )}
                            <button type="button" className="rpv2-panel-close" onClick={onCloseInfo} aria-label="Close">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="rpv2-panel-name-row">
                            <strong className="rpv2-panel-name">{nameOf(info)}</strong>
                            {/* Gated by manage_customers, same as the Users &
                                Roles checkbox labelled "Edit / Add" — this is
                                the one permission the /api/partners/:id PUT
                                and DELETE routes both actually check, so a
                                role missing it never sees a button that would
                                just fail server-side anyway. */}
                            {can.manageCustomers && (
                                <div className="rpv2-panel-name-actions">
                                    <button
                                        type="button"
                                        className="rpv2-panel-icon-btn"
                                        onClick={() => onEditCustomer(info)}
                                        disabled={loadingEditCustomer}
                                        title="Edit customer"
                                        aria-label="Edit customer"
                                    >
                                        <Pencil size={15} />
                                    </button>
                                    <button type="button" className="rpv2-panel-icon-btn is-danger" onClick={() => onDeleteCustomer(info)} title="Delete customer" aria-label="Delete customer">
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="rpv2-panel-body">
                        <div className="rpv2-panel-contact">
                            {/* Grouped with phone/email now, not under the company
                                name up in the header — the contact person is who
                                you'd actually be calling/emailing at that number
                                and address, so it reads better beside them. */}
                            {real(info.contactName) && real(info.company) && (
                                <div className="rpv2-panel-sub">{real(info.contactName)}</div>
                            )}
                            {real(info.phone) && (
                                <div className="rpv2-contact-row">
                                    <a className="rpv2-contact-link" href={`tel:${real(info.phone)}`}>
                                        <Phone size={14} /><span>{real(info.phone)}</span>
                                    </a>
                                    <button
                                        type="button"
                                        className={`rpv2-panel-icon-btn rpv2-copy-btn ${copiedField === 'phone' ? 'is-copied' : ''}`}
                                        onClick={() => handleCopy('phone', real(info.phone))}
                                        title={copiedField === 'phone' ? 'Copied' : 'Copy phone number'}
                                        aria-label="Copy phone number"
                                    >
                                        {copiedField === 'phone' ? <Check size={13} /> : <Copy size={13} />}
                                    </button>
                                </div>
                            )}
                            {info.email && !isPlaceholderEmail(info.email) && (
                                <div className="rpv2-contact-row">
                                    <a className="rpv2-contact-link" href={`mailto:${info.email}`}>
                                        <Mail size={14} /><span>{info.email}</span>
                                    </a>
                                    <button
                                        type="button"
                                        className={`rpv2-panel-icon-btn rpv2-copy-btn ${copiedField === 'email' ? 'is-copied' : ''}`}
                                        onClick={() => handleCopy('email', info.email)}
                                        title={copiedField === 'email' ? 'Copied' : 'Copy email address'}
                                        aria-label="Copy email address"
                                    >
                                        {copiedField === 'email' ? <Check size={13} /> : <Copy size={13} />}
                                    </button>
                                </div>
                            )}
                            {info.marketingEmail && !isPlaceholderEmail(info.marketingEmail) ? (
                                <div className="rpv2-contact-row">
                                    <a className="rpv2-contact-link" href={`mailto:${info.marketingEmail}`}>
                                        <Mail size={14} /><span>{info.marketingEmail}</span>
                                    </a>
                                    <button
                                        type="button"
                                        className={`rpv2-panel-icon-btn rpv2-copy-btn ${copiedField === 'marketingEmail' ? 'is-copied' : ''}`}
                                        onClick={() => handleCopy('marketingEmail', info.marketingEmail)}
                                        title={copiedField === 'marketingEmail' ? 'Copied' : 'Copy marketing email address'}
                                        aria-label="Copy marketing email address"
                                    >
                                        {copiedField === 'marketingEmail' ? <Check size={13} /> : <Copy size={13} />}
                                    </button>
                                </div>
                            ) : (
                                <span className="rpv2-panel-muted"><Mail size={14} /> No marketing email on record</span>
                            )}
                            {[info.street, info.city, info.state].filter(Boolean).length > 0 ? (
                                <a
                                    className="is-address"
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([info.street, info.city, info.state].filter(Boolean).join(', '))}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <MapPin size={14} />
                                    <span>{[info.street, info.city, info.state].filter(Boolean).join(', ')}</span>
                                </a>
                            ) : (
                                <span className="rpv2-panel-muted"><MapPin size={14} /> No address on record</span>
                            )}
                        </div>

                        <dl className="rpv2-panel-facts">
                            {[
                                { label: 'Branch', value: real(info.location) },
                                { label: 'Sales Rep', value: real(info.salesRepName) },
                                { label: 'Visits', value: `${info.visitCount}` },
                                { label: 'Type', value: real(info.customerType) },
                                { label: 'Status', value: real(info.status) },
                                { label: 'Level', value: real(info.level) },
                                { label: 'Moda Display', value: real(info.modaDisplay) || 'No' },
                                { label: 'Moda Binders', value: real(info.modaBinder) || '0' },
                                // Always rendered, unlike the facts above — Notes is free text
                                // that's often blank, and "blank" is itself worth showing here
                                // rather than silently dropping the row.
                                { label: 'Notes', value: real(info.notes), alwaysShow: true }
                            ].filter(f => f.value || f.alwaysShow).map(({ label, value, alwaysShow }) => {
                                const isEmptyNotes = alwaysShow && !value;
                                return (
                                    <div key={label} className={label === 'Notes' ? 'is-notes' : ''}>
                                        <dt>{label}</dt>
                                        {label === 'Sales Rep' ? (
                                            <dd className="rpv2-panel-rep">
                                                <span className="rpv2-panel-avatar" aria-hidden="true">{value[0]?.toUpperCase()}</span>
                                                {value}
                                            </dd>
                                        ) : (
                                            <dd className={[
                                                label === 'Status' && value === 'New Lead' ? 'is-new-lead' : '',
                                                isEmptyNotes ? 'is-empty' : ''
                                            ].filter(Boolean).join(' ')}>
                                                {isEmptyNotes ? 'No notes on file' : value}
                                            </dd>
                                        )}
                                    </div>
                                );
                            })}
                        </dl>

                        {!isRoutablePrecision(info.precision) && (
                            <p className="rpv2-panel-warn">
                                <AlertTriangle size={13} />
                                This pin is the middle of the town, not the address.
                            </p>
                        )}

                        {scheduled.has(String(info._id)) && (
                            <p className="rpv2-panel-booked">
                                <Calendar size={13} />
                                Scheduled {whenLabel(scheduled.get(String(info._id)).startTime)}
                            </p>
                        )}
                    </div>

                    <div className="rpv2-panel-actions">
                        {scheduled.has(String(info._id)) ? (
                            <button className="is-drop" disabled={saving} onClick={() => onRemoveOne(info)}>
                                Remove from schedule
                            </button>
                        ) : can.plan ? (
                            <button disabled={saving} onClick={() => onAddOne(info)}>
                                Add to calendar
                            </button>
                        ) : null}
                        {onOpenCustomer && (
                            <button className="is-primary" onClick={() => { onOpenCustomer(info._id); onCloseInfo(); }}>
                                Open record
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Same fixed right-column shell as the customer panel above —
                a lead result isn't a Customer yet, so it gets its own
                lightweight variant rather than being shoehorned through
                the customer panel's recency/schedule-specific markup. */}
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
                />
            )}
        </div>
    );
};

export default MapCanvas;
