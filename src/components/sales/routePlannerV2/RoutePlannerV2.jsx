import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useJsApiLoader } from '@react-google-maps/api';
import { MapPin, LocateFixed, Gauge } from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { saveDraft, loadDraft, clearDraft } from '../../../utils/sessionDraft';
import { toSalesRepList } from '../../../utils/salesReps';
import {
    orderStops, planDay, daySummary, visitRecency,
    hasPoint, localISO, milesBetween, pointInPolygon, RECENCY_BUCKETS, DEFAULT_DAY
} from '../../../utils/routePlan';
import {
    RECENCY_COLORS, todayKey, pad, nameOf, whenLabel,
    parseAddressComponents, loadRecentLeadSearches, saveRecentLeadSearch, removeRecentLeadSearch
} from './helpers';
import MapCanvas from './MapCanvas';
import FilterButton from './FilterButton';
import LeadSearchControl from './LeadSearchControl';
import RunDrawer from './RunDrawer';
import AddCustomerModal from '../AddCustomerModal';
import './RoutePlannerV2.css';

/**
 * Route Planner, map-first: the full-bleed map with every control floating
 * over it instead of sharing a sidebar+map grid. This was built and shipped
 * alongside a classic sidebar+map version (RoutePlannerTab.jsx) during a
 * side-by-side comparison period; that file has since been removed and this
 * is now the only Route Planner screen.
 */
// Echoed in MapCanvas.css's .rpv2-panel width — no shared constant across
// JS/CSS, so both need to move together if this changes.
const PANEL_WIDTH = 360;

// Pure — doesn't close over anything component-specific — so it's hoisted
// here rather than redefined every render inside the component body, which
// would otherwise need explaining away in every useMemo that calls it.
const repKey = (salesRep) => String(salesRep || '') || 'unassigned';

const RoutePlannerV2 = ({ currentUser = null, theme = 'dark', onOpenCustomer = null, onAddVisit = null, onAddResource = null, sidebarToggle = null, isActive = true }) => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    const { isLoaded, loadError } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: apiKey || '' });

    const colors = RECENCY_COLORS[theme === 'light' ? 'light' : 'dark'];

    const [pins, setPins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Keyed by sales rep id (or 'unassigned'), same on/off shape as
    // activeTypes/activeBuckets — replaces the old boolean mineOnly, which
    // could only ever mean "just me" or "everyone" and had no way to show,
    // say, two reps covering the same territory. Seeded to "just me" the
    // first time myId/salesReps are known (see the sync effect below), so
    // the default behaviour is unchanged even though the model isn't.
    const [activeSalesReps, setActiveSalesReps] = useState({});
    const [activeBuckets, setActiveBuckets] = useState({ never: true, overdue: true, due: true, recent: true });
    // Multi-select, not the single dropdown value this replaced — every type
    // (plus the synthetic '(blank)' bucket for pins with none set) defaults
    // to shown, same on/off-per-key shape as activeBuckets above. Synced from
    // `types` below as new ones appear, since that list is data-driven and
    // can't be known up front.
    const [activeTypes, setActiveTypes] = useState({});
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    // Google's own live-conditions overlay (TrafficLayer) — purely a map
    // display toggle with nothing else in the app depending on it, so it
    // stays local UI state here rather than something worth persisting.
    const [showTraffic, setShowTraffic] = useState(false);

    // The Tools panel's selection — the one and only source a day gets
    // planned from (see the `day` memo below). Two draw gestures feed the
    // same selectedIds: a dragged circle (Radius) or a freehand outline
    // (Lasso) — drawMode tracks which one is currently armed (null when
    // neither is). Either kind of draw replaces selectedIds outright (see
    // handleRadiusSelect/handleLassoSelect below) rather than adding to it;
    // it otherwise persists — across filter changes, and against manual
    // add/remove via Selected Points — until the rep clears it or acts on
    // it via Mass Update or Create Route.
    const [showToolsPanel, setShowToolsPanel] = useState(false);
    // CustomersPanel — a searchable directory over the full `pins` list
    // (unfiltered by Filter/Tools), mutually exclusive with the other
    // panels below the same way they already are with each other.
    const [showCustomersPanel, setShowCustomersPanel] = useState(false);
    const [drawMode, setDrawMode] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set());
    // The circle/lasso boundary that produced the current selectedIds — kept
    // around after the draw gesture ends (unlike drawMode, which clears
    // immediately) purely so it can stay drawn on the map as a visual answer
    // to "why these customers". Replaced by the next draw, cleared alongside
    // selectedIds by clearSelection.
    const [selectionShape, setSelectionShape] = useState(null);
    // A rep's manual drag-to-reorder of the Tools panel's stop list,
    // overriding the orderStops geography-based order below until the
    // selection itself changes — same ids, same set, just a different
    // sequence through them. Reset to null (falls back to the computed
    // order) whenever selectedIds changes, since a new draw/add/remove
    // invalidates whatever arrangement was tuned for the old set.
    const [manualOrderIds, setManualOrderIds] = useState(null);
    useEffect(() => { setManualOrderIds(null); }, [selectedIds]);

    const [info, setInfo] = useState(null);
    // Which panel (if any) showDetails hid to make room for `info` in the
    // shared right column — 'tools' | null. Lets closeInfo bring Tools back
    // instead of leaving the column empty when a customer's detail popup
    // was opened by clicking a row inside it, rather than by clicking its
    // pin on the map.
    const [returnPanel, setReturnPanel] = useState(null);
    const [scheduled, setScheduled] = useState(new Map());
    const [showSchedulePanel, setShowSchedulePanel] = useState(false);
    // Every schedule row SchedulePanel's calendar has ever fetched, keyed by
    // its own _id (not deduped by customer like `scheduled` above — a day
    // can have several visits for different customers, or even the same
    // one twice). Accumulates across loadScheduled's initial fetch and
    // loadScheduleMonth's per-month fetches below, since either can cover
    // overlapping ranges; keying by _id makes re-fetching a range that
    // overlaps an earlier one a harmless no-op merge instead of a dupe.
    const [scheduleById, setScheduleById] = useState(new Map());
    // Which 'YYYY-MM' months loadScheduleMonth has already fetched, so
    // paging SchedulePanel's calendar back and forth doesn't re-request the
    // same range every time. A ref rather than state — it's read/written
    // inside loadScheduleMonth itself and never drives a render on its own.
    const fetchedMonthsRef = useRef(new Set());
    // A count, not a boolean — paging quickly through several uncached
    // months can leave more than one loadScheduleMonth request in flight
    // at once, and the spinner SchedulePanel shows off this should only
    // clear once every one of them has actually landed.
    const [monthFetchesInFlight, setMonthFetchesInFlight] = useState(0);
    // Separate from `saving` below — that one covers the Tools panel's
    // route-day scheduling flow; this is ScheduleVisitForm's own
    // add/edit save, a different action with its own button/disabled state.
    const [savingVisit, setSavingVisit] = useState(false);

    const [date, setDate] = useState(todayKey());
    const [startAt, setStartAt] = useState('09:00');
    const [stopMinutes, setStopMinutes] = useState(DEFAULT_DAY.stopMinutes);
    const [origin, setOrigin] = useState(null);
    const [myPosition, setMyPosition] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(null);
    const [replaceExisting, setReplaceExisting] = useState(false);

    // Lead generation — searching the visible map area for businesses not
    // yet in the CRM (see MapCanvas's leadResults markers/panel). Kept
    // entirely separate from pins/selectedPins/unselectedPins: these are
    // transient search results, not customer data, until saveLead() below
    // turns one into a real Customer.
    const [leadQuery, setLeadQuery] = useState('');
    const [leadResults, setLeadResults] = useState([]);
    const [leadInfo, setLeadInfo] = useState(null);
    const [leadSearching, setLeadSearching] = useState(false);
    const [leadError, setLeadError] = useState('');
    const [savingLead, setSavingLead] = useState(false);
    const [recentLeadSearches, setRecentLeadSearches] = useState(() => loadRecentLeadSearches());

    // Edit/delete for an existing customer from the detail panel — reusing
    // AddCustomerModal and the /api/partners/:id routes exactly as
    // PartnersSheet.jsx does, rather than building a second edit form. Edit
    // (PUT) checks manage_customers; delete (DELETE) accepts either
    // manage_customers or delete_customers, so a role can be granted delete
    // without full edit/add rights — see can.manageCustomers/can.deleteCustomers
    // gating the two icons separately in MapCanvas.
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [savingCustomerEdit, setSavingCustomerEdit] = useState(false);
    const [loadingEditCustomer, setLoadingEditCustomer] = useState(false);
    const [salesReps, setSalesReps] = useState([]);
    const [locationOptions, setLocationOptions] = useState([]);

    // Kept current every render so the session-expired listener can grab a
    // fresh snapshot without needing every one of these in its own deps.
    const dayBuilderRef = useRef(null);
    useEffect(() => {
        dayBuilderRef.current = { date, startAt, stopMinutes, origin, replaceExisting };
    });

    // Restores a draft saved earlier in the session (e.g. before the
    // auth-session-expired listener above saved one mid-edit).
    useEffect(() => {
        const handleExpire = () => {
            if (dayBuilderRef.current) saveDraft('routePlannerDay', dayBuilderRef.current);
        };
        window.addEventListener('auth:session-expired', handleExpire);
        return () => window.removeEventListener('auth:session-expired', handleExpire);
    }, []);

    useEffect(() => {
        const draft = loadDraft('routePlannerDay');
        if (!draft) return;
        if (draft.date) setDate(draft.date);
        if (draft.startAt) setStartAt(draft.startAt);
        if (draft.stopMinutes) setStopMinutes(draft.stopMinutes);
        if (draft.origin) setOrigin(draft.origin);
        if (draft.replaceExisting) setReplaceExisting(draft.replaceExisting);
        clearDraft('routePlannerDay');
    }, []);

    const can = useMemo(() => {
        const held = currentUser?.permissions || [];
        return {
            plan: held.includes('create_route_plan'),
            replace: held.includes('edit_route_plan'),
            clear: held.includes('delete_route_plan'),
            manageCustomers: held.includes('manage_customers'),
            deleteCustomers: held.includes('delete_customers')
        };
    }, [currentUser]);

    const mapRef = useRef(null);

    const loadScheduled = useCallback(async () => {
        try {
            const from = new Date();
            const to = new Date();
            to.setDate(to.getDate() + 120);
            const res = await authFetch(
                `${API_URL}/api/schedule?start=${todayKey(from)}T00:00:00.000&end=${todayKey(to)}T23:59:59.999`
            );
            if (!res.ok) return;
            const rows = await res.json();
            const list = Array.isArray(rows) ? rows : [];
            const byCustomer = new Map();
            list.forEach(row => {
                const id = String(row.customerId?._id || row.customerId || '');
                if (id && !byCustomer.has(id)) byCustomer.set(id, { id: row._id, startTime: row.startTime });
            });
            setScheduled(byCustomer);
            // Deliberately NOT marked in fetchedMonthsRef — this window
            // starts at today, not the 1st, so the current month is only
            // partially covered. loadScheduleMonth needs to still be free
            // to fetch that same month in full (see the mount effect below)
            // rather than seeing it here and assuming it's already done.
            setScheduleById(prev => {
                const next = new Map(prev);
                list.forEach(row => next.set(String(row._id), row));
                return next;
            });
        } catch {
            /* the planner still works without it; the dialog just cannot say "booked" */
        }
    }, []);

    // SchedulePanel's calendar can be paged to any month, but the fetch
    // above only ever covers today → +120 days — flipping back to an
    // earlier month (or even earlier days within the current one) would
    // otherwise always render empty even though real visits are sitting
    // right there in the database. This fetches and merges in whichever
    // month the calendar is actually showing, on demand, tracked per-month
    // (fetchedMonthsRef) so revisiting the same month doesn't re-request it.
    const loadScheduleMonth = useCallback(async (monthDate) => {
        const key = `${monthDate.getFullYear()}-${pad(monthDate.getMonth() + 1)}`;
        if (fetchedMonthsRef.current.has(key)) return;
        fetchedMonthsRef.current.add(key);
        setMonthFetchesInFlight(n => n + 1);
        try {
            const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
            const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
            const res = await authFetch(
                `${API_URL}/api/schedule?start=${todayKey(start)}T00:00:00.000&end=${todayKey(end)}T23:59:59.999`
            );
            if (!res.ok) { fetchedMonthsRef.current.delete(key); return; }
            const rows = await res.json();
            const list = Array.isArray(rows) ? rows : [];
            setScheduleById(prev => {
                const next = new Map(prev);
                list.forEach(row => next.set(String(row._id), row));
                return next;
            });
        } catch {
            // Lets the next visit to this month retry instead of leaving it
            // permanently marked "fetched" over a failed request.
            fetchedMonthsRef.current.delete(key);
        } finally {
            setMonthFetchesInFlight(n => n - 1);
        }
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/map`);
            if (!res.ok) throw new Error(`Map data unavailable (${res.status})`);
            const data = await res.json();
            setPins(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message || 'Could not load customer locations');
        } finally {
            setLoading(false);
        }
    }, []);

    // Keyed on isActive, not just mount: this view stays mounted-but-hidden
    // while another tab is open (see the comment on its usage in
    // SalesPage.jsx — avoids re-billing a Google Maps load), so a plain
    // mount-only fetch would leave every pin frozen at whatever `pins` was
    // the last time this tab was visible — an edit made elsewhere (Customers
    // tab, a visit/resource save) would never show up here short of a full
    // page reload. Refetching every time the tab becomes active again keeps
    // it current without needing every other screen to know this one exists.
    useEffect(() => { if (isActive) load(); }, [isActive, load]);
    useEffect(() => { loadScheduled(); }, [loadScheduled]);
    // Backfills the current month's days before today — SchedulePanel opens
    // on this month by default, and loadScheduled above only ever covers
    // today onward, so without this the first half of the current month
    // would show as empty until the rep manually paged away and back.
    useEffect(() => { loadScheduleMonth(new Date()); }, [loadScheduleMonth]);

    // The rep/branch pickers AddCustomerModal needs for its edit form — same
    // two endpoints and shapes PartnersSheet.jsx already fetches this from.
    useEffect(() => {
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/salesreps`);
                if (res.ok) setSalesReps(toSalesRepList(await res.json()));
            } catch {
                /* the edit modal still opens; the rep dropdown is just empty */
            }
        })();
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/admin/locations`);
                if (!res.ok) return;
                const data = await res.json();
                setLocationOptions((data || []).map(l => l.name).filter(Boolean));
            } catch {
                /* as above — the branch dropdown is just empty */
            }
        })();
    }, []);

    useEffect(() => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setOrigin(here);
            },
            () => { /* denied — the fallback centre still works */ },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    }, []);

    // The blue "You" dot on the map (see MapCanvas) — kept separate from
    // `origin` on purpose. `origin` anchors route planning/the Directions
    // request above and the map's initial centring, so it only updates once
    // per session (or on an explicit "locate me" click) — a rep panning
    // around to look at other stops shouldn't have the camera yanked back,
    // and the Directions API shouldn't get re-billed every time the phone
    // reports a new fix. This polls for the device's live position instead,
    // purely for display, so the dot itself still moves with the rep while
    // they drive.
    //
    // Deliberately setInterval + getCurrentPosition rather than
    // watchPosition: this app installs as a PWA (see vite.config.js), and
    // Mobile Safari has a long-standing bug where watchPosition quietly
    // stops delivering updates after the screen locks or the app
    // backgrounds even briefly in standalone mode — it fires once and then
    // never again until the page is reloaded, which is exactly the "frozen
    // dot" this effect exists to fix. Re-polling on a plain timer sidesteps
    // that instead of depending on it.
    useEffect(() => {
        if (!navigator.geolocation) return;
        const poll = () => {
            navigator.geolocation.getCurrentPosition(
                (pos) => setMyPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                () => { /* denied/unavailable — the dot just stays at its last known spot */ },
                { enableHighAccuracy: true, timeout: 8000 }
            );
        };
        poll();
        const intervalId = setInterval(poll, 15000);
        return () => clearInterval(intervalId);
    }, []);

    // This component stays mounted behind display:none when you navigate
    // away (see SalesPage.jsx), so the map instance survives.
    useEffect(() => {
        if (!isActive || !mapRef.current || !window.google) return;
        const map = mapRef.current;
        const held = map.getCenter();
        window.google.maps.event.trigger(map, 'resize');
        if (held) map.setCenter(held);
    }, [isActive]);

    const myId = String(currentUser?.id || currentUser?._id || '');

    const visible = useMemo(() => {
        return pins
            .filter(p => hasPoint(p))
            // Absent-from-activeSalesReps reads as "hidden", the opposite
            // default from activeTypes/activeBuckets below — a rep who
            // hasn't loaded yet (or a colleague never explicitly checked)
            // shouldn't suddenly show up shown by omission the way a brand
            // new customer type should.
            .filter(p => activeSalesReps[repKey(p.salesRep)] === true)
            // Absent-from-activeTypes reads as "shown" (not yet synced, or a
            // type appearing for the first time this render) rather than
            // "hidden" — see the sync effect below for why that's safe.
            .filter(p => activeTypes[p.customerType || '(blank)'] !== false)
            .map(p => ({ ...p, recency: visitRecency(p.lastVisitAt) }))
            .filter(p => activeBuckets[p.recency.key]);
    }, [pins, activeSalesReps, activeTypes, activeBuckets]);

    // The Tools panel's current selection (Radius/Lasso draw, or manual
    // add/remove) — the one and only source a day gets built from. Read off
    // raw `pins`, not `visible`: a deliberately-curated batch shouldn't
    // silently lose a point just because a filter toggled afterward and hid
    // it from the map.
    const selectedPins = useMemo(
        () => pins.filter(p => selectedIds.has(p._id)).map(p => ({ ...p, recency: visitRecency(p.lastVisitAt) })),
        [pins, selectedIds]
    );

    /** Everyone visible but not currently selected — clustered on the map rather than shown one by one. */
    const unselectedPins = useMemo(
        () => visible.filter(p => !selectedIds.has(p._id)),
        [visible, selectedIds]
    );

    const day = useMemo(() => {
        if (!selectedPins.length) return [];
        const [hour, minute] = startAt.split(':').map(Number);
        const routeOrigin = origin || selectedPins[0].coordinates;
        // manualOrderIds only ever covers the routable subset orderStops
        // would itself produce (unplaceable pins never get a drag handle in
        // ToolsPanel), so a valid override is compared against that same
        // subset rather than selectedPins as a whole.
        const placeable = selectedPins.filter(hasPoint);
        const byId = new Map(placeable.map(p => [p._id, p]));
        const manualIsValid = manualOrderIds
            && manualOrderIds.length === placeable.length
            && manualOrderIds.every(id => byId.has(id));
        const ordered = manualIsValid
            ? manualOrderIds.map(id => byId.get(id))
            : orderStops(selectedPins, routeOrigin);
        return planDay(ordered, {
            date: new Date(`${date}T00:00:00`),
            startHour: hour || 9,
            startMinute: minute || 0,
            stopMinutes: Number(stopMinutes) || DEFAULT_DAY.stopMinutes,
            origin: routeOrigin
        });
    }, [selectedPins, startAt, date, stopMinutes, origin, manualOrderIds]);

    const summary = useMemo(() => daySummary(day), [day]);

    const types = useMemo(
        () => [...new Set(pins.map(p => p.customerType).filter(Boolean))].sort(),
        [pins]
    );

    const counts = useMemo(() => {
        const tally = { never: 0, overdue: 0, due: 0, recent: 0 };
        pins
            .filter(p => hasPoint(p))
            .filter(p => activeSalesReps[repKey(p.salesRep)] === true)
            .forEach(p => { tally[visitRecency(p.lastVisitAt).key] += 1; });
        return tally;
    }, [pins, activeSalesReps]);

    const typeCounts = useMemo(() => {
        const tally = {};
        pins
            .filter(p => hasPoint(p))
            .filter(p => activeSalesReps[repKey(p.salesRep)] === true)
            .forEach(p => {
                const key = p.customerType || '(blank)';
                tally[key] = (tally[key] || 0) + 1;
            });
        return tally;
    }, [pins, activeSalesReps]);

    // Not scoped by activeSalesReps like the two tallies above — this is the
    // rep picker's OWN counts, so it has to show how many pins each rep has
    // regardless of who's currently checked, or unchecking someone would
    // make their own count vanish along with their pins.
    const repCounts = useMemo(() => {
        const tally = {};
        pins.filter(hasPoint).forEach(p => {
            const key = repKey(p.salesRep);
            tally[key] = (tally[key] || 0) + 1;
        });
        return tally;
    }, [pins]);

    // The rep picker's rows — driven off repCounts' keys (who actually has
    // pins right now), same as `types` is driven off the pins that actually
    // carry one, rather than the full staff directory. salesReps supplies
    // the display name for each id; a key with no match (a rep removed from
    // the roster after being assigned accounts) falls back to a label that
    // still reads as "someone", not a blank row.
    const salesRepOptions = useMemo(() => {
        const byId = new Map(salesReps.map(r => [String(r._id), r.name || 'Unnamed']));
        return Object.keys(repCounts)
            .map(key => ({ key, label: key === 'unassigned' ? 'Unassigned' : (byId.get(key) || 'Former rep') }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [salesReps, repCounts]);

    // Seeds "just me" the first time myId is known, without clobbering a
    // toggle the rep already made — same pattern as the types sync effect
    // below. Every other rep starts absent (reads as hidden, per visible's
    // filter above), reproducing the old mineOnly=true default without
    // needing to know the full rep list up front.
    useEffect(() => {
        if (!myId) return;
        setActiveSalesReps(prev => (myId in prev ? prev : { ...prev, [myId]: true }));
    }, [myId]);

    // New types (including '(blank)', once any pin lacks one) default to
    // shown the first time they're seen, without clobbering a toggle the
    // rep already made on an existing one.
    useEffect(() => {
        // types (below) already filters out falsy customerType — '(blank)'
        // is added back here as its own filterable bucket, matching how
        // pins with no type are treated in `visible`'s filter above.
        const known = [...types, '(blank)'];
        setActiveTypes(prev => {
            const next = { ...prev };
            let changed = false;
            known.forEach(t => {
                if (!(t in next)) { next[t] = true; changed = true; }
            });
            return changed ? next : prev;
        });
    }, [types]);

    const orderById = useMemo(() => {
        const map = new Map();
        day.forEach(stop => map.set(stop._id, stop.order));
        return map;
    }, [day]);

    // SchedulePanel's calendar: every scheduled visit fetched so far
    // (loadScheduled's initial window plus whatever loadScheduleMonth has
    // pulled in), grouped by the day it falls on. YYYY-MM-DD, same key
    // shape todayKey() produces, so a grid cell's date maps straight in.
    // Sorted explicitly per day rather than trusting fetch order — each
    // individual /api/schedule response comes back startTime-ascending, but
    // scheduleById merges several overlapping fetches together, so that
    // per-request ordering doesn't carry over to the merged result.
    const visitsByDate = useMemo(() => {
        const map = new Map();
        scheduleById.forEach(row => {
            if (!row.startTime) return;
            const key = todayKey(new Date(row.startTime));
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(row);
        });
        map.forEach(list => list.sort((a, b) => new Date(a.startTime) - new Date(b.startTime)));
        return map;
    }, [scheduleById]);

    const pinById = useMemo(() => new Map(pins.map(p => [String(p._id), p])), [pins]);

    // ScheduleVisitForm's customer picker — the same customers already
    // loaded for the map (pins), reshaped into SearchableSelect's
    // {value,label} pairs rather than a second fetch of the same data.
    const customerOptions = useMemo(
        () => pins.map(p => ({ value: p._id, label: nameOf(p) })).sort((a, b) => a.label.localeCompare(b.label)),
        [pins]
    );

    const addOneToCalendar = async (customer) => {
        if (saving) return;
        setSaving(true);
        setError('');
        try {
            const planned = day.find(stop => stop._id === customer._id);
            const [hour, minute] = startAt.split(':').map(Number);
            const fallbackStart = `${date}T${pad(hour || 9)}:${pad(minute || 0)}:00.000`;
            const fallbackEnd = new Date(new Date(fallbackStart).getTime() + (Number(stopMinutes) || 45) * 60000);

            const res = await authFetch(`${API_URL}/api/schedule/bulk`, {
                method: 'POST',
                body: JSON.stringify({
                    date,
                    items: [{
                        customerId: customer._id,
                        startTime: planned?.startTime || fallbackStart,
                        endTime: planned?.endTime || localISO(fallbackEnd),
                        activityType: 'Visit',
                        notes: ''
                    }]
                })
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || 'Could not add to the calendar');
            await loadScheduled();
        } catch (err) {
            setError(err.message || 'Could not add to the calendar');
        } finally {
            setSaving(false);
        }
    };

    const removeFromCalendar = async (customer) => {
        const booking = scheduled.get(String(customer._id));
        if (!booking || saving) return;
        setSaving(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/schedule/${booking.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || 'Could not remove it from the calendar');
            }
            await loadScheduled();
        } catch (err) {
            setError(err.message || 'Could not remove it from the calendar');
        } finally {
            setSaving(false);
        }
    };

    // Always takes a fresh fix rather than panning to whatever `origin`/
    // `myPosition` already hold — an explicit tap on this button is the rep
    // saying "where am I *right now*", so a cached point (even one only a
    // few seconds stale from the poll above) isn't good enough here.
    const goToMyLocation = () => {
        if (!navigator.geolocation) {
            setError('This browser cannot report a location.');
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setOrigin(here);
                setMyPosition(here);
                if (!mapRef.current) return;
                mapRef.current.panTo(here);
                mapRef.current.setZoom(12);
            },
            () => setError('Location is switched off for this site — turn it on in the browser’s site settings.'),
            { enableHighAccuracy: true, timeout: 8000 }
        );
    };

    // Kept stable (useCallback, no deps) so MapCanvas's clustering effect —
    // which takes this as onSelectPin — doesn't rebuild every cluster marker
    // whenever RoutePlannerV2 re-renders for an unrelated reason.
    // `origin` names the panel this popup is replacing in the right column
    // ('tools' | 'customers' | 'schedule'), so closeInfo knows what to bring
    // back — left null for a plain pin click on the map, which has nothing
    // to return to.
    const showDetails = useCallback((customer, origin = null) => {
        setLeadInfo(null);
        setShowFilterPanel(false);
        setShowToolsPanel(false);
        setShowCustomersPanel(false);
        setShowSchedulePanel(false);
        setReturnPanel(origin);
        setInfo(customer);
        if (!mapRef.current || !customer?.coordinates) return;
        mapRef.current.panTo(customer.coordinates);
        // The detail panel is a fixed column on the right (PANEL_WIDTH wide)
        // rather than a popup anchored at the pin, so panTo alone would
        // still centre the pin right where the panel is about to cover it.
        // Shifting the view left by half that width keeps it clear.
        mapRef.current.panBy(PANEL_WIDTH / 2, 0);
    }, []);

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

    // Same fixed-column treatment as showDetails, for a lead-search result
    // instead of a Customer — the two panels are mutually exclusive (opening
    // one closes the other) since both occupy the same right-hand column.
    const showLeadDetails = useCallback((place) => {
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
    }, []);

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
    const showScheduledVisit = useCallback((visit) => {
        const id = String(visit.customerId?._id || visit.customerId || '');
        const pin = pinById.get(id);
        if (!pin) return;
        showDetails({ ...pin, recency: visitRecency(pin.lastVisitAt) }, 'schedule');
    }, [pinById, showDetails]);

    // Opens a customer from CustomersPanel's directory — unlike
    // showScheduledVisit above, CustomersPanel already hands back the full
    // pin (it iterates raw `pins` directly, not a populated-subset schedule
    // row), so this only needs to attach recency before handing off to
    // showDetails, the same enrichment `visible`/`selectedPins` apply
    // elsewhere in this file.
    const showCustomerFromList = useCallback(
        (pin) => showDetails({ ...pin, recency: visitRecency(pin.lastVisitAt) }, 'customers'),
        [showDetails]
    );

    // SchedulePanel's per-card delete — same DELETE /api/schedule/:id
    // removeFromCalendar already uses, just addressed by the schedule row's
    // own _id rather than looked up via the `scheduled` (one-per-customer)
    // map, since a card here can be any of a customer's several visits, not
    // just their next upcoming one. Removed from scheduleById immediately
    // (that's the only thing SchedulePanel's calendar actually reads, and
    // it can hold rows outside loadScheduled's own today→+120-day window,
    // which a re-fetch there wouldn't touch) — loadScheduled still gets
    // called after so `scheduled` (and anything else keyed off it, like the
    // customer detail panel's "booked" badge) stays in sync too.
    const deleteScheduledVisit = async (visit) => {
        const label = nameOf({ company: visit.customerId?.company, contactName: visit.customerId?.contactName });
        if (!window.confirm(`Remove ${label}'s ${whenLabel(visit.startTime)} visit from the schedule?`)) return;
        try {
            const res = await authFetch(`${API_URL}/api/schedule/${visit._id}`, { method: 'DELETE' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || 'Could not remove this visit');
            }
            setScheduleById(prev => {
                const next = new Map(prev);
                next.delete(String(visit._id));
                return next;
            });
            await loadScheduled();
        } catch (err) {
            setError(err.message || 'Could not remove this visit');
        }
    };

    // Add/edit from ScheduleVisitForm — POST for a new visit, PUT (by the
    // row's own _id) to edit an existing one, the same two /api/schedule
    // verbs the rest of this screen already uses (addOneToCalendar/
    // scheduleStops for POST, removeFromCalendar/deleteScheduledVisit's
    // DELETE sibling). Returns the saved doc on success so SchedulePanel
    // can navigate to whichever day it landed on, or null on failure —
    // the error is already surfaced via `error` above either way, so the
    // caller doesn't need to handle a thrown exception too.
    const saveScheduleVisit = async (form, visitId) => {
        setSavingVisit(true);
        setError('');
        try {
            const method = visitId ? 'PUT' : 'POST';
            const url = visitId ? `${API_URL}/api/schedule/${visitId}` : `${API_URL}/api/schedule`;
            const res = await authFetch(url, { method, body: JSON.stringify(form) });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || 'Could not save this visit');
            setScheduleById(prev => {
                const next = new Map(prev);
                next.set(String(body._id), body);
                return next;
            });
            await loadScheduled();
            return body;
        } catch (err) {
            setError(err.message || 'Could not save this visit');
            return null;
        } finally {
            setSavingVisit(false);
        }
    };

    const armRadiusTool = () => setDrawMode(m => (m === 'radius' ? null : 'radius'));
    const armLassoTool = () => setDrawMode(m => (m === 'lasso' ? null : 'lasso'));

    // The pin-in-circle sweep for a just-finished radius draw (see
    // MapCanvas's mousedown/mousemove/mouseup effect) — replaces the
    // existing selection rather than adding to it, so each draw shows
    // exactly what's inside the circle you just drew. Swept from `visible`,
    // not raw `pins`: a draw should only pick up what the rep can actually
    // see on the map right now.
    const handleRadiusSelect = useCallback((circleCenter, radiusMeters) => {
        const radiusMi = radiusMeters / 1609.34;
        const next = new Set();
        visible.forEach(p => {
            if (milesBetween(p.coordinates, circleCenter) <= radiusMi) next.add(p._id);
        });
        setSelectedIds(next);
        setSelectionShape({ type: 'radius', center: circleCenter, radiusMeters });
        setDrawMode(null);
    }, [visible]);

    // Same replace-not-add sweep as handleRadiusSelect, for a lasso's
    // freehand path instead of a circle — path is the ordered vertices
    // MapCanvas's lasso-draw effect traced under the cursor.
    const handleLassoSelect = useCallback((path) => {
        const next = new Set();
        visible.forEach(p => {
            if (pointInPolygon(p.coordinates, path)) next.add(p._id);
        });
        setSelectedIds(next);
        setSelectionShape({ type: 'lasso', path });
        setDrawMode(null);
    }, [visible]);

    const removeSelectedPoint = (pin) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.delete(pin._id);
            return next;
        });
    };

    // Drag-to-reorder in ToolsPanel: takes the currently-displayed stop
    // order (`day`, whichever produced it) as the base rather than
    // recomputing from scratch, so dragging one stop just slots it in next
    // to wherever it was dropped instead of resetting every other stop back
    // to its geography-optimal position too.
    const reorderStop = useCallback((draggedId, targetId) => {
        if (draggedId === targetId) return;
        const base = day.map(stop => stop._id);
        const from = base.indexOf(draggedId);
        const to = base.indexOf(targetId);
        if (from === -1 || to === -1) return;
        const next = [...base];
        next.splice(from, 1);
        next.splice(to, 0, draggedId);
        setManualOrderIds(next);
    }, [day]);

    const clearSelection = () => { setSelectedIds(new Set()); setSelectionShape(null); };

    const toggleType = (type) => {
        setActiveTypes(prev => ({ ...prev, [type]: prev[type] === false }));
    };

    const toggleAllTypes = (showAll) => {
        setActiveTypes(prev => {
            const next = { ...prev };
            [...types, '(blank)'].forEach(t => { next[t] = showAll; });
            return next;
        });
    };

    // Drives FilterButton's dot indicator — true once a type has been
    // toggled off, or the rep filter is hiding anyone (true by default,
    // since only "you" are seeded on — see the seed effect above). Recency
    // already shows its own state elsewhere (the legend's colours), so that
    // dimension stays out of this.
    const filtersActive = useMemo(
        () => [...types, '(blank)'].some(t => activeTypes[t] === false) ||
            salesRepOptions.some(r => activeSalesReps[r.key] !== true),
        [types, activeTypes, salesRepOptions, activeSalesReps]
    );

    const toggleBucket = (key) => setActiveBuckets(prev => ({ ...prev, [key]: !prev[key] }));

    const toggleSalesRep = (key) => {
        setActiveSalesReps(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const toggleAllSalesReps = (showAll) => {
        setActiveSalesReps(prev => {
            const next = { ...prev };
            salesRepOptions.forEach(r => { next[r.key] = showAll; });
            return next;
        });
    };

    const handleMapClick = () => {
        // While the Tools panel's Radius or Lasso mode is armed, a click is
        // part of a drag/freehand-draw gesture (or an accidental tap) —
        // either way it shouldn't also dismiss the panels below.
        if (drawMode) return;
        closeInfo();
        setLeadInfo(null);
        setShowFilterPanel(false);
    };

    // Loads the Places library lazily via importLibrary rather than listing
    // 'places' in the useJsApiLoader call above — @react-google-maps/api's
    // loader is a page-lifetime singleton keyed by its full options object,
    // so any other screen that ever calls useJsApiLoader with different
    // options would throw ("Loader must not be called again with different
    // options") instead of loading. importLibrary sidesteps that entirely
    // since it never touches the shared loader's own options.
    const searchLeads = useCallback(async (queryText) => {
        if (!mapRef.current || !window.google?.maps) return;
        const bounds = mapRef.current.getBounds();
        if (!bounds) {
            setLeadError('The map is still loading — try again in a moment.');
            return;
        }

        setLeadSearching(true);
        setLeadError('');
        try {
            const { Place } = await window.google.maps.importLibrary('places');
            const { places } = await Place.searchByText({
                textQuery: queryText,
                fields: ['id', 'displayName', 'formattedAddress', 'location', 'internationalPhoneNumber', 'types', 'addressComponents'],
                locationRestriction: bounds,
                maxResultCount: 20
            });
            setLeadResults((places || []).map(p => ({
                placeId: p.id,
                name: p.displayName || 'Unnamed business',
                address: p.formattedAddress || '',
                phone: p.internationalPhoneNumber || '',
                types: p.types || [],
                coordinates: { lat: p.location.lat(), lng: p.location.lng() },
                addressParts: parseAddressComponents(p.addressComponents)
            })));
            setLeadInfo(null);
            setRecentLeadSearches(saveRecentLeadSearch(queryText));
        } catch (err) {
            setLeadError(err.message || 'Could not search this area');
        } finally {
            setLeadSearching(false);
        }
    }, []);

    const saveLead = async (place) => {
        if (savingLead) return;
        setSavingLead(true);
        setLeadError('');
        try {
            const parts = place.addressParts || {};
            const res = await authFetch(`${API_URL}/api/sales/customers`, {
                method: 'POST',
                body: JSON.stringify({
                    company: place.name,
                    phone: place.phone,
                    address: {
                        street: parts.street || '',
                        city: parts.city || '',
                        state: parts.state || '',
                        zipCode: parts.zipCode || ''
                    },
                    status: 'New Lead',
                    salesRep: currentUser?.id || currentUser?._id,
                    location: currentUser?.location,
                    coordinates: place.coordinates,
                    precision: 'rooftop'
                })
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || 'Could not save this lead');
            setLeadResults(prev => prev.filter(p => p.placeId !== place.placeId));
            setLeadInfo(null);
            await load();
        } catch (err) {
            setLeadError(err.message || 'Could not save this lead');
        } finally {
            setSavingLead(false);
        }
    };

    /**
     * /api/customers/map (what `pins`/`info` come from) flattens address into
     * top-level street/city/state and drops zipCode entirely — fine for
     * showing a pin, but AddCustomerModal expects the full nested
     * `address: {street, city, state, zipCode}` shape. Handing it the pin
     * object directly left street/state/zip blank in the form; saving that
     * as-is would have overwritten the customer's real zip with an empty
     * string. Fetching the full record first avoids that instead of just
     * papering over the gap with a reshaped partial object.
     */
    const openEditCustomer = async (customer) => {
        setLoadingEditCustomer(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/${customer._id}`);
            if (!res.ok) throw new Error('Could not load this customer’s full details for editing');
            setEditingCustomer(await res.json());
        } catch (err) {
            setError(err.message || 'Could not load this customer’s full details for editing');
        } finally {
            setLoadingEditCustomer(false);
        }
    };

    /** AddCustomerModal's onSave(form, closeModal) — mirrors handleSavePartner in PartnersSheet.jsx exactly. */
    const saveCustomerEdit = async (formData, closeModal) => {
        if (!editingCustomer) return;
        setSavingCustomerEdit(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/partners/${editingCustomer._id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    ...formData,
                    contactName: formData.customerName,
                    name: formData.customerName,
                    city: formData.address?.city || '',
                    quickNote: formData.notes
                })
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || 'Could not save this customer');
            }
            closeModal();
            setEditingCustomer(null);
            // info still holds the pre-edit fields — closing it rather than
            // patching it in place means the next click shows what's
            // actually on the server, not a guess at what changed.
            setInfo(null);
            setReturnPanel(null);
            await load();
        } catch (err) {
            setError(err.message || 'Could not save this customer');
        } finally {
            setSavingCustomerEdit(false);
        }
    };

    const deleteCustomer = async (customer) => {
        if (!window.confirm(`Delete ${nameOf(customer)}? This can't be undone.`)) return;
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/partners/${customer._id}`, { method: 'DELETE' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || 'Could not delete this customer');
            }
            setPins(prev => prev.filter(p => p._id !== customer._id));
            setInfo(null);
            setReturnPanel(null);
        } catch (err) {
            setError(err.message || 'Could not delete this customer');
        }
    };

    // "Planned stops in → POST /api/schedule/bulk → reflect the result" —
    // shared by scheduleDay, the one function that now schedules `day`
    // regardless of whether it was triggered from the area-list panel's
    // "Schedule day" button or the Tools panel's "Create Route" button,
    // since both read the same selection-derived `day`.
    const scheduleStops = async (stops, onSaved) => {
        if (!stops.length || saving) return;
        setSaving(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/schedule/bulk`, {
                method: 'POST',
                body: JSON.stringify({
                    date,
                    replace: replaceExisting && can.replace,
                    items: stops.map(stop => ({
                        customerId: stop._id,
                        startTime: stop.startTime,
                        endTime: stop.endTime,
                        activityType: 'Visit',
                        notes: `Stop ${stop.order} · ${stop.milesFromPrevious} mi from previous`
                    }))
                })
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || 'Could not schedule the route');
            setSaved({ count: body.stops?.length ?? 0, replaced: body.replaced || 0, date });
            onSaved?.();
            await loadScheduled();
        } catch (err) {
            setError(err.message || 'Could not schedule the route');
        } finally {
            setSaving(false);
        }
    };

    // Clears the selection and closes the Tools panel on success — the
    // latter is a no-op when this was triggered from the area-list panel
    // instead (the two panels are mutually exclusive, so the Tools panel is
    // already closed in that case).
    const scheduleDay = () => scheduleStops(day, () => {
        clearSelection();
        setShowToolsPanel(false);
    });

    const clearPlannedDay = async () => {
        if (saving) return;
        if (!window.confirm(`Remove the stops the route planner put on ${date}? Anything you added by hand stays.`)) return;
        setSaving(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/schedule/route?date=${date}`, { method: 'DELETE' });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || 'Could not clear the day');
            setSaved({ count: 0, cleared: body.deleted, date });
            await loadScheduled();
        } catch (err) {
            setError(err.message || 'Could not clear the day');
        } finally {
            setSaving(false);
        }
    };

    if (!apiKey) {
        return (
            <div className="rpv2-outer">
                <div className="rpv2-empty-shell">
                    <MapPin size={40} />
                    <h3>The map needs a Google Maps key</h3>
                    {import.meta.env.PROD ? (
                        <p>
                            <code>VITE_GOOGLE_MAPS_API_KEY</code> isn't set for this deployment. Add it in the
                            hosting dashboard's environment variables, then redeploy — this key is baked in when
                            the app is built, so a restart alone won't pick it up.
                        </p>
                    ) : (
                        <p>
                            Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to <code>.env</code> and restart the dev server.
                            The same key (or <code>GOOGLE_GEOCODING_API_KEY</code>) is what gives customers their
                            coordinates in the first place — see <code>scripts/geocode-customers.js</code>.
                        </p>
                    )}
                </div>
            </div>
        );
    }

    // Rendered as its own slot (not part of areaControls below) so RunDrawer
    // can place it right after the sidebar toggle — Dashboard, Filter,
    // Tools, Calendar — instead of after Tools/Calendar with the rest of
    // the area controls.
    const filterControl = (
        <FilterButton open={showFilterPanel} active={filtersActive} onClick={toggleFilterPanel} />
    );

    // Everything that used to float in a separate top bar now lives in the
    // run drawer's collapsed row instead (built once here and handed down
    // as a prop, rather than drilling another dozen individual props
    // through RunDrawer just to re-render the exact same elements one file
    // over). Order matters here: lead search first, then locate at the very
    // bottom — adjusting the map itself is the last step, not the first.
    const areaControls = (
        <>
            {isLoaded && !loadError && (
                <LeadSearchControl
                    query={leadQuery}
                    onQueryChange={setLeadQuery}
                    onSearch={searchLeads}
                    searching={leadSearching}
                    recent={recentLeadSearches}
                    onRemoveRecent={(term) => setRecentLeadSearches(removeRecentLeadSearch(term))}
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
                    onClick={goToMyLocation}
                    title="Centre the map on my location"
                    aria-label="Centre the map on my location"
                >
                    <LocateFixed size={16} />
                </button>
            )}
        </>
    );

    return (
        <div className="rpv2-shell">
            <MapCanvas
                mapRef={mapRef}
                theme={theme}
                colors={colors}
                isLoaded={isLoaded}
                loadError={loadError}
                showTraffic={showTraffic}
                origin={origin}
                myPosition={myPosition}
                unselectedPins={unselectedPins}
                orderById={orderById}
                info={info}
                onSelectPin={showDetails}
                onCloseInfo={closeInfo}
                onEditCustomer={openEditCustomer}
                loadingEditCustomer={loadingEditCustomer}
                onDeleteCustomer={deleteCustomer}
                leadResults={leadResults}
                leadInfo={leadInfo}
                onSelectLead={showLeadDetails}
                onCloseLeadInfo={() => setLeadInfo(null)}
                showFilterPanel={showFilterPanel}
                onCloseFilterPanel={() => setShowFilterPanel(false)}
                types={types}
                activeTypes={activeTypes}
                typeCounts={typeCounts}
                onToggleType={toggleType}
                onToggleAllTypes={toggleAllTypes}
                recencyBuckets={RECENCY_BUCKETS}
                activeBuckets={activeBuckets}
                recencyCounts={counts}
                onToggleBucket={toggleBucket}
                salesRepOptions={salesRepOptions}
                activeSalesReps={activeSalesReps}
                repCounts={repCounts}
                onToggleSalesRep={toggleSalesRep}
                onToggleAllSalesReps={toggleAllSalesReps}
                replaceExisting={replaceExisting}
                onReplaceExistingChange={setReplaceExisting}
                onClearPlannedDay={clearPlannedDay}
                date={date}
                onDateChange={(v) => { setDate(v); setSaved(null); }}
                startAt={startAt}
                onStartAtChange={setStartAt}
                stopMinutes={stopMinutes}
                onStopMinutesChange={setStopMinutes}
                day={day}
                summary={summary}
                onScheduleDay={scheduleDay}
                saved={saved}
                onSaveLead={saveLead}
                savingLead={savingLead}
                canSaveLead={can.manageCustomers}
                leadError={leadError}
                scheduled={scheduled}
                can={can}
                saving={saving}
                onAddOne={addOneToCalendar}
                onRemoveOne={removeFromCalendar}
                onOpenCustomer={onOpenCustomer}
                onAddVisit={onAddVisit}
                onAddResource={onAddResource}
                loading={loading}
                pinsCount={pins.length}
                error={error}
                onMapClick={handleMapClick}
                showToolsPanel={showToolsPanel}
                onCloseToolsPanel={toggleToolsPanel}
                showCustomersPanel={showCustomersPanel}
                onCloseCustomersPanel={toggleCustomersPanel}
                allCustomers={pins}
                onSelectCustomer={showCustomerFromList}
                drawMode={drawMode}
                onArmRadius={armRadiusTool}
                onArmLasso={armLassoTool}
                onLocateMe={goToMyLocation}
                onRadiusSelect={handleRadiusSelect}
                onLassoSelect={handleLassoSelect}
                selectionShape={selectionShape}
                selectedPins={selectedPins}
                onRemoveSelectedPoint={removeSelectedPoint}
                onReorderStop={reorderStop}
                showSchedulePanel={showSchedulePanel}
                onCloseSchedulePanel={toggleSchedulePanel}
                visitsByDate={visitsByDate}
                onSelectScheduledVisit={showScheduledVisit}
                onScheduleMonthChange={loadScheduleMonth}
                scheduleMonthLoading={monthFetchesInFlight > 0}
                onDeleteScheduledVisit={deleteScheduledVisit}
                customerOptions={customerOptions}
                onSaveScheduledVisit={saveScheduleVisit}
                savingVisit={savingVisit}
            />

            <RunDrawer
                sidebarToggle={sidebarToggle}
                filterControl={filterControl}
                showToolsPanel={showToolsPanel}
                onToggleToolsPanel={toggleToolsPanel}
                showCustomersPanel={showCustomersPanel}
                onToggleCustomersPanel={toggleCustomersPanel}
                showSchedulePanel={showSchedulePanel}
                onToggleSchedulePanel={toggleSchedulePanel}
                areaControls={areaControls}
            />

            {/* Same modal PartnersSheet.jsx uses for editing a customer —
                editingCustomer puts it in edit mode; passing it here rather
                than building a second edit form for the map's detail panel. */}
            <AddCustomerModal
                show={Boolean(editingCustomer)}
                onClose={() => setEditingCustomer(null)}
                onSave={saveCustomerEdit}
                isSaving={savingCustomerEdit}
                editingCustomer={editingCustomer}
                salesReps={salesReps}
                locations={locationOptions}
                currentUser={currentUser}
            />
        </div>
    );
};

export default RoutePlannerV2;
