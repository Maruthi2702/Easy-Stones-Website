import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useJsApiLoader } from '@react-google-maps/api';
import { MapPin, LocateFixed, Gauge } from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { saveDraft, loadDraft, clearDraft } from '../../utils/sessionDraft';
import { toSalesRepList, groupRepOptions } from '../../utils/salesReps';
import { UNASSIGNED, repsInScope, scopeLocationsOf } from '../../utils/routePlannerScope';
import { readLastPosition, rememberPosition, forgetLocationOk, locationWasOk, locationPermission, shouldAutoLocate } from '../../utils/geolocationAccess';
import {
    orderStops, planDay, daySummary,
    hasPoint, milesBetween, pointInPolygon, RECENCY_BUCKETS, DEFAULT_DAY
} from '../../utils/routePlan';
import {
    RECENCY_COLORS, KNOWN_TYPES, PIN_COLOR_MODES, todayKey, pad, nameOf, whenLabel, visitRecency,
    parseAddressComponents, loadRecentLeadSearches, saveRecentLeadSearch, removeRecentLeadSearch
} from './helpers';
import MapCanvas from './map/MapCanvas';
import FilterButton from './rail/FilterButton';
import LeadSearchControl from './rail/LeadSearchControl';
import RunDrawer from './rail/RunDrawer';
import MoreMenu from './rail/MoreMenu';
import AddCustomerModalJs from '../../components/sales/AddCustomerModal';
import { toCustomerOptions } from '../../utils/customerOptions';
import { canEditCustomers, canDeleteCustomers, canViewCustomerProfile } from '../../utils/customerAccess';
import { CustomerDrawer } from '../customers';
import MapActions from './customer/MapActions';
import ScheduleVisitSheet from './customer/ScheduleVisitSheet';
import type { CurrentUser, Loose, StaffMember } from '../../types/records';
import type {
    Booking, ColorMode, DayStop, DaySummary, DrawMode, LatLng, Lead, MapPin as Customer, Pin, PlannerPermissions,
    Preselect, RecencyBucket, RecencyKey, ReturnPanel, SavedDay, ScheduleRow, ScheduleVisitInput, SelectionShape, Toggles, VisitSlotInput
} from './types';
import './RoutePlannerV2.css';

// Still JavaScript; taken as taking any props until it's typed.
const AddCustomerModal = AddCustomerModalJs as unknown as ComponentType<Loose>;

/**
 * Route Planner, map-first: the full-bleed map with every control floating
 * over it instead of sharing a sidebar+map grid. This was built and shipped
 * alongside a classic sidebar+map version (RoutePlannerTab.jsx) during a
 * side-by-side comparison period; that file has since been removed and this
 * is now the only Route Planner screen.
 */
// The customer panel's width on desktop, echoed in MapActions.css's
// .cl-drawer.rpv2-host — no shared constant across JS/CSS, so both need to move
// together if this changes.
const PANEL_WIDTH = 460;

// Pure — doesn't close over anything component-specific — so it's hoisted
// here rather than redefined every render inside the component body, which
// would otherwise need explaining away in every useMemo that calls it.
/** The Route Planner's saved filters on the user record (PUT /api/user/me/route-planner-filters). */
type SavedFilters = { activeSalesReps?: Toggles | null; activeTypes?: Toggles | null; activeBuckets?: Toggles | null; pinColors?: { mode?: string } };
const savedFiltersOf = (user: CurrentUser | null) => user?.routePlannerFilters as SavedFilters | undefined;

const repKey = (salesRep: unknown) => String(salesRep || '') || 'unassigned';

/** The Tools panel's day, saved for the session when a sign-in expires mid-edit. */
type DayDraft = { date: string; startAt: string; stopMinutes: string | number; origin: LatLng | null; replaceExisting: boolean };

/** The customer an entry is for: populated to a name, or only an id. */
const customerOf = (row: ScheduleRow) => (typeof row.customerId === 'object' && row.customerId ? row.customerId : null);

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

    const [pins, setPins] = useState<Pin[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Keyed by sales rep id (or 'unassigned'), same on/off shape as
    // activeTypes/activeBuckets — replaces the old boolean mineOnly, which
    // could only ever mean "just me" or "everyone" and had no way to show,
    // say, two reps covering the same territory. Seeded to "just me" the
    // first time myId/salesReps are known (see the sync effect below), so
    // the default behaviour is unchanged even though the model isn't.
    const [activeSalesReps, setActiveSalesReps] = useState<Toggles>({});
    // Which of the three saved filters have been loaded (seeded) yet. State,
    // not a ref, so a save effect sees "ready" only in the render where the
    // loaded value is already in place: with a ref, the save ran in the same
    // pass as the seed, wrote the empty starting value, and raced the real one
    // to the server, so a reopen often came back reset.
    const [filtersReady, setFiltersReady] = useState({ reps: false, types: false, buckets: false, colors: false });
    const markReady = useCallback((key: keyof typeof filtersReady) => setFiltersReady(prev => (prev[key] ? prev : { ...prev, [key]: true })), []);
    // The last value each filter saved (JSON), so loading one doesn't save it
    // straight back and only a real change goes to the server.
    const savedFilterJson = useRef<Record<string, string>>({});
    const saveFilter = useCallback((key: string, value: unknown) => {
        const json = JSON.stringify(value);
        if (savedFilterJson.current[key] === json) return;
        savedFilterJson.current[key] = json;
        authFetch(`${API_URL}/api/user/me/route-planner-filters`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: value })
        }).catch(() => {
            // Best-effort — losing a saved filter preference isn't worth
            // surfacing an error over; the in-session toggle still works.
        });
    }, []);
    const [activeBuckets, setActiveBuckets] = useState<Toggles>({ never: true, overdue: true, due: true, recent: true });
    // Multi-select, not the single dropdown value this replaced — every type
    // (plus the synthetic '(blank)' bucket for pins with none set) defaults
    // to shown, same on/off-per-key shape as activeBuckets above. Synced from
    // `types` below as new ones appear, since that list is data-driven and
    // can't be known up front.
    const [activeTypes, setActiveTypes] = useState<Toggles>({});
    // What the pins' colour means — the customer's type or how long since the
    // last visit (the Filter's "Type colours | Visit colours" switch). Saved
    // with the other filters; type until someone chooses otherwise.
    const [colorMode, setColorMode] = useState<ColorMode>('type');
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
    const [drawMode, setDrawMode] = useState<DrawMode>(null);
    const [selectedIds, setSelectedIds] = useState(new Set<string>());
    // The circle/lasso boundary that produced the current selectedIds — kept
    // around after the draw gesture ends (unlike drawMode, which clears
    // immediately) purely so it can stay drawn on the map as a visual answer
    // to "why these customers". Replaced by the next draw, cleared alongside
    // selectedIds by clearSelection.
    const [selectionShape, setSelectionShape] = useState<SelectionShape | null>(null);
    // A rep's manual drag-to-reorder of the Tools panel's stop list,
    // overriding the orderStops geography-based order below until the
    // selection itself changes — same ids, same set, just a different
    // sequence through them. Reset to null (falls back to the computed
    // order) whenever selectedIds changes, since a new draw/add/remove
    // invalidates whatever arrangement was tuned for the old set.
    const [manualOrderIds, setManualOrderIds] = useState<string[] | null>(null);
    useEffect(() => { setManualOrderIds(null); }, [selectedIds]);

    const [info, setInfo] = useState<Customer | null>(null);
    // Which panel (if any) showDetails hid to make room for `info` in the
    // shared right column — 'tools' | null. Lets closeInfo bring Tools back
    // instead of leaving the column empty when a customer's detail popup
    // was opened by clicking a row inside it, rather than by clicking its
    // pin on the map.
    const [returnPanel, setReturnPanel] = useState<ReturnPanel>(null);
    const [scheduled, setScheduled] = useState(new Map<string, Booking>());
    const [showSchedulePanel, setShowSchedulePanel] = useState(false);
    // Every schedule row SchedulePanel's calendar has ever fetched, keyed by
    // its own _id (not deduped by customer like `scheduled` above — a day
    // can have several visits for different customers, or even the same
    // one twice). Accumulates across loadScheduled's initial fetch and
    // loadScheduleMonth's per-month fetches below, since either can cover
    // overlapping ranges; keying by _id makes re-fetching a range that
    // overlaps an earlier one a harmless no-op merge instead of a dupe.
    const [scheduleById, setScheduleById] = useState(new Map<string, ScheduleRow>());
    // Which 'YYYY-MM' months loadScheduleMonth has already fetched, so
    // paging SchedulePanel's calendar back and forth doesn't re-request the
    // same range every time. A ref rather than state — it's read/written
    // inside loadScheduleMonth itself and never drives a render on its own.
    const fetchedMonthsRef = useRef(new Set<string>());
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
    const [stopMinutes, setStopMinutes] = useState<string | number>(DEFAULT_DAY.stopMinutes);
    const [origin, setOrigin] = useState<LatLng | null>(null);
    const [myPosition, setMyPosition] = useState<LatLng | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState<SavedDay | null>(null);
    const [replaceExisting, setReplaceExisting] = useState(false);

    // Lead generation — searching the visible map area for businesses not
    // yet in the CRM (see MapCanvas's leadResults markers/panel). Kept
    // entirely separate from pins/selectedPins/unselectedPins: these are
    // transient search results, not customer data, until saveLead() below
    // turns one into a real Customer.
    const [leadQuery, setLeadQuery] = useState('');
    const [leadResults, setLeadResults] = useState<Lead[]>([]);
    const [leadInfo, setLeadInfo] = useState<Lead | null>(null);
    const [leadSearching, setLeadSearching] = useState(false);
    const [leadError, setLeadError] = useState('');
    const [savingLead, setSavingLead] = useState(false);
    const [recentLeadSearches, setRecentLeadSearches] = useState(() => loadRecentLeadSearches());

    // Edit/delete for an existing customer from the detail panel — reusing
    // AddCustomerModal and the /api/customers/:id routes exactly as
    // features/customers/list/PartnersSheet.tsx does, rather than building a second edit form. Edit
    // (PUT) checks manage_customers; delete (DELETE) needs delete_customers —
    // the same canEditCustomers / canDeleteCustomers rules as the Customers
    // page, gating the two icons separately in MapCanvas.
    const [editingCustomer, setEditingCustomer] = useState<Loose | null>(null);
    const [savingCustomerEdit, setSavingCustomerEdit] = useState(false);
    const [, setLoadingEditCustomer] = useState(false);
    const [salesReps, setSalesReps] = useState<StaffMember[]>([]);
    const [locationOptions, setLocationOptions] = useState<string[]>([]);

    // Kept current every render so the session-expired listener can grab a
    // fresh snapshot without needing every one of these in its own deps.
    const dayBuilderRef = useRef<DayDraft | null>(null);
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
        const draft = loadDraft<Partial<DayDraft>>('routePlannerDay');
        if (!draft) return;
        if (draft.date) setDate(draft.date);
        if (draft.startAt) setStartAt(draft.startAt);
        if (draft.stopMinutes) setStopMinutes(draft.stopMinutes);
        if (draft.origin) setOrigin(draft.origin);
        if (draft.replaceExisting) setReplaceExisting(draft.replaceExisting);
        clearDraft('routePlannerDay');
    }, []);

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
            const list: ScheduleRow[] = Array.isArray(rows) ? rows : [];
            const byCustomer = new Map<string, Booking>();
            list.forEach(row => {
                const id = String(customerOf(row)?._id || row.customerId || '');
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
    const loadScheduleMonth = useCallback(async (monthDate: Date) => {
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
            const list: ScheduleRow[] = Array.isArray(rows) ? rows : [];
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

    // Only the checked reps' customers are loaded (GET /api/customers/map?reps=…),
    // and the server only ever answers for reps this person may see
    // (src/utils/routePlannerScope.js). Ticking a rep fetches just that rep's
    // customers, once; unticking only hides them. `replace` throws away what is
    // held and starts over; an answer that arrives after a newer replace is dropped.
    const loadEpoch = useRef(0);
    const loadedRepsRef = useRef(new Set<string>());
    const wantedRepKeys = useMemo(
        () => Object.keys(activeSalesReps).filter(k => activeSalesReps[k] === true).sort(),
        [activeSalesReps]
    );
    const wantedRepKeysRef = useRef(wantedRepKeys);
    useEffect(() => { wantedRepKeysRef.current = wantedRepKeys; }, [wantedRepKeys]);

    const [repCountsAll, setRepCountsAll] = useState<Record<string, number>>({});

    const fetchPins = useCallback(async (keys: string[], replace: boolean) => {
        const epoch = replace ? ++loadEpoch.current : loadEpoch.current;
        if (replace) loadedRepsRef.current = new Set(keys);
        else keys.forEach(k => loadedRepsRef.current.add(k));
        if (keys.length === 0) {
            if (replace) { setPins([]); setLoading(false); }
            return;
        }
        setLoading(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/map?reps=${encodeURIComponent(keys.join(','))}`);
            if (!res.ok) throw new Error(`Map data unavailable (${res.status})`);
            const data = await res.json();
            if (epoch !== loadEpoch.current) return;
            const got: Pin[] = Array.isArray(data) ? data : [];
            setPins(prev => {
                if (replace) return got;
                const have = new Set(prev.map(p => p._id));
                return [...prev, ...got.filter(p => !have.has(p._id))];
            });
        } catch (err) {
            if (epoch !== loadEpoch.current) return;
            keys.forEach(k => loadedRepsRef.current.delete(k));
            setError((err as Error).message || 'Could not load customer locations');
        } finally {
            if (epoch === loadEpoch.current) setLoading(false);
        }
    }, []);

    const loadRepCounts = useCallback(async () => {
        try {
            const res = await authFetch(`${API_URL}/api/customers/map/rep-counts`);
            if (res.ok) setRepCountsAll(await res.json());
        } catch {
            /* the rep rows just show no counts */
        }
    }, []);

    // Everything currently checked, again — after a customer is added or deleted.
    const load = useCallback(async () => {
        detailsCache.current.clear();
        await Promise.all([fetchPins(wantedRepKeysRef.current, true), loadRepCounts()]);
    }, [fetchPins, loadRepCounts]);

    // Keyed on isActive, not just mount: this view stays mounted-but-hidden
    // while another tab is open (see the comment on its usage in
    // SalesTabViews.tsx — avoids re-billing a Google Maps load), so a plain
    // mount-only fetch would leave every pin frozen at whatever `pins` was
    // the last time this tab was visible — an edit made elsewhere (Customers
    // tab, a visit/resource save) would never show up here short of a full
    // page reload. Refetching every time the tab becomes active again keeps
    // it current without needing every other screen to know this one exists.
    // Waits for the saved rep filter to load first (filtersReady.reps), or the
    // first load would fetch everyone and then hide most of it.
    useEffect(() => {
        if (isActive && filtersReady.reps) load();
    }, [isActive, filtersReady.reps, load]);

    // A rep ticked since: fetch just their customers.
    useEffect(() => {
        if (!isActive || !filtersReady.reps) return;
        const need = wantedRepKeys.filter(k => !loadedRepsRef.current.has(k));
        if (need.length) fetchPins(need, false);
    }, [isActive, filtersReady.reps, wantedRepKeys, fetchPins]);
    useEffect(() => { loadScheduled(); }, [loadScheduled]);
    // Backfills the current month's days before today — SchedulePanel opens
    // on this month by default, and loadScheduled above only ever covers
    // today onward, so without this the first half of the current month
    // would show as empty until the rep manually paged away and back.
    useEffect(() => { loadScheduleMonth(new Date()); }, [loadScheduleMonth]);

    // The rep/branch pickers AddCustomerModal needs for its edit form — same
    // two endpoints and shapes features/customers/list/PartnersSheet.tsx already fetches this from.
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
                setLocationOptions((data || []).map((l: { name?: string }) => l.name).filter(Boolean));
            } catch {
                /* as above — the branch dropdown is just empty */
            }
        })();
    }, []);

    // Location, without asking on every visit (src/utils/geolocationAccess.js).
    // Nothing prompts on its own: the map opens on the last known spot, and only
    // a tap on Locate asks. Once the browser has it allowed (or an earlier fix
    // worked on a browser that can't say) the position is followed quietly.
    const [lastKnownPosition] = useState(() => readLastPosition());
    const [autoLocate, setAutoLocate] = useState(false);
    useEffect(() => {
        let gone = false;
        let status: PermissionStatus | null = null;
        (async () => {
            const state = await locationPermission();
            if (gone) return;
            if (shouldAutoLocate(state, locationWasOk())) setAutoLocate(true);
            try {
                // Allowed or switched off in the browser's settings while this is open.
                status = await navigator.permissions.query({ name: 'geolocation' });
                status.onchange = () => setAutoLocate(status!.state === 'granted');
            } catch { /* a browser that can't say: the first branch above decided */ }
        })();
        return () => { gone = true; if (status) status.onchange = null; };
    }, []);

    // The blue "You" dot on the map (see MapCanvas) — kept separate from
    // `origin` on purpose. `origin` anchors route planning/the Directions
    // request above and the map's initial centring, so it only updates once
    // per session (or on an explicit "locate me" click) — a rep panning
    // around to look at other stops shouldn't have the camera yanked back,
    // and the Directions API shouldn't get re-billed every time the phone
    // reports a new fix. This polls for the device's live position instead,
    // purely for display, so the dot itself still moves with the rep while
    // they drive — but only while this screen is the one showing and the tab
    // is visible, so a screen left in the background isn't reading the GPS.
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
        if (!autoLocate || !isActive || !navigator.geolocation) return undefined;
        const poll = () => {
            if (document.visibilityState === 'hidden') return;
            navigator.geolocation.getCurrentPosition(
                // A fresh object every 15s re-rendered the whole map even when
                // the rep hadn't moved; only a move of ~20 m or more updates it.
                (pos) => {
                    const next: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    rememberPosition(next);
                    setOrigin(prev => prev || next);
                    setMyPosition((prev) => (prev && milesBetween(prev, next) < 0.0125 ? prev : next));
                },
                (err) => {
                    // Refused (code 1): stop trying until Locate is tapped again.
                    if (err?.code === 1) { forgetLocationOk(); setAutoLocate(false); }
                },
                { enableHighAccuracy: true, timeout: 8000 }
            );
        };
        poll();
        const intervalId = setInterval(poll, 15000);
        document.addEventListener('visibilitychange', poll);
        return () => {
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', poll);
        };
    }, [autoLocate, isActive]);

    // This component stays mounted behind display:none when you navigate
    // away (see SalesTabViews.tsx), so the map instance survives.
    useEffect(() => {
        if (!isActive || !mapRef.current || !window.google) return;
        const map = mapRef.current;
        const held = map.getCenter();
        window.google.maps.event.trigger(map, 'resize');
        if (held) map.setCenter(held);
    }, [isActive]);

    const myId = String(currentUser?.id || currentUser?._id || '');

    const visible = useMemo((): Customer[] => {
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
        (): Customer[] => pins.filter(p => selectedIds.has(p._id)).map(p => ({ ...p, recency: visitRecency(p.lastVisitAt) })),
        [pins, selectedIds]
    );

    /** Everyone visible but not currently selected — clustered on the map rather than shown one by one. */
    const unselectedPins = useMemo(
        () => visible.filter(p => !selectedIds.has(p._id)),
        [visible, selectedIds]
    );

    const day = useMemo((): DayStop[] => {
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

    const summary = useMemo((): DaySummary => daySummary(day), [day]);

    // The six types customers can be given are always offered, with or without
    // customers loaded (they're also the colour key); any other type found in
    // the data follows, A–Z.
    const types = useMemo((): string[] => {
        const known = new Set(KNOWN_TYPES.map(t => t.toLowerCase()));
        const others = [...new Set(pins.map(p => p.customerType).filter(Boolean) as string[])]
            .filter(t => !known.has(String(t).toLowerCase()))
            .sort();
        return [...KNOWN_TYPES, ...others];
    }, [pins]);

    const counts = useMemo(() => {
        const tally: Record<RecencyKey, number> = { never: 0, overdue: 0, due: 0, recent: 0 };
        pins
            .filter(p => hasPoint(p))
            .filter(p => activeSalesReps[repKey(p.salesRep)] === true)
            .forEach(p => { tally[visitRecency(p.lastVisitAt).key as RecencyKey] += 1; });
        return tally;
    }, [pins, activeSalesReps]);

    const typeCounts = useMemo(() => {
        const tally: Record<string, number> = {};
        pins
            .filter(p => hasPoint(p))
            .filter(p => activeSalesReps[repKey(p.salesRep)] === true)
            .forEach(p => {
                const key = p.customerType || '(blank)';
                tally[key] = (tally[key] || 0) + 1;
            });
        return tally;
    }, [pins, activeSalesReps]);

    // The rep picker's own counts, for every rep in scope whether or not their
    // customers are loaded (the server counts them: GET /map/rep-counts), so
    // unchecking someone leaves their count in place.
    const repCounts = repCountsAll;

    // The rep picker's rows — driven off repCounts' keys (who actually has
    // pins right now), same as `types` is driven off the pins that actually
    // carry one, rather than the full staff directory. salesReps supplies
    // the display name for each id; a key with no match (a rep removed from
    // the roster after being assigned accounts) falls back to a label that
    // still reads as "someone", not a blank row.
    // Unassigned first, then reps grouped under their branch with you marked
    // "(you)" — the format every rep dropdown and filter shares
    // (groupRepOptions in src/utils/salesReps.js). `group` is the heading.
    // The reps this person may see (routePlannerScope.js — the server applies the
    // same rule), with how many customers each holds.
    const scopedReps = useMemo(() => repsInScope(currentUser, salesReps), [currentUser, salesReps]);
    const salesRepOptions = useMemo(() => {
        const reps = scopedReps.map((r: StaffMember) => ({
            value: String(r._id), id: String(r._id), label: r.name || 'Unnamed', location: r.location || ''
        }));
        return [
            ...(repCounts[UNASSIGNED] ? [{ key: UNASSIGNED, label: 'Unassigned', group: null }] : []),
            ...groupRepOptions(reps, { you: myId }).flatMap(g => g.options.map(o => ({ key: o.value, label: o.label, group: g.group })))
        ];
    }, [scopedReps, repCounts, myId]);
    const scopeLocations = useMemo(() => scopeLocationsOf(currentUser), [currentUser]);

    // Seeds the rep filter once, without clobbering a toggle the rep already
    // made this session (filtersSeededRef guards that, same intent as the
    // `key in prev` check the old version used). A saved preference
    // (currentUser.routePlannerFilters, set by the PUT below) wins when one
    // exists; otherwise the default is role-based rather than uniformly
    // "just me", since an admin or manager landing on an empty map with
    // nothing checked reads as broken, not as a starting point to build from:
    //   - admin: every rep on
    //   - manager/director: every rep sharing one of their assignedLocations
    //     (falling back to `location` for a rep with none recorded)
    //   - sales_rep (or anyone else): just themselves, the prior default
    // Admin/manager both need the full roster, not just salesRepOptions
    // (which only lists reps with a pin on the map right now), so this waits
    // on `salesReps` before computing those two branches.
    const filtersSeededRef = useRef(false);
    useEffect(() => {
        if (filtersSeededRef.current || !myId) return;

        // undefined/null means "never saved one" (a brand-new user's
        // routePlannerFilters is just {}) — distinct from a saved, empty {}
        // meaning "I want nobody checked", which must not fall through to
        // the role default below.
        const saved = savedFiltersOf(currentUser)?.activeSalesReps;
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
            savedFilterJson.current.activeSalesReps = JSON.stringify(saved);
            setActiveSalesReps(saved);
            filtersSeededRef.current = true;
            markReady('reps');
            return;
        }

        const role = String(currentUser?.role || '').toLowerCase();
        if (role === 'admin') {
            if (salesReps.length === 0) return; // wait for the roster
            // 'unassigned' isn't a real staff member so it never appears in
            // salesReps — included explicitly, since "all reps" for an admin
            // should mean every pin, not every pin with an owner.
            const next: Toggles = { unassigned: true };
            salesReps.forEach(r => { next[String(r._id)] = true; });
            setActiveSalesReps(next);
            filtersSeededRef.current = true;
            markReady('reps');
        } else if (role === 'manager' || role === 'director') {
            if (salesReps.length === 0) return; // wait for the roster
            // Every rep at their locations — scopedReps is exactly that list.
            const next: Toggles = { [myId]: true }; // never hide the manager's own accounts
            scopedReps.forEach((r: StaffMember) => { next[String(r._id)] = true; });
            setActiveSalesReps(next);
            filtersSeededRef.current = true;
            markReady('reps');
        } else {
            setActiveSalesReps(prev => (myId in prev ? prev : { ...prev, [myId]: true }));
            filtersSeededRef.current = true;
            markReady('reps');
        }
    }, [myId, currentUser, salesReps, scopedReps, markReady]);

    // Persists every change back to the user's record so the next visit
    // loads it instead of recomputing the role default — immediately, not
    // debounced (a refresh right after toggling must not lose it), and only
    // once the saved value has loaded (filtersReady above).
    useEffect(() => {
        if (!filtersReady.reps || !myId) return;
        saveFilter('activeSalesReps', activeSalesReps);
    }, [activeSalesReps, myId, filtersReady.reps, saveFilter]);

    // The pins' colour mode: loaded once, saved on change.
    const colorsSeededRef = useRef(false);
    useEffect(() => {
        if (colorsSeededRef.current || !myId) return;
        const saved = savedFiltersOf(currentUser)?.pinColors?.mode;
        if (PIN_COLOR_MODES.includes(saved as string)) {
            savedFilterJson.current.pinColors = JSON.stringify({ mode: saved });
            setColorMode(saved as ColorMode);
        }
        colorsSeededRef.current = true;
        markReady('colors');
    }, [myId, currentUser, markReady]);
    useEffect(() => {
        if (!filtersReady.colors || !myId) return;
        saveFilter('pinColors', { mode: colorMode });
    }, [colorMode, myId, filtersReady.colors, saveFilter]);

    // Loads a saved Customer Type filter once, same "don't clobber an
    // in-session toggle" guard as the sales-rep seed effect. Unlike that one
    // there's no role-based default to compute — when nothing's saved yet,
    // the sync effect below already defaults every type to shown.
    const typesSeededRef = useRef(false);
    useEffect(() => {
        if (typesSeededRef.current || !myId) return;
        const saved = savedFiltersOf(currentUser)?.activeTypes;
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
            savedFilterJson.current.activeTypes = JSON.stringify(saved);
            setActiveTypes(saved);
        }
        typesSeededRef.current = true;
        markReady('types');
    }, [myId, currentUser, markReady]);

    // Persists every change, same immediate (non-debounced) save as the
    // sales-rep filter and for the same reason — a refresh shortly after
    // toggling must not lose it.
    useEffect(() => {
        if (!filtersReady.types || !myId) return;
        saveFilter('activeTypes', activeTypes);
    }, [activeTypes, myId, filtersReady.types, saveFilter]);

    // New types (including '(blank)', once any pin lacks one) default to
    // shown the first time they're seen, without clobbering a toggle the
    // rep already made on an existing one — or a saved preference loaded
    // above, since that ends up in the same `prev` this reads.
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

    // Days Since Last Visit filter — same load-once / save-immediately pair
    // as Customer Type above. No sync-new-buckets effect needed here, since
    // the four recency buckets are fixed (never/overdue/due/recent), not
    // data-driven like customer types.
    const bucketsSeededRef = useRef(false);
    useEffect(() => {
        if (bucketsSeededRef.current || !myId) return;
        const saved = savedFiltersOf(currentUser)?.activeBuckets;
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
            savedFilterJson.current.activeBuckets = JSON.stringify(saved);
            setActiveBuckets(saved);
        }
        bucketsSeededRef.current = true;
        markReady('buckets');
    }, [myId, currentUser, markReady]);

    useEffect(() => {
        if (!filtersReady.buckets || !myId) return;
        saveFilter('activeBuckets', activeBuckets);
    }, [activeBuckets, myId, filtersReady.buckets, saveFilter]);

    const orderById = useMemo(() => {
        const map = new Map<string, number>();
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
        const map = new Map<string, ScheduleRow[]>();
        scheduleById.forEach(row => {
            if (!row.startTime) return;
            const key = todayKey(new Date(row.startTime));
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(row);
        });
        map.forEach(list => list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()));
        return map;
    }, [scheduleById]);

    const pinById = useMemo(() => new Map(pins.map(p => [String(p._id), p])), [pins]);

    // ScheduleVisitForm's customer picker — the customers already loaded for
    // the map (only ones with a pin can be put on a route), shaped by the same
    // rules as every other customer dropdown (customerOptions.js) rather than
    // a second fetch of the same data.
    const customerOptions = useMemo(() => toCustomerOptions(pins), [pins]);

    // "Schedule a visit" (ScheduleVisitSheet): the customer being put on a day, or
    // rescheduled. Books the chosen day and time — a new entry, or the customer's
    // existing one moved — instead of the day set in the Tools panel.
    const [scheduleSheet, setScheduleSheet] = useState<Customer | null>(null);
    const saveVisitSlot = async ({ customer, booking, startTime, endTime }: VisitSlotInput) => {
        if (saving) return false;
        setSaving(true);
        setError('');
        try {
            const res = booking
                ? await authFetch(`${API_URL}/api/schedule/${booking.id}`, { method: 'PUT', body: JSON.stringify({ startTime, endTime }) })
                : await authFetch(`${API_URL}/api/schedule/bulk`, {
                    method: 'POST',
                    body: JSON.stringify({
                        date: startTime.slice(0, 10),
                        items: [{ customerId: customer._id, startTime, endTime, activityType: 'Visit', notes: '' }]
                    })
                });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.message || 'Could not save this visit');
            await loadScheduled();
            return true;
        } catch (err) {
            setError((err as Error).message || 'Could not save this visit');
            return false;
        } finally {
            setSaving(false);
        }
    };

    const removeFromCalendar = async (customer: Customer) => {
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
            setError((err as Error).message || 'Could not remove it from the calendar');
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
                const here: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                rememberPosition(here);
                setAutoLocate(true); // allowed now: follow quietly from here on
                setOrigin(here);
                setMyPosition(here);
                if (!mapRef.current) return;
                mapRef.current.panTo(here);
                mapRef.current.setZoom(12);
            },
            () => {
                forgetLocationOk();
                setError('Location is switched off for this site — turn it on in the browser’s site settings.');
            },
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
    // A pin is slim (src/routes/customerMap.js): phone, email, address, notes… are
    // fetched when a customer is opened, and kept for the next time (cleared by
    // load(), since an edit elsewhere changes them).
    const detailsCache = useRef(new Map<string, Loose>());
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
    }, [currentUser]);

    // Closes the customer detail popup the way a "back" action would: if it
    // was opened from a row inside Tools, Customers, or Schedule (see
    // showDetails/showScheduledVisit), that panel reopens instead of leaving
    // the right column empty — otherwise dismissing the popup silently
    // dropped whichever panel it had replaced, with no way back to it short
    // of redrawing a selection, re-searching, or re-finding the same day on
    // the calendar.
    // The Status pill in the shared panel — the same request the Customers tab sends.
    const changeStatus = async (id: string, status: string) => {
        try {
            const res = await authFetch(`${API_URL}/api/customers/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
            if (!res.ok) return false;
            setPins(prev => prev.map(p => (String(p._id) === String(id) ? { ...p, status } : p)));
            setInfo(prev => (prev && String(prev._id) === String(id) ? { ...prev, status } : prev));
            return true;
        } catch {
            return false;
        }
    };

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
    // elsewhere in this file.
    const showCustomerFromList = useCallback(
        (pin: Pin) => showDetails({ ...pin, recency: visitRecency(pin.lastVisitAt) }, 'customers'),
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
    const deleteScheduledVisit = async (visit: ScheduleRow) => {
        const label = nameOf({ company: customerOf(visit)?.company, contactName: customerOf(visit)?.contactName });
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
            setError((err as Error).message || 'Could not remove this visit');
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
    const saveScheduleVisit = async (form: ScheduleVisitInput, visitId?: string): Promise<ScheduleRow | null> => {
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
            setError((err as Error).message || 'Could not save this visit');
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
    const handleRadiusSelect = useCallback((circleCenter: LatLng, radiusMeters: number) => {
        const radiusMi = radiusMeters / 1609.34;
        const next = new Set<string>();
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
    const handleLassoSelect = useCallback((path: LatLng[]) => {
        const next = new Set<string>();
        visible.forEach(p => {
            if (pointInPolygon(p.coordinates, path)) next.add(p._id);
        });
        setSelectedIds(next);
        setSelectionShape({ type: 'lasso', path });
        setDrawMode(null);
    }, [visible]);

    const removeSelectedPoint = (pin: Customer) => {
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
    const reorderStop = useCallback((draggedId: string, targetId: string) => {
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

    // "Plan route" from the customer list: those customers become the
    // selection a day is built from, and the Tools panel opens on them. Keyed
    // on the nonce so picking the same set twice still re-applies it. Ids whose
    // pins haven't loaded yet are fine — selectedPins reads them off `pins`.
    useEffect(() => {
        if (!preselect?.ids?.length) return;
        setSelectedIds(new Set(preselect.ids.map(String)));
        setSelectionShape(null);
        setDrawMode(null);
        setShowToolsPanel(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [preselect?.nonce]);

    const toggleType = (type: string) => {
        setActiveTypes(prev => ({ ...prev, [type]: prev[type] === false }));
    };

    const toggleAllTypes = (showAll: boolean) => {
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

    const toggleBucket = (key: string) => setActiveBuckets(prev => ({ ...prev, [key]: !prev[key] }));

    const toggleSalesRep = (key: string) => {
        setActiveSalesReps(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const toggleAllSalesReps = (showAll: boolean) => {
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
    const searchLeads = useCallback(async (queryText: string) => {
        if (!mapRef.current || !window.google?.maps) return;
        const bounds = mapRef.current.getBounds();
        if (!bounds) {
            setLeadError('The map is still loading — try again in a moment.');
            return;
        }

        setLeadSearching(true);
        setLeadError('');
        try {
            const { Place } = await window.google.maps.importLibrary('places') as google.maps.PlacesLibrary;
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
                coordinates: { lat: p.location!.lat(), lng: p.location!.lng() },
                addressParts: parseAddressComponents(p.addressComponents as Parameters<typeof parseAddressComponents>[0])
            })));
            setLeadInfo(null);
            setRecentLeadSearches(saveRecentLeadSearch(queryText));
        } catch (err) {
            setLeadError((err as Error).message || 'Could not search this area');
        } finally {
            setLeadSearching(false);
        }
    }, []);

    const saveLead = async (place: Lead) => {
        if (savingLead) return;
        setSavingLead(true);
        setLeadError('');
        try {
            const parts: Partial<Lead['addressParts']> = place.addressParts || {};
            const res = await authFetch(`${API_URL}/api/customers`, {
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
            setLeadError((err as Error).message || 'Could not save this lead');
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
    const openEditCustomer = async (customer: Loose) => {
        setLoadingEditCustomer(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/${customer._id}`);
            if (!res.ok) throw new Error('Could not load this customer’s full details for editing');
            setEditingCustomer(await res.json());
        } catch (err) {
            setError((err as Error).message || 'Could not load this customer’s full details for editing');
        } finally {
            setLoadingEditCustomer(false);
        }
    };

    /** AddCustomerModal's onSave(form, closeModal) — mirrors handleSavePartner in features/customers/list/PartnersSheet.tsx exactly. */
    const saveCustomerEdit = async (formData: Loose, closeModal: () => void) => {
        if (!editingCustomer) return;
        setSavingCustomerEdit(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/${editingCustomer._id}`, {
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
            setError((err as Error).message || 'Could not save this customer');
        } finally {
            setSavingCustomerEdit(false);
        }
    };

    const deleteCustomer = async (customer: Customer) => {
        if (!window.confirm(`Delete ${nameOf(customer)}? This can't be undone.`)) return;
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/${customer._id}`, { method: 'DELETE' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || 'Could not delete this customer');
            }
            setPins(prev => prev.filter(p => p._id !== customer._id));
            setInfo(null);
            setReturnPanel(null);
        } catch (err) {
            setError((err as Error).message || 'Could not delete this customer');
        }
    };

    // "Planned stops in → POST /api/schedule/bulk → reflect the result" —
    // shared by scheduleDay, the one function that now schedules `day`
    // regardless of whether it was triggered from the area-list panel's
    // "Schedule day" button or the Tools panel's "Create Route" button,
    // since both read the same selection-derived `day`.
    const scheduleStops = async (stops: DayStop[], onSaved?: () => void) => {
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
            setError((err as Error).message || 'Could not schedule the route');
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
            setError((err as Error).message || 'Could not clear the day');
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
    // The phone bar's three-line menu: Find new leads and Live traffic, which
    // only exist as separate icons on the desktop rail.
    const moreControl = isLoaded && !loadError ? (
        <MoreMenu
            leadQuery={leadQuery}
            onLeadQueryChange={setLeadQuery}
            onLeadSearch={searchLeads}
            leadSearching={leadSearching}
            recentLeads={recentLeadSearches}
            onRemoveRecent={(term) => setRecentLeadSearches(removeRecentLeadSearch(term))}
            showTraffic={showTraffic}
            onToggleTraffic={() => setShowTraffic(v => !v)}
        />
    ) : null;

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
                recencyBuckets={RECENCY_BUCKETS as RecencyBucket[]}
                activeBuckets={activeBuckets}
                recencyCounts={counts}
                onToggleBucket={toggleBucket}
                salesRepOptions={salesRepOptions}
                activeSalesReps={activeSalesReps}
                repCounts={repCounts}
                onToggleSalesRep={toggleSalesRep}
                onToggleAllSalesReps={toggleAllSalesReps}
                colorMode={colorMode}
                onColorModeChange={setColorMode}
                lastKnownPosition={lastKnownPosition}
                scopeNote={scopeLocations ? `Your locations: ${scopeLocations.join(', ') || 'none'}` : ''}
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
                can={can}
                saving={saving}
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
                moreControl={moreControl}
            />

            {/* The open customer: the Customers tab's own panel (so it changes with
                that), plus what the map adds under the header. When the customer is on
                the day being planned, the arrows step through that day's stops;
                otherwise it's just this one customer. */}
            {info && (() => {
                const stopIndex = day.findIndex(stop => String(stop._id) === String(info._id));
                const onRoute = stopIndex >= 0 && day.length > 1;
                const goStop = (i: number) => {
                    const pin = pinById.get(String(day[i]?._id));
                    if (pin) showDetails({ ...pin, recency: visitRecency(pin.lastVisitAt) }, returnPanel);
                };
                const canProfile = canViewCustomerProfile(currentUser);
                const booking = scheduled.get(String(info._id)) || null;
                return (
                    <CustomerDrawer
                        key={String(info._id)}
                        className="rpv2-host"
                        customer={info}
                        overlay={false}
                        position={onRoute ? { index: stopIndex, total: day.length } : null}
                        onPrev={onRoute && stopIndex > 0 ? () => goStop(stopIndex - 1) : null}
                        onNext={onRoute && stopIndex < day.length - 1 ? () => goStop(stopIndex + 1) : null}
                        onClose={closeInfo}
                        onOpenProfile={(c) => { onOpenCustomer?.(c._id); closeInfo(); }}
                        onEdit={(c) => openEditCustomer(c)}
                        onDelete={() => deleteCustomer(info)}
                        onStatusChange={changeStatus}
                        canEdit={can.manageCustomers}
                        canDelete={can.deleteCustomers}
                        canProfile={canProfile && Boolean(onOpenCustomer)}
                        mapSection={(
                            <MapActions
                                pin={info}
                                colors={colors}
                                stop={day.find(stop => String(stop._id) === String(info._id)) || null}
                                booking={booking}
                                canPlan={can.plan}
                                saving={saving}
                                onSchedule={() => setScheduleSheet(info)}
                                onRemove={() => removeFromCalendar(info)}
                                onAddVisit={onAddVisit ? () => onAddVisit(info) : null}
                                onAddResource={onAddResource ? () => onAddResource(info) : null}
                            />
                        )}
                    />
                );
            })()}

            {scheduleSheet && (
                <ScheduleVisitSheet
                    customer={scheduleSheet}
                    booking={scheduled.get(String(scheduleSheet._id)) || null}
                    visitsByDate={visitsByDate}
                    minutes={Number(stopMinutes) || 45}
                    saving={saving}
                    onClose={() => setScheduleSheet(null)}
                    onSave={saveVisitSlot}
                />
            )}

            {/* Same modal features/customers/list/PartnersSheet.tsx uses for editing a customer —
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
