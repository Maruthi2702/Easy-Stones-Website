import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { GoogleMap, useJsApiLoader, Marker, Circle, InfoWindow } from '@react-google-maps/api';
import { MapPin, Navigation, Calendar, Clock, Route, X, Check, AlertTriangle, Users, RefreshCw, Trash2, Phone, Mail } from 'lucide-react';
import { API_URL } from '../../config/api';
import CustomSelect from '../shared/CustomSelect';
import {
    orderStops, planDay, daySummary, visitRecency, byNeglect,
    withinRadius, hasPoint, isRoutablePrecision, localISO, RECENCY_BUCKETS, DEFAULT_DAY
} from '../../utils/routePlan';
// 125 customers carry "N/A" as a contact name and 27 as a phone number — typed
// because the box was required. Rendering those as facts, or worse as a tel:
// link, states something we do not know. Same test the importer and the
// duplicate audit use.
import { isFillerName, isPlaceholderEmail } from '../../utils/customerMatch';
import './RoutePlannerTab.css';

/**
 * Plan a day in the field: pick an area, see who is there and how overdue each
 * one is, and put the whole run on the calendar in one action.
 *
 * The problem this replaces is a personal Google Maps pin board — every customer
 * saved by hand, no idea which of them you have neglected, and a schedule built
 * one entry at a time. All three of those are answerable from data we already
 * hold, once customers have coordinates.
 */

/**
 * How overdue an account is, as an ordinal ramp: one hue, stepping darker (light
 * theme) or brighter (dark theme) as the neglect gets worse. Selected with the
 * dataviz validator against each surface — the two themes are separate steps of
 * the same hue, not one palette flipped, because a deep red that reads as urgent
 * on white disappears on near-black.
 *
 * Recently-visited sits outside the ramp in recessive grey on purpose: those are
 * the accounts you are *not* trying to find, and they should fall back rather
 * than compete for the eye.
 *
 * Colour never carries this alone — every pin in a route is numbered, and the
 * stop list states the day count in words. That pairing is what makes the ramp
 * legible to a colourblind reader, for whom adjacent steps of one hue are close.
 */
const RECENCY_COLORS = {
    dark: { never: '#a02f2f', overdue: '#dd6a58', due: '#f5b39c', recent: '#5c5b56' },
    light: { never: '#7a1a1a', overdue: '#c33a3a', due: '#e0806a', recent: '#c4c2bb' }
};

// Where the map opens when nothing better is known. The branch cities are the
// honest default — a rep planning a day is almost always working out from one.
const FALLBACK_CENTER = { lat: 47.6062, lng: -122.3321 };

const pad = (n) => String(n).padStart(2, '0');
const todayKey = (d = new Date()) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'Wed 19 Aug, 09:00' from a stored 'YYYY-MM-DDTHH:mm:ss.000'. */
const whenLabel = (startTime) => {
    const d = new Date(startTime);
    if (Number.isNaN(d.getTime())) return String(startTime).slice(0, 10);
    return d.toLocaleString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
};

const real = (value) => (isFillerName(value) ? '' : String(value).trim());

const nameOf = (pin) => real(pin.company) || real(pin.contactName) || 'Unknown';

const RoutePlannerTab = ({ currentUser = null, theme = 'dark', onOpenCustomer = null, sidebarToggle = null, isActive = true }) => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    const { isLoaded, loadError } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: apiKey || '' });

    const colors = RECENCY_COLORS[theme === 'light' ? 'light' : 'dark'];

    const [pins, setPins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Filters
    const [mineOnly, setMineOnly] = useState(true);
    // All four on: the map opens showing the whole book, and you switch buckets
    // off to narrow it. Starting with recently-visited hidden meant the counts on
    // screen never added up to the accounts you actually own.
    const [activeBuckets, setActiveBuckets] = useState({ never: true, overdue: true, due: true, recent: true });
    const [customerType, setCustomerType] = useState('');

    // The area being planned
    const [center, setCenter] = useState(null);
    const [radiusMiles, setRadiusMiles] = useState(10);
    const [dropped, setDropped] = useState(new Set());   // in the circle but taken out by hand
    const [added, setAdded] = useState(new Set());       // outside it but put in by hand
    const [info, setInfo] = useState(null);
    const [scheduled, setScheduled] = useState(new Map());   // customerId -> booking

    // The day being built
    const [date, setDate] = useState(todayKey());
    const [startAt, setStartAt] = useState('09:00');
    const [stopMinutes, setStopMinutes] = useState(DEFAULT_DAY.stopMinutes);
    const [origin, setOrigin] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(null);
    const [replaceExisting, setReplaceExisting] = useState(false);

    // The server enforces each of these; hiding what a role cannot do keeps the
    // screen honest rather than offering a button that answers 403.
    const can = useMemo(() => {
        const held = currentUser?.permissions || [];
        return {
            plan: held.includes('create_route_plan'),
            replace: held.includes('edit_route_plan'),
            clear: held.includes('delete_route_plan')
        };
    }, [currentUser]);

    const mapRef = useRef(null);

    /**
     * What is already on this rep's calendar, by customer.
     *
     * The dialog has to tell "I have pencilled you into the day I am building"
     * apart from "you are actually booked", because they are different claims and
     * only the second is a thing to cancel. Looks a season ahead, which is far
     * more than a route is ever planned over.
     */
    const loadScheduled = useCallback(async () => {
        try {
            const from = new Date();
            const to = new Date();
            to.setDate(to.getDate() + 120);
            const token = localStorage.getItem('token');
            const res = await fetch(
                `${API_URL}/api/schedule?start=${todayKey(from)}T00:00:00.000&end=${todayKey(to)}T23:59:59.999`,
                { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' }
            );
            if (!res.ok) return;
            const rows = await res.json();
            const byCustomer = new Map();
            (Array.isArray(rows) ? rows : []).forEach(row => {
                const id = String(row.customerId?._id || row.customerId || '');
                // Earliest upcoming booking wins — that is the one you would cancel.
                if (id && !byCustomer.has(id)) byCustomer.set(id, { id: row._id, startTime: row.startTime });
            });
            setScheduled(byCustomer);
        } catch {
            /* the planner still works without it; the dialog just cannot say "booked" */
        }
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/customers/map`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                credentials: 'include'
            });
            if (!res.ok) throw new Error(`Map data unavailable (${res.status})`);
            const data = await res.json();
            setPins(Array.isArray(data) ? data : []);
        } catch (err) {
            setError(err.message || 'Could not load customer locations');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { loadScheduled(); }, [loadScheduled]);

    // Start from where the rep is, since a day is planned outward from it. The
    // map still opens if this is refused — it only loses the "near me" default.
    useEffect(() => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setOrigin(here);
                setCenter(prev => prev || here);
            },
            () => { /* denied — the fallback centre still works */ },
            { timeout: 8000 }
        );
    }, []);

    // This component stays mounted behind display:none when you navigate away,
    // so the map instance survives and is not re-bought on return. The cost of
    // that is a map whose container had no size while hidden: it comes back grey
    // or off-centre unless it is told to look again.
    useEffect(() => {
        if (!isActive || !mapRef.current || !window.google) return;
        const map = mapRef.current;
        const held = map.getCenter();
        window.google.maps.event.trigger(map, 'resize');
        if (held) map.setCenter(held);
    }, [isActive]);

    const myId = String(currentUser?.id || currentUser?._id || '');

    /** Pins that survive the filters — what is drawn, before any area is chosen. */
    const visible = useMemo(() => {
        return pins
            .filter(p => hasPoint(p))
            .filter(p => !mineOnly || String(p.salesRep || '') === myId)
            .filter(p => !customerType || p.customerType === customerType)
            .map(p => ({ ...p, recency: visitRecency(p.lastVisitAt) }))
            .filter(p => activeBuckets[p.recency.key]);
    }, [pins, mineOnly, myId, customerType, activeBuckets]);

    /** In the circle, plus anything hand-added, minus anything hand-dropped. */
    const chosen = useMemo(() => {
        if (!center) return [];
        return visible
            .filter(p => (withinRadius(p, center, radiusMiles) || added.has(p._id)) && !dropped.has(p._id))
            .sort(byNeglect);
    }, [visible, center, radiusMiles, added, dropped]);

    /** The chosen stops, ordered for driving and laid out down the day. */
    const day = useMemo(() => {
        if (!chosen.length) return [];
        const [hour, minute] = startAt.split(':').map(Number);
        const when = new Date(`${date}T00:00:00`);
        const ordered = orderStops(chosen, origin || center);
        return planDay(ordered, {
            date: when,
            startHour: hour || 9,
            startMinute: minute || 0,
            stopMinutes: Number(stopMinutes) || DEFAULT_DAY.stopMinutes,
            origin: origin || center
        });
    }, [chosen, startAt, date, stopMinutes, origin, center]);

    const summary = useMemo(() => daySummary(day), [day]);

    const types = useMemo(
        () => [...new Set(pins.map(p => p.customerType).filter(Boolean))].sort(),
        [pins]
    );

    const counts = useMemo(() => {
        const tally = { never: 0, overdue: 0, due: 0, recent: 0 };
        pins
            .filter(p => hasPoint(p))
            .filter(p => !mineOnly || String(p.salesRep || '') === myId)
            .forEach(p => { tally[visitRecency(p.lastVisitAt).key] += 1; });
        return tally;
    }, [pins, mineOnly, myId]);

    const toggleStop = (pin) => {
        const inCircle = center && withinRadius(pin, center, radiusMiles);
        if (inCircle) {
            setDropped(prev => {
                const next = new Set(prev);
                next.has(pin._id) ? next.delete(pin._id) : next.add(pin._id);
                return next;
            });
        } else {
            setAdded(prev => {
                const next = new Set(prev);
                next.has(pin._id) ? next.delete(pin._id) : next.add(pin._id);
                return next;
            });
        }
    };

    const clearArea = () => { setDropped(new Set()); setAdded(new Set()); setSaved(null); };

    /**
     * Book one customer, without committing the whole run.
     *
     * Takes the time the planner already worked out for them if they are in the
     * run, so a stop booked on its own lands where the route said it would;
     * otherwise it goes at the day's start time.
     */
    const addOneToCalendar = async (customer) => {
        if (saving) return;
        setSaving(true);
        setError('');
        try {
            const planned = day.find(stop => stop._id === customer._id);
            const [hour, minute] = startAt.split(':').map(Number);
            const fallbackStart = `${date}T${pad(hour || 9)}:${pad(minute || 0)}:00.000`;
            const fallbackEnd = new Date(new Date(fallbackStart).getTime() + (Number(stopMinutes) || 45) * 60000);

            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/schedule/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                credentials: 'include',
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

    /** Cancel a booking. The customer stays on the map and in the run. */
    const removeFromCalendar = async (customer) => {
        const booking = scheduled.get(String(customer._id));
        if (!booking || saving) return;
        setSaving(true);
        setError('');
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/schedule/${booking.id}`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                credentials: 'include'
            });
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

    /**
     * Open the popup for a customer and bring the map to it. Used by the stop
     * list as well as the pins, so a name in the run and its pin lead to the
     * same one place — there is no second card that can drift from this one.
     */
    const showDetails = (customer) => {
        setInfo(customer);
        if (mapRef.current && customer?.coordinates) mapRef.current.panTo(customer.coordinates);
    };

    const handleMapClick = (event) => {
        setCenter({ lat: event.latLng.lat(), lng: event.latLng.lng() });
        clearArea();
    };

    const scheduleDay = async () => {
        if (!day.length || saving) return;
        setSaving(true);
        setError('');
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/schedule/bulk`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                credentials: 'include',
                body: JSON.stringify({
                    date,
                    replace: replaceExisting && can.replace,
                    items: day.map(stop => ({
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
            clearArea();
            await loadScheduled();
        } catch (err) {
            setError(err.message || 'Could not schedule the route');
        } finally {
            setSaving(false);
        }
    };

    const clearPlannedDay = async () => {
        if (saving) return;
        if (!window.confirm(`Remove the stops the route planner put on ${date}? Anything you added by hand stays.`)) return;
        setSaving(true);
        setError('');
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/schedule/route?date=${date}`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                credentials: 'include'
            });
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

    // A pin's mark. Numbered when it is in the route — that number is what makes
    // the order readable, and what keeps the ramp from being colour alone.
    const markerIcon = (pin, order) => {
        if (!window.google) return undefined;
        const inRoute = Boolean(order);
        return {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: inRoute ? 11 : (pin.recency.key === 'recent' ? 5 : 7),
            fillColor: colors[pin.recency.key],
            fillOpacity: 1,
            // A ring in the surface colour, so a pin stays legible against any
            // map tile and two overlapping pins still read as two.
            strokeColor: theme === 'light' ? '#ffffff' : '#1a1a19',
            strokeWeight: inRoute ? 3 : 2
        };
    };

    const orderById = useMemo(() => {
        const map = new Map();
        day.forEach(stop => map.set(stop._id, stop.order));
        return map;
    }, [day]);

    // The map fills the screen, so without this there is no way back to the rest
    // of the app once the sidebar is collapsed. Same button the delivery board
    // and lost sales use, passed down from the page that owns the sidebar state.
    const pageHeader = (
        <div className="rp-page-head">
            {sidebarToggle}
            <h2>Route Planner</h2>
        </div>
    );

    if (!apiKey) {
        return (
            <div className="route-planner-shell">
                {pageHeader}
                <div className="route-planner">
                    <div className="rp-empty">
                        <MapPin size={40} />
                        <h3>The map needs a Google Maps key</h3>
                        <p>
                            Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to <code>.env</code> and restart the dev server.
                            The same key (or <code>GOOGLE_GEOCODING_API_KEY</code>) is what gives customers their
                            coordinates in the first place — see <code>scripts/geocode-customers.js</code>.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="route-planner-shell">
            {pageHeader}
            <div className="route-planner">
                <div className="rp-controls">
                    {/* ── who to show ───────────────────────────────────────── */}
                    <section className="rp-card">
                        <header className="rp-card-head">
                            <Users size={15} />
                            <h3>Who to show</h3>
                            <button className="rp-icon-btn" onClick={load} title="Reload customer locations">
                                <RefreshCw size={14} />
                            </button>
                        </header>

                        <label className="rp-check">
                            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                            <span>Only my accounts</span>
                        </label>

                        <div className="rp-legend" role="group" aria-label="Filter by how long since the last visit">
                            {RECENCY_BUCKETS.map(bucket => (
                                <button
                                    key={bucket.key}
                                    type="button"
                                    className={`rp-legend-row ${activeBuckets[bucket.key] ? 'on' : 'off'}`}
                                    onClick={() => setActiveBuckets(prev => ({ ...prev, [bucket.key]: !prev[bucket.key] }))}
                                    aria-pressed={activeBuckets[bucket.key]}
                                >
                                    <span className="rp-swatch" style={{ background: colors[bucket.key] }} />
                                    <span className="rp-legend-label">{bucket.label}</span>
                                    <span className="rp-legend-count">{counts[bucket.key]}</span>
                                </button>
                            ))}
                        </div>

                        {/* The app's own select rather than a native one: an
                            <option> list cannot be styled to match, and a phone
                            renders it as an unthemed system menu over the map. */}
                        <CustomSelect
                            className="rp-type-select"
                            value={customerType}
                            onChange={(e) => setCustomerType(e.target.value)}
                            options={[
                                { value: '', label: 'Every customer type' },
                                ...types.map(t => ({ value: t, label: t }))
                            ]}
                            placeholder="Every customer type"
                        />
                    </section>

                    {/* ── the area ──────────────────────────────────────────── */}
                    <section className="rp-card">
                        <header className="rp-card-head">
                            <Navigation size={15} />
                            <h3>The area</h3>
                        </header>

                        {center ? (
                            <>
                                <label className="rp-field">
                                    <span>Within {radiusMiles} miles</span>
                                    <input
                                        type="range" min="1" max="60" value={radiusMiles}
                                        onChange={(e) => { setRadiusMiles(Number(e.target.value)); setSaved(null); }}
                                    />
                                </label>
                                <p className="rp-hint">
                                    Click the map to move the circle. Click any pin to add or drop that stop.
                                </p>
                            </>
                        ) : (
                            <p className="rp-hint">Click the map where you will be, and everyone nearby becomes a day.</p>
                        )}
                    </section>

                    {/* ── the day ───────────────────────────────────────────── */}
                    <section className="rp-card">
                        <header className="rp-card-head">
                            <Calendar size={15} />
                            <h3>The day</h3>
                        </header>

                        <div className="rp-row">
                            <label className="rp-field">
                                <span>Date</span>
                                <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSaved(null); }} />
                            </label>
                            <label className="rp-field">
                                <span>Start</span>
                                <input type="time" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                            </label>
                            <label className="rp-field">
                                <span>Mins / stop</span>
                                <input
                                    type="number" min="10" max="240" step="5" value={stopMinutes}
                                    onChange={(e) => setStopMinutes(e.target.value)}
                                />
                            </label>
                        </div>

                        {day.length > 0 && (
                            <div className="rp-summary">
                                <strong>{summary.stops}</strong> stops ·{' '}
                                <strong>{summary.miles}</strong> mi ·{' '}
                                <strong>{Math.round(summary.drivingMinutes / 6) / 10}</strong> h driving ·
                                ends <strong>{summary.endsAt?.slice(11, 16)}</strong>
                            </div>
                        )}

                        {can.replace && (
                            <label className="rp-check">
                                <input
                                    type="checkbox"
                                    checked={replaceExisting}
                                    onChange={(e) => setReplaceExisting(e.target.checked)}
                                />
                                <span>Replace stops already planned for this date</span>
                            </label>
                        )}

                        {can.plan ? (
                            <button
                                className="rp-primary"
                                disabled={!day.length || saving}
                                onClick={scheduleDay}
                            >
                                <Route size={15} />
                                {saving ? 'Scheduling…' : `Put ${day.length || 'these'} stop${day.length === 1 ? '' : 's'} on ${date}`}
                            </button>
                        ) : (
                            <p className="rp-hint">
                                You can plan a day here, but adding it to a calendar needs the
                                &ldquo;Plan&rdquo; permission on Route Planner.
                            </p>
                        )}

                        {can.clear && (
                            <button className="rp-secondary" disabled={saving} onClick={clearPlannedDay}>
                                <Trash2 size={14} /> Clear planned stops on {date}
                            </button>
                        )}

                        {saved && (
                            <p className="rp-saved">
                                <Check size={14} />
                                {saved.cleared !== undefined
                                    ? ` ${saved.cleared} planned stop${saved.cleared === 1 ? '' : 's'} removed from ${saved.date}.`
                                    : ` ${saved.count} stop${saved.count === 1 ? '' : 's'} added to your planner for ${saved.date}` +
                                      (saved.replaced ? `, replacing ${saved.replaced}.` : '.')}
                            </p>
                        )}
                        {error && <p className="rp-error"><AlertTriangle size={14} /> {error}</p>}
                    </section>

                    {/* ── the run ───────────────────────────────────────────── */}
                    {day.length > 0 && (
                        <section className="rp-card rp-stops">
                            <header className="rp-card-head">
                                <Clock size={15} />
                                <h3>The run</h3>
                                <button className="rp-icon-btn" onClick={clearArea} title="Reset hand-picked changes">
                                    <X size={14} />
                                </button>
                            </header>

                            <ol className="rp-stop-list">
                                {day.map(stop => (
                                    <li key={stop._id} className="rp-stop">
                                        <span className="rp-stop-order" style={{ background: colors[stop.recency.key] }}>
                                            {stop.order}
                                        </span>
                                        {/* The whole row opens the customer, not just
                                            the name — the name alone is a small
                                            target, and everything in here is about
                                            the same customer anyway. The ✕ beside it
                                            keeps its own job. */}
                                        <div
                                            className="rp-stop-body"
                                            role="button"
                                            tabIndex={0}
                                            title="Customer details"
                                            onClick={() => showDetails(stop)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    showDetails(stop);
                                                }
                                            }}
                                        >
                                            <span className="rp-stop-name">{nameOf(stop)}</span>
                                            <div className="rp-stop-meta">
                                                {stop.startTime.slice(11, 16)}–{stop.endTime.slice(11, 16)}
                                                {' · '}{stop.city || '—'}
                                                {stop.driveMinutes > 0 && ` · ${stop.milesFromPrevious} mi`}
                                            </div>
                                            <div className="rp-stop-recency">{stop.recency.label}</div>
                                            {!isRoutablePrecision(stop.precision) && (
                                                <div className="rp-stop-warn">
                                                    <AlertTriangle size={11} /> Approximate location — check the address
                                                </div>
                                            )}
                                        </div>
                                        <button className="rp-icon-btn" onClick={() => toggleStop(stop)} title="Drop this stop">
                                            <X size={14} />
                                        </button>
                                    </li>
                                ))}
                            </ol>
                        </section>
                    )}
                </div>

                {/* ── the map ───────────────────────────────────────────────── */}
                <div className="rp-map">
                    {loadError && <div className="rp-empty"><p>Google Maps failed to load: {loadError.message}</p></div>}
                    {!loadError && !isLoaded && <div className="rp-empty"><p>Loading the map…</p></div>}
                    {loading && <div className="rp-badge">Loading customers…</div>}
                    {!loading && !error && pins.length === 0 && (
                        <div className="rp-badge rp-badge-warn">
                            No customer has coordinates yet — run <code>node scripts/geocode-customers.js --apply</code>
                        </div>
                    )}

                    {isLoaded && !loadError && (
                        <GoogleMap
                            mapContainerClassName="rp-map-canvas"
                            center={center || origin || FALLBACK_CENTER}
                            zoom={10}
                            onLoad={(map) => { mapRef.current = map; }}
                            onClick={handleMapClick}
                            options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
                        >
                            {center && (
                                <Circle
                                    center={center}
                                    radius={radiusMiles * 1609.34}
                                    options={{
                                        strokeColor: colors.overdue,
                                        strokeOpacity: 0.9,
                                        strokeWeight: 2,
                                        fillColor: colors.overdue,
                                        fillOpacity: 0.08,
                                        clickable: false
                                    }}
                                />
                            )}

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

                            {visible.map(pin => {
                                const order = orderById.get(pin._id);
                                return (
                                    <Marker
                                        key={pin._id}
                                        position={pin.coordinates}
                                        icon={markerIcon(pin, order)}
                                        label={order ? { text: String(order), color: '#ffffff', fontSize: '11px', fontWeight: '700' } : undefined}
                                        title={`${nameOf(pin)} — ${pin.recency.label}`}
                                        onClick={() => setInfo(pin)}
                                    />
                                );
                            })}

                            {info && (
                                <InfoWindow position={info.coordinates} onCloseClick={() => setInfo(null)}>
                                    <div className="rp-customer-dialog" data-dialog="customer">
                                        <div className="rp-cd-top">
                                            <span
                                                className="rp-cd-chip"
                                                style={{ background: colors[info.recency.key] }}
                                            >
                                                {info.recency.key === 'never' ? 'Never visited' : info.recency.label}
                                            </span>
                                            {orderById.has(info._id) && (
                                                <span className="rp-cd-stop">Stop {orderById.get(info._id)}</span>
                                            )}
                                        </div>

                                        <strong className="rp-cd-name">{nameOf(info)}</strong>
                                        {real(info.contactName) && real(info.company) && (
                                            <div className="rp-cd-sub">{real(info.contactName)}</div>
                                        )}

                                        <div className="rp-cd-contact">
                                            {[info.street, info.city, info.state].filter(Boolean).length > 0 ? (
                                                <a
                                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([info.street, info.city, info.state].filter(Boolean).join(', '))}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    <MapPin size={13} />
                                                    <span>{[info.street, info.city, info.state].filter(Boolean).join(', ')}</span>
                                                </a>
                                            ) : (
                                                <span className="rp-cd-muted"><MapPin size={13} /> No address on record</span>
                                            )}
                                            {real(info.phone) && (
                                                <a href={`tel:${real(info.phone)}`}><Phone size={13} /><span>{real(info.phone)}</span></a>
                                            )}
                                            {info.email && !isPlaceholderEmail(info.email) && (
                                                <a href={`mailto:${info.email}`}><Mail size={13} /><span>{info.email}</span></a>
                                            )}
                                        </div>

                                        <dl className="rp-cd-facts">
                                            {[
                                                ['Visits', `${info.visitCount}`],
                                                ['Type', real(info.customerType)],
                                                ['Status', real(info.status)],
                                                ['Level', real(info.level)],
                                                ['Branch', real(info.location)],
                                                ['Rep', real(info.salesRepName)]
                                            ].filter(([, v]) => v).map(([label, value]) => (
                                                <div key={label}>
                                                    <dt>{label}</dt>
                                                    <dd>{value}</dd>
                                                </div>
                                            ))}
                                        </dl>

                                        {!isRoutablePrecision(info.precision) && (
                                            <p className="rp-cd-warn">
                                                <AlertTriangle size={12} />
                                                This pin is the middle of the town, not the address.
                                            </p>
                                        )}

                                        {scheduled.has(String(info._id)) && (
                                            <p className="rp-cd-booked">
                                                <Calendar size={12} />
                                                Scheduled {whenLabel(scheduled.get(String(info._id)).startTime)}
                                            </p>
                                        )}

                                        <div className="rp-cd-actions">
                                            {scheduled.has(String(info._id)) ? (
                                                <button
                                                    className="is-drop"
                                                    disabled={saving}
                                                    onClick={() => removeFromCalendar(info)}
                                                >
                                                    Remove from schedule
                                                </button>
                                            ) : can.plan ? (
                                                <button disabled={saving} onClick={() => addOneToCalendar(info)}>
                                                    Add to calendar
                                                </button>
                                            ) : null}
                                            {onOpenCustomer && (
                                                <button
                                                    className="is-primary"
                                                    onClick={() => { onOpenCustomer(info._id); setInfo(null); }}
                                                >
                                                    Open record
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </InfoWindow>
                            )}
                        </GoogleMap>
                    )}
                </div>
            </div>

        </div>
    );
};

export default RoutePlannerTab;
