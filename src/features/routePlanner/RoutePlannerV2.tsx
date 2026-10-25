import { useState, useEffect, useMemo, useRef } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useJsApiLoader } from '@react-google-maps/api';
import { LocateFixed, Gauge } from 'lucide-react';
import { RECENCY_BUCKETS } from '../../utils/routePlan';
import { RECENCY_COLORS } from './helpers';
import MapCanvas from './map/MapCanvas';
import FilterButton from './rail/FilterButton';
import LeadSearchControl from './rail/LeadSearchControl';
import RunDrawer from './rail/RunDrawer';
import MoreMenu from './rail/MoreMenu';
import AddCustomerModalJs from '../../components/sales/AddCustomerModal';
import { toCustomerOptions } from '../../utils/customerOptions';
import { canEditCustomers, canDeleteCustomers } from '../../utils/customerAccess';
import OpenCustomerPanel from './customer/OpenCustomerPanel';
import ScheduleVisitSheet from './customer/ScheduleVisitSheet';
import MissingKeyNotice from './map/MissingKeyNotice';
import { useRoster } from './useRoster';
import { useSavedFilters } from './useSavedFilters';
import { useMapPins } from './useMapPins';
import { useFilterView } from './useFilterView';
import { useMyLocation } from './useMyLocation';
import { usePanels } from './usePanels';
import { useDayPlan } from './useDayPlan';
import { useScheduleData } from './useScheduleData';
import { useScheduleActions } from './useScheduleActions';
import { useLeadSearch } from './useLeadSearch';
import { useCustomerEdit } from './useCustomerEdit';
import type { CurrentUser, Loose } from '../../types/records';
import type { MapPin as Customer, PlannerPermissions, Preselect, RecencyBucket } from './types';
import './RoutePlannerV2.css';

// Still JavaScript; taken as taking any props until it's typed.
const AddCustomerModal = AddCustomerModalJs as unknown as ComponentType<Loose>;

/**
 * Route Planner, map-first: the full-bleed map with every control floating
 * over it instead of sharing a sidebar+map grid. This was built and shipped
 * alongside a classic sidebar+map version (RoutePlannerTab.jsx) during a
 * side-by-side comparison period; that file has since been removed and this
 * is now the only Route Planner screen.
 *
 * This file puts the screen together; each job is its own hook — the Filter's
 * saved choices (useSavedFilters) and what they show (useFilterView), the
 * customers (useMapPins), the staff lists (useRoster), the rep's location
 * (useMyLocation), the right-hand column (usePanels), the day being planned
 * (useDayPlan), the calendar (useScheduleData / useScheduleActions), lead
 * search (useLeadSearch) and the open customer's edit/delete (useCustomerEdit).
 */
export type RoutePlannerV2Props = {
    currentUser?: CurrentUser | null;
    theme?: string;
    /** Opens the customer's full profile (by id). */
    onOpenCustomer?: ((id: string) => void) | null;
    onAddVisit?: ((pin: Customer) => void) | null;
    onAddResource?: ((pin: Customer) => void) | null;
    /** The app's side-nav button, drawn first in the map's rail. */
    sidebarToggle?: ReactNode;
    /** This page is the one on screen (it stays mounted, hidden, once opened). */
    isActive?: boolean;
    preselect?: Preselect;
};

const RoutePlannerV2 = ({ currentUser = null, theme = 'dark', onOpenCustomer = null, onAddVisit = null, onAddResource = null, sidebarToggle = null, isActive = true, preselect = null }: RoutePlannerV2Props) => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    const { isLoaded, loadError } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: apiKey || '' });

    const colors = RECENCY_COLORS[theme === 'light' ? 'light' : 'dark'];

    const [error, setError] = useState('');
    // Google's own live-conditions overlay (TrafficLayer) — purely a map
    // display toggle with nothing else in the app depending on it, so it
    // stays local UI state here rather than something worth persisting.
    const [showTraffic, setShowTraffic] = useState(false);

    const can = useMemo((): PlannerPermissions => {
        const held = currentUser?.permissions || [];
        return {
            plan: held.includes('create_route_plan'),
            replace: held.includes('edit_route_plan'),
            clear: held.includes('delete_route_plan'),
            manageCustomers: canEditCustomers(currentUser),
            deleteCustomers: canDeleteCustomers(currentUser)
        };
    }, [currentUser]);

    const mapRef = useRef<google.maps.Map | null>(null);
    const myId = String(currentUser?.id || currentUser?._id || '');

    const roster = useRoster(currentUser);
    const filters = useSavedFilters({ currentUser, myId, salesReps: roster.salesReps, scopedReps: roster.scopedReps });
    const pinsData = useMapPins({ isActive, activeSalesReps: filters.activeSalesReps, repsReady: filters.repsReady, setError });
    const { pins } = pinsData;
    const view = useFilterView({
        currentUser, myId, pins, repCounts: pinsData.repCounts, scopedReps: roster.scopedReps,
        activeSalesReps: filters.activeSalesReps, setActiveSalesReps: filters.setActiveSalesReps,
        activeTypes: filters.activeTypes, setActiveTypes: filters.setActiveTypes, activeBuckets: filters.activeBuckets
    });
    const location = useMyLocation({ mapRef, isActive, setError });
    const panels = usePanels({ mapRef, currentUser, detailsCache: pinsData.detailsCache, pinById: pinsData.pinById });
    const plan = useDayPlan({
        pins, visible: view.visible, origin: location.origin, setOrigin: location.setOrigin,
        setDrawMode: panels.setDrawMode, setShowToolsPanel: panels.setShowToolsPanel, preselect
    });
    const schedule = useScheduleData();
    const actions = useScheduleActions({ schedule, date: plan.date, replaceExisting: plan.replaceExisting, canReplace: can.replace, setError });
    const leads = useLeadSearch({ mapRef, currentUser, setLeadInfo: panels.setLeadInfo, reload: pinsData.load });
    const edit = useCustomerEdit({ setPins: pinsData.setPins, setInfo: panels.setInfo, setReturnPanel: panels.setReturnPanel, reload: pinsData.load, setError });

    // This component stays mounted behind display:none when you navigate
    // away (see SalesTabViews.tsx), so the map instance survives.
    useEffect(() => {
        if (!isActive || !mapRef.current || !window.google) return;
        const map = mapRef.current;
        const held = map.getCenter();
        window.google.maps.event.trigger(map, 'resize');
        if (held) map.setCenter(held);
    }, [isActive]);

    // ScheduleVisitForm's customer picker — the customers already loaded for
    // the map (only ones with a pin can be put on a route), shaped by the same
    // rules as every other customer dropdown (customerOptions.js) rather than
    // a second fetch of the same data.
    const customerOptions = useMemo(() => toCustomerOptions(pins), [pins]);

    // "Schedule a visit" (ScheduleVisitSheet): the customer being put on a day, or
    // rescheduled.
    const [scheduleSheet, setScheduleSheet] = useState<Customer | null>(null);

    // Clears the selection and closes the Tools panel on success — the
    // latter is a no-op when this was triggered from the area-list panel
    // instead (the two panels are mutually exclusive, so the Tools panel is
    // already closed in that case).
    const scheduleDay = () => actions.scheduleStops(plan.day, () => {
        plan.clearSelection();
        panels.setShowToolsPanel(false);
    });

    if (!apiKey) {
        return <MissingKeyNotice />;
    }

    // Rendered as its own slot (not part of areaControls below) so RunDrawer
    // can place it right after the sidebar toggle — Dashboard, Filter,
    // Tools, Calendar — instead of after Tools/Calendar with the rest of
    // the area controls.
    const filterControl = (
        <FilterButton open={panels.showFilterPanel} active={view.filtersActive} onClick={panels.toggleFilterPanel} />
    );

    // Everything that used to float in a separate top bar now lives in the
    // run drawer's collapsed row instead (built once here and handed down
    // as a prop, rather than drilling another dozen individual props
    // through RunDrawer just to re-render the exact same elements one file
    // over). Order matters here: lead search first, then locate at the very
    // bottom — adjusting the map itself is the last step, not the first.
    // The phone bar's three-line menu: Find new leads and Live traffic, which
    // only exist as separate icons on the desktop rail.
    const moreControl = isLoaded && !loadError ? (
        <MoreMenu
            leadQuery={leads.leadQuery}
            onLeadQueryChange={leads.setLeadQuery}
            onLeadSearch={leads.searchLeads}
            leadSearching={leads.leadSearching}
            recentLeads={leads.recentLeadSearches}
            onRemoveRecent={leads.removeRecent}
            showTraffic={showTraffic}
            onToggleTraffic={() => setShowTraffic(v => !v)}
        />
    ) : null;

    const areaControls = (
        <>
            {isLoaded && !loadError && (
                <LeadSearchControl
                    query={leads.leadQuery}
                    onQueryChange={leads.setLeadQuery}
                    onSearch={leads.searchLeads}
                    searching={leads.leadSearching}
                    recent={leads.recentLeadSearches}
                    onRemoveRecent={leads.removeRecent}
                />
            )}
            {isLoaded && !loadError && (
                <button
                    type="button"
                    className={`rpv2-traffic-btn ${showTraffic ? 'is-on' : ''}`}
                    onClick={() => setShowTraffic(v => !v)}
                    title={showTraffic ? 'Hide live traffic' : 'Show live traffic'}
                    aria-label={showTraffic ? 'Hide live traffic' : 'Show live traffic'}
                    aria-pressed={showTraffic}
                >
                    <Gauge size={16} />
                </button>
            )}
            {isLoaded && !loadError && (
                <button
                    type="button"
                    className="rpv2-locate-btn"
                    onClick={location.goToMyLocation}
                    title="Centre the map on my location"
                    aria-label="Centre the map on my location"
                >
                    <LocateFixed size={16} />
                </button>
            )}
        </>
    );

    const { info } = panels;

    return (
        <div className="rpv2-shell">
            <MapCanvas
                mapRef={mapRef}
                theme={theme}
                colors={colors}
                isLoaded={isLoaded}
                loadError={loadError}
                showTraffic={showTraffic}
                origin={location.origin}
                myPosition={location.myPosition}
                unselectedPins={plan.unselectedPins}
                orderById={plan.orderById}
                info={info}
                onSelectPin={panels.showDetails}
                leadResults={leads.leadResults}
                leadInfo={panels.leadInfo}
                onSelectLead={panels.showLeadDetails}
                onCloseLeadInfo={() => panels.setLeadInfo(null)}
                showFilterPanel={panels.showFilterPanel}
                onCloseFilterPanel={() => panels.setShowFilterPanel(false)}
                types={view.types}
                activeTypes={filters.activeTypes}
                typeCounts={view.typeCounts}
                onToggleType={filters.toggleType}
                onToggleAllTypes={view.toggleAllTypes}
                recencyBuckets={RECENCY_BUCKETS as RecencyBucket[]}
                activeBuckets={filters.activeBuckets}
                recencyCounts={view.counts}
                onToggleBucket={filters.toggleBucket}
                salesRepOptions={view.salesRepOptions}
                activeSalesReps={filters.activeSalesReps}
                repCounts={pinsData.repCounts}
                onToggleSalesRep={filters.toggleSalesRep}
                onToggleAllSalesReps={view.toggleAllSalesReps}
                colorMode={filters.colorMode}
                onColorModeChange={filters.setColorMode}
                lastKnownPosition={location.lastKnownPosition}
                scopeNote={view.scopeLocations ? `Your locations: ${view.scopeLocations.join(', ') || 'none'}` : ''}
                replaceExisting={plan.replaceExisting}
                onReplaceExistingChange={plan.setReplaceExisting}
                onClearPlannedDay={actions.clearPlannedDay}
                date={plan.date}
                onDateChange={(v) => { plan.setDate(v); actions.setSaved(null); }}
                startAt={plan.startAt}
                onStartAtChange={plan.setStartAt}
                stopMinutes={plan.stopMinutes}
                onStopMinutesChange={plan.setStopMinutes}
                day={plan.day}
                summary={plan.summary}
                onScheduleDay={scheduleDay}
                saved={actions.saved}
                onSaveLead={leads.saveLead}
                savingLead={leads.savingLead}
                canSaveLead={can.manageCustomers}
                leadError={leads.leadError}
                can={can}
                saving={actions.saving}
                loading={pinsData.loading}
                pinsCount={pins.length}
                error={error}
                onMapClick={panels.handleMapClick}
                showToolsPanel={panels.showToolsPanel}
                onCloseToolsPanel={panels.toggleToolsPanel}
                showCustomersPanel={panels.showCustomersPanel}
                onCloseCustomersPanel={panels.toggleCustomersPanel}
                allCustomers={pins}
                onSelectCustomer={panels.showCustomerFromList}
                drawMode={panels.drawMode}
                onArmRadius={panels.armRadiusTool}
                onArmLasso={panels.armLassoTool}
                onLocateMe={location.goToMyLocation}
                onRadiusSelect={plan.handleRadiusSelect}
                onLassoSelect={plan.handleLassoSelect}
                selectionShape={plan.selectionShape}
                selectedPins={plan.selectedPins}
                onRemoveSelectedPoint={plan.removeSelectedPoint}
                onReorderStop={plan.reorderStop}
                showSchedulePanel={panels.showSchedulePanel}
                onCloseSchedulePanel={panels.toggleSchedulePanel}
                visitsByDate={schedule.visitsByDate}
                onSelectScheduledVisit={panels.showScheduledVisit}
                onScheduleMonthChange={schedule.loadScheduleMonth}
                scheduleMonthLoading={schedule.monthLoading}
                onDeleteScheduledVisit={actions.deleteScheduledVisit}
                customerOptions={customerOptions}
                onSaveScheduledVisit={actions.saveScheduleVisit}
                savingVisit={actions.savingVisit}
            />

            <RunDrawer
                sidebarToggle={sidebarToggle}
                filterControl={filterControl}
                showToolsPanel={panels.showToolsPanel}
                onToggleToolsPanel={panels.toggleToolsPanel}
                showCustomersPanel={panels.showCustomersPanel}
                onToggleCustomersPanel={panels.toggleCustomersPanel}
                showSchedulePanel={panels.showSchedulePanel}
                onToggleSchedulePanel={panels.toggleSchedulePanel}
                areaControls={areaControls}
                moreControl={moreControl}
            />

            {info && (
                <OpenCustomerPanel
                    info={info}
                    day={plan.day}
                    pinById={pinsData.pinById}
                    returnPanel={panels.returnPanel}
                    showDetails={panels.showDetails}
                    onClose={panels.closeInfo}
                    currentUser={currentUser}
                    onOpenCustomer={onOpenCustomer}
                    onEdit={edit.openEditCustomer}
                    onDelete={edit.deleteCustomer}
                    onStatusChange={edit.changeStatus}
                    can={can}
                    colors={colors}
                    booking={schedule.scheduled.get(String(info._id)) || null}
                    saving={actions.saving}
                    onSchedule={setScheduleSheet}
                    onRemove={actions.removeFromCalendar}
                    onAddVisit={onAddVisit}
                    onAddResource={onAddResource}
                />
            )}

            {scheduleSheet && (
                <ScheduleVisitSheet
                    customer={scheduleSheet}
                    booking={schedule.scheduled.get(String(scheduleSheet._id)) || null}
                    visitsByDate={schedule.visitsByDate}
                    minutes={Number(plan.stopMinutes) || 45}
                    saving={actions.saving}
                    onClose={() => setScheduleSheet(null)}
                    onSave={actions.saveVisitSlot}
                />
            )}

            {/* Same modal features/customers/list/PartnersSheet.tsx uses for editing a customer —
                editingCustomer puts it in edit mode; passing it here rather
                than building a second edit form for the map's detail panel. */}
            <AddCustomerModal
                show={Boolean(edit.editingCustomer)}
                onClose={() => edit.setEditingCustomer(null)}
                onSave={edit.saveCustomerEdit}
                isSaving={edit.savingCustomerEdit}
                editingCustomer={edit.editingCustomer}
                salesReps={roster.salesReps}
                locations={roster.locationOptions}
                currentUser={currentUser}
            />
        </div>
    );
};

export default RoutePlannerV2;
