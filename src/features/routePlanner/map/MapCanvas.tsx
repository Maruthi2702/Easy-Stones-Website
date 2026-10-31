import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { GoogleMap, Marker, DirectionsRenderer, TrafficLayer } from '@react-google-maps/api';
import { Lasso, LocateFixed } from 'lucide-react';
import FilterPanel from '../panels/FilterPanel';
import type { FilterPanelProps } from '../panels/FilterPanel';
import ToolsPanel from '../panels/ToolsPanel';
import type { DayScheduleProps } from '../panels/AreaScheduleSection';
import CustomersPanel from '../panels/CustomersPanel';
import SchedulePanel from '../panels/SchedulePanel';
import PinLayer from './PinLayer';
import LeadPanel from './LeadPanel';
import { leadMarkerIcon, usePinIcons } from './markerIcons';
import { useMapView } from './useMapView';
import { useDrawGestures } from './useDrawGestures';
import { useDirections } from './useDirections';
import type { CustomerOption } from '../../../utils/customerOptions';
import type {
    ColorMode, DrawMode, LatLng, Lead, MapPin as Customer, Pin, RecencyBucket, RecencyColors, RepOption, ReturnPanel,
    ScheduleRow, ScheduleVisitInput, SelectionShape, Toggles
} from '../types';
import './MapCanvas.css';

/**
 * GoogleMap wrapper: the individually-numbered pins for the current Tools
 * panel selection, a plain pin for every other customer, the Tools panel's
 * own draw-gesture overlays (useDrawGestures), the route line (useDirections),
 * the badges and the right-hand panels. Every customer gets its own always-clickable pin — no
 * cluster badges collapsing several into a count a rep can't act on — the
 * same "always individual pins" approach Badger Maps uses, since a rep
 * needs to be able to select or open any one customer regardless of how
 * many others sit near it on screen.
 */
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
const MAP_OPTIONS: google.maps.MapOptions = {
    streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
    gestureHandling: 'greedy', clickableIcons: false,
    ...(MAP_ID ? { mapId: MAP_ID, tiltInteractionEnabled: false, headingInteractionEnabled: false } : {})
};

/** The map gets the loaded Maps API's state, everything it draws, and each panel's props. */
export type MapCanvasProps = DayScheduleProps & {
    mapRef: MutableRefObject<google.maps.Map | null>;
    theme?: string;
    colors: RecencyColors;
    colorMode?: ColorMode;
    onColorModeChange: (mode: ColorMode) => void;
    scopeNote: string;
    lastKnownPosition?: LatLng | null;
    isLoaded: boolean;
    loadError: Error | undefined;
    showTraffic: boolean;
    origin: LatLng | null;
    myPosition: LatLng | null;
    unselectedPins: Customer[];
    orderById: Map<string, number>;
    info: Customer | null;
    onSelectPin: (pin: Customer, origin?: ReturnPanel) => void;
    leadResults: Lead[];
    leadInfo: Lead | null;
    onSelectLead: (place: Lead) => void;
    onCloseLeadInfo: () => void;
    onSaveLead: (place: Lead) => void;
    savingLead: boolean;
    canSaveLead: boolean;
    leadError: string;
    showFilterPanel: boolean;
    onCloseFilterPanel: () => void;
    types: string[];
    activeTypes: Toggles;
    typeCounts: Record<string, number>;
    onToggleType: (type: string) => void;
    onToggleAllTypes: (showAll: boolean) => void;
    recencyBuckets: RecencyBucket[];
    activeBuckets: Toggles;
    recencyCounts: Record<string, number>;
    onToggleBucket: (key: string) => void;
    salesRepOptions: RepOption[];
    activeSalesReps: Toggles;
    repCounts: Record<string, number>;
    onToggleSalesRep: (key: string) => void;
    onToggleAllSalesReps: FilterPanelProps['onToggleAllSalesReps'];
    loading: boolean;
    pinsCount: number;
    error: string;
    onMapClick: () => void;
    showToolsPanel: boolean;
    onCloseToolsPanel: () => void;
    drawMode: DrawMode;
    onArmRadius: () => void;
    onArmLasso: () => void;
    onLocateMe: () => void;
    onRadiusSelect: (center: LatLng, radiusMeters: number) => void;
    onLassoSelect: (path: LatLng[]) => void;
    selectionShape: SelectionShape | null;
    selectedPins: Customer[];
    onRemoveSelectedPoint: (pin: Customer) => void;
    onReorderStop: (draggedId: string, targetId: string) => void;
    showCustomersPanel: boolean;
    onCloseCustomersPanel: () => void;
    allCustomers: Pin[];
    onSelectCustomer: (pin: Pin) => void;
    showSchedulePanel: boolean;
    onCloseSchedulePanel: () => void;
    visitsByDate: Map<string, ScheduleRow[]>;
    onSelectScheduledVisit: (visit: ScheduleRow) => void;
    onScheduleMonthChange: (month: Date) => void;
    onDeleteScheduledVisit: (visit: ScheduleRow) => void;
    scheduleMonthLoading: boolean;
    customerOptions: CustomerOption[];
    onSaveScheduledVisit: (form: ScheduleVisitInput, visitId?: string) => Promise<ScheduleRow | null>;
    savingVisit: boolean;
};

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
}: MapCanvasProps) => {
    const { mapReady, drawBounds, initialCenter, handleLoad } = useMapView({ mapRef, origin, lastKnownPosition });
    // Whether the Tools panel's inline scheduling section is open — lives
    // here rather than inside ToolsPanel since MapCanvas is what actually
    // renders the AreaScheduleSection block that toggling this shows.
    const [scheduleOpen, setScheduleOpen] = useState(false);
    // The pins' click handler, stable across renders so the memoised PinLayer
    // isn't invalidated by it.
    const onSelectPinRef = useRef(onSelectPin);
    useEffect(() => { onSelectPinRef.current = onSelectPin; }, [onSelectPin]);
    const selectPin = useCallback((pin: Customer) => onSelectPinRef.current(pin), []);

    const { lassoPreviewCount } = useDrawGestures({ mapRef, mapReady, drawMode, selectionShape, onRadiusSelect, onLassoSelect, selectedPins, unselectedPins });
    const { directions, directionsRequest } = useDirections({ day, origin, mapReady });
    const markerIcon = usePinIcons(colors, colorMode);

    return (
        <div className="rpv2-map">
            {loadError && <div className="rpv2-map-empty"><p>Google Maps failed to load: {loadError.message}</p></div>}
            {!loadError && !isLoaded && <div className="rpv2-map-empty"><p>Loading the map…</p></div>}

            {loading && <div className="rpv2-badge">Loading customers…</div>}
            {!loading && !error && pinsCount === 0 && (
                <div className="rpv2-badge rpv2-badge-warn">
                    No customer has coordinates yet — run <code>node scripts/geocode-customers.ts --apply</code>
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
                            position={(myPosition || origin)!}
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
                <LeadPanel lead={leadInfo} onClose={onCloseLeadInfo} onSave={onSaveLead} saving={savingLead} canSave={canSaveLead} />
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
