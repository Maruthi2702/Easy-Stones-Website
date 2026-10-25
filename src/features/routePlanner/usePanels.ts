import { useState, useEffect, useCallback, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { canViewCustomerProfile } from '../../utils/customerAccess';
import { visitRecency, customerOf } from './helpers';
import type { CurrentUser, Loose } from '../../types/records';
import type { DrawMode, Lead, MapPin as Customer, Pin, ReturnPanel, ScheduleRow } from './types';

// The customer panel's width on desktop, echoed in MapActions.css's
// .cl-drawer.rpv2-host — no shared constant across JS/CSS, so both need to move
// together if this changes.
const PANEL_WIDTH = 460;

export type PanelsDeps = {
    mapRef: MutableRefObject<google.maps.Map | null>;
    currentUser: CurrentUser | null;
    /** Details fetched when a customer was opened before (useMapPins). */
    detailsCache: MutableRefObject<Map<string, Loose>>;
    pinById: Map<string, Pin>;
};

/**
 * What sits in the right-hand column — one at a time: Filter, Tools,
 * Customers, Schedule, the open customer, or a lead from the map search —
 * and the Tools panel's armed draw gesture (leaving Tools disarms it).
 * Opening a customer from a row brings that panel back when it closes.
 */
export function usePanels({ mapRef, currentUser, detailsCache, pinById }: PanelsDeps) {
    const [showFilterPanel, setShowFilterPanel] = useState(false);

    // The Tools panel's selection — the one and only source a day gets
    // planned from (see useDayPlan). Two draw gestures feed the same
    // selectedIds: a dragged circle (Radius) or a freehand outline
    // (Lasso) — drawMode tracks which one is currently armed (null when
    // neither is).
    const [showToolsPanel, setShowToolsPanel] = useState(false);
    // CustomersPanel — a searchable directory over the full `pins` list
    // (unfiltered by Filter/Tools), mutually exclusive with the other
    // panels below the same way they already are with each other.
    const [showCustomersPanel, setShowCustomersPanel] = useState(false);
    const [drawMode, setDrawMode] = useState<DrawMode>(null);

    const [info, setInfo] = useState<Customer | null>(null);
    // Which panel (if any) showDetails hid to make room for `info` in the
    // shared right column — 'tools' | null. Lets closeInfo bring Tools back
    // instead of leaving the column empty when a customer's detail popup
    // was opened by clicking a row inside it, rather than by clicking its
    // pin on the map.
    const [returnPanel, setReturnPanel] = useState<ReturnPanel>(null);
    const [showSchedulePanel, setShowSchedulePanel] = useState(false);
    // A lead-search result opened from the map (see useLeadSearch).
    const [leadInfo, setLeadInfo] = useState<Lead | null>(null);

    // Kept stable (useCallback) so MapCanvas's pin layer — which takes this
    // as onSelectPin — doesn't redraw every marker whenever the page
    // re-renders for an unrelated reason.
    // `origin` names the panel this popup is replacing in the right column
    // ('tools' | 'customers' | 'schedule'), so closeInfo knows what to bring
    // back — left null for a plain pin click on the map, which has nothing
    // to return to.
    // A pin is slim (src/routes/customerMap.js): phone, email, address, notes… are
    // fetched when a customer is opened, and kept for the next time (cleared by
    // load(), since an edit elsewhere changes them).
    const detailsRequest = useRef(0);
    const showDetails = useCallback((customer: Customer, origin: ReturnPanel = null) => {
        const cachedDetails = customer?._id ? detailsCache.current.get(String(customer._id)) : null;
        // The shared panel fetches the full record itself; this is only for a login
        // without Full profile, whose basic card needs the contact details.
        if (customer?._id && !cachedDetails && !canViewCustomerProfile(currentUser)) {
            const request = ++detailsRequest.current;
            authFetch(`${API_URL}/api/customers/map/${customer._id}`)
                .then(res => (res.ok ? res.json() : null))
                .then((details: Loose | null) => {
                    if (details) detailsCache.current.set(String(customer._id), details);
                    if (request !== detailsRequest.current) return;
                    if (details) setInfo(prev => (prev && String(prev._id) === String(customer._id) ? { ...prev, ...details } : prev));
                })
                .catch(() => { /* the panel just shows what the pin has */ });
        } else {
            detailsRequest.current += 1;
        }
        setLeadInfo(null);
        setShowFilterPanel(false);
        setShowToolsPanel(false);
        setShowCustomersPanel(false);
        setShowSchedulePanel(false);
        setReturnPanel(origin);
        setInfo(cachedDetails ? { ...customer, ...cachedDetails } : customer);
        if (!mapRef.current || !customer?.coordinates) return;
        mapRef.current.panTo(customer.coordinates);
        // The customer panel covers part of the map, so panTo alone would centre
        // the pin right where the panel is about to cover it. On desktop it's a
        // column on the right (PANEL_WIDTH wide): shift the view left by half of
        // it. On a phone it's a sheet from below that leaves a strip of map at
        // the top: put the pin in that strip.
        if (window.innerWidth >= 640) {
            mapRef.current.panBy(PANEL_WIDTH / 2, 0);
        } else {
            const height = mapRef.current.getDiv?.().clientHeight || window.innerHeight;
            mapRef.current.panBy(0, Math.max(0, height / 2 - 70));
        }
    }, [currentUser, mapRef, detailsCache]);

    // Closes the customer detail popup the way a "back" action would: if it
    // was opened from a row inside Tools, Customers, or Schedule (see
    // showDetails/showScheduledVisit), that panel reopens instead of leaving
    // the right column empty — otherwise dismissing the popup silently
    // dropped whichever panel it had replaced, with no way back to it short
    // of redrawing a selection, re-searching, or re-finding the same day on
    // the calendar.
    const closeInfo = useCallback(() => {
        setInfo(null);
        if (returnPanel === 'tools') setShowToolsPanel(true);
        if (returnPanel === 'customers') setShowCustomersPanel(true);
        if (returnPanel === 'schedule') setShowSchedulePanel(true);
        setReturnPanel(null);
    }, [returnPanel]);

    // Esc closes the open customer's panel, as it does on the Customers tab.
    useEffect(() => {
        if (!info) return undefined;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) closeInfo(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [info, closeInfo]);

    // Same fixed-column treatment as showDetails, for a lead-search result
    // instead of a Customer — the two panels are mutually exclusive (opening
    // one closes the other) since both occupy the same right-hand column.
    const showLeadDetails = useCallback((place: Lead) => {
        setInfo(null);
        setReturnPanel(null);
        setShowFilterPanel(false);
        setShowToolsPanel(false);
        setShowCustomersPanel(false);
        setShowSchedulePanel(false);
        setLeadInfo(place);
        if (!mapRef.current || !place?.coordinates) return;
        mapRef.current.panTo(place.coordinates);
        mapRef.current.panBy(PANEL_WIDTH / 2, 0);
    }, [mapRef]);

    const toggleFilterPanel = () => {
        setShowFilterPanel(prev => {
            if (!prev) { setInfo(null); setReturnPanel(null); setLeadInfo(null); setShowToolsPanel(false); setShowCustomersPanel(false); setShowSchedulePanel(false); }
            return !prev;
        });
    };

    const toggleToolsPanel = () => {
        setShowToolsPanel(prev => {
            if (!prev) {
                setInfo(null); setReturnPanel(null); setLeadInfo(null); setShowFilterPanel(false); setShowCustomersPanel(false); setShowSchedulePanel(false);
            } else {
                // Leaving the panel also leaves draw mode — otherwise the
                // map would stay armed for a drag/freehand draw with no
                // panel visible to disarm it from.
                setDrawMode(null);
            }
            return !prev;
        });
    };

    const toggleCustomersPanel = () => {
        setShowCustomersPanel(prev => {
            if (!prev) { setInfo(null); setReturnPanel(null); setLeadInfo(null); setShowFilterPanel(false); setShowToolsPanel(false); setShowSchedulePanel(false); }
            return !prev;
        });
    };

    const toggleSchedulePanel = () => {
        setShowSchedulePanel(prev => {
            if (!prev) {
                setInfo(null); setReturnPanel(null); setLeadInfo(null); setShowFilterPanel(false); setShowToolsPanel(false); setShowCustomersPanel(false);
                // Same reasoning as toggleToolsPanel's else-branch: switching
                // to Schedule while Tools had a draw armed shouldn't leave
                // the map stuck expecting a drag gesture with no panel left
                // to disarm it from.
                setDrawMode(null);
            }
            return !prev;
        });
    };

    // Opens a scheduled visit's customer from SchedulePanel's day list —
    // the schedule row only carries the populated {contactName, company}
    // subset (see server.js's /api/schedule populate), not the full pin
    // (coordinates, recency, etc.) showDetails/MapCanvas need, so this looks
    // the real record up in `pins` by id first. Silently no-ops if the
    // customer isn't on the map (no coordinates, or removed since the visit
    // was booked) rather than opening a detail panel with nothing to show.
    const showScheduledVisit = useCallback((visit: ScheduleRow) => {
        const id = String(customerOf(visit)?._id || visit.customerId || '');
        const pin = pinById.get(id);
        if (!pin) return;
        showDetails({ ...pin, recency: visitRecency(pin.lastVisitAt) }, 'schedule');
    }, [pinById, showDetails]);

    // Opens a customer from CustomersPanel's directory — unlike
    // showScheduledVisit above, CustomersPanel already hands back the full
    // pin (it iterates raw `pins` directly, not a populated-subset schedule
    // row), so this only needs to attach recency before handing off to
    // showDetails, the same enrichment `visible`/`selectedPins` apply
    // elsewhere in this module.
    const showCustomerFromList = useCallback(
        (pin: Pin) => showDetails({ ...pin, recency: visitRecency(pin.lastVisitAt) }, 'customers'),
        [showDetails]
    );

    const armRadiusTool = () => setDrawMode(m => (m === 'radius' ? null : 'radius'));
    const armLassoTool = () => setDrawMode(m => (m === 'lasso' ? null : 'lasso'));

    const handleMapClick = () => {
        // While the Tools panel's Radius or Lasso mode is armed, a click is
        // part of a drag/freehand-draw gesture (or an accidental tap) —
        // either way it shouldn't also dismiss the panels below.
        if (drawMode) return;
        closeInfo();
        setLeadInfo(null);
        setShowFilterPanel(false);
    };

    return {
        showFilterPanel, setShowFilterPanel, showToolsPanel, setShowToolsPanel, showCustomersPanel, showSchedulePanel,
        drawMode, setDrawMode, info, setInfo, returnPanel, setReturnPanel, leadInfo, setLeadInfo,
        showDetails, closeInfo, showLeadDetails, showScheduledVisit, showCustomerFromList,
        toggleFilterPanel, toggleToolsPanel, toggleCustomersPanel, toggleSchedulePanel,
        armRadiusTool, armLassoTool, handleMapClick
    };
}

export type Panels = ReturnType<typeof usePanels>;
