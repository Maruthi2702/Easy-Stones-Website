import { useEffect, useMemo, useState } from 'react';
import { Navigation, Lock, MapPinOff } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormPicker } from '../../../components/shared/form/FormControls';
import { useJsApiLoader } from '@react-google-maps/api';
import { authFetch } from '../../../api/authFetch';
import { API_URL } from '../../../config/api';
import { timeOptions, timeText } from '../../../utils/visitSlots';
import { DAY_START_HOUR, planDayRoute, type DayStop, type LatLng, type RouteMode } from '../../../utils/routeDay';
import { DEFAULT_VISIT_MINUTES } from '../../../utils/scheduleRecord';
import { forgetLocationOk, readLastPosition, rememberPosition } from '../../../utils/geolocationAccess';
import { moveActivity } from '../salesPlannerApi';
import { readPlaces, savePlace, type SavedPlace } from '../savedPlaces';
import { patchPlannerItem, refreshPlannerSchedule, type PlannerItem } from '../plannerSchedule';
import { customerName, customerOf, durationText, timeLabel } from '../salesPlanner';
import './OptimizeRouteDialog.css';

export type OptimizeRouteDialogProps = {
    /** The day's stops, yours only, in the order drawn. */
    items: PlannerItem[];
    dayTitle: string;
    onClose: () => void;
    onChanged?: () => void;
};

const pointOf = (item: PlannerItem): LatLng | null => {
    const c = customerOf(item)?.coordinates as { lat?: unknown; lng?: unknown } | undefined;
    return Number.isFinite(c?.lat) && Number.isFinite(c?.lng) ? { lat: c!.lat as number, lng: c!.lng as number } : null;
};

const TIMES = timeOptions();
const ADD = '__add__';
const LENGTHS = [
    { value: 'keep', label: "Each stop's own length" },
    ...[15, 30, 45].map((m) => ({ value: String(m), label: durationText(m) }))
];

const toStop = (item: PlannerItem): DayStop => {
    const start = new Date(item.startTime).getTime();
    const end = item.endTime ? new Date(item.endTime).getTime() : NaN;
    return {
        id: String(item._id), start,
        minutes: end > start ? Math.round((end - start) / 60000) : DEFAULT_VISIT_MINUTES,
        hasEnd: end > start, point: pointOf(item)
    };
};

/** Where the rep is now: the device's position, else the last fix this device made, else nothing. */
const useStartingPoint = () => {
    const [origin, setOrigin] = useState<LatLng | null>(null);
    const [state, setState] = useState<'locating' | 'gps' | 'last' | 'none'>('locating');
    useEffect(() => {
        let gone = false;
        const fallback = () => {
            const last = readLastPosition();
            setOrigin(last); setState(last ? 'last' : 'none');
        };
        if (!navigator.geolocation) { fallback(); return; }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                if (gone) return;
                const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                rememberPosition(here); setOrigin(here); setState('gps');
            },
            (err) => { if (gone) return; if (err.code === 1) forgetLocationOk(); fallback(); },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
        );
        return () => { gone = true; };
    }, []);
    return { origin, state };
};

/** Optimize route: the day's stops in driving order, previewed, then applied. */
export default function OptimizeRouteDialog({ items, dayTitle, onClose, onChanged }: OptimizeRouteDialogProps) {
    const { origin, state } = useStartingPoint();
    const [mode, setMode] = useState<RouteMode>('all');
    const [fixed, setFixed] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [applied, setApplied] = useState<{ id: string; startTime: string; endTime?: string }[] | null>(null);

    const byId = useMemo(() => new Map(items.map((i) => [String(i._id), i])), [items]);
    // How long each stop takes: its own length (30 min when it has none), or one length for all.
    const [length, setLength] = useState('keep');
    const stops = useMemo(() => items.map(toStop).map((s) => (
        length === 'keep' ? s : { ...s, wasMinutes: s.minutes, minutes: Number(length), hasEnd: true }
    )), [items, length]);
    // When the day starts: 9:00, or the next quarter hour when it is today and later than that.
    const dayMs = stops[0]?.start;
    const [startTime, setStartTime] = useState(() => {
        if (dayMs === undefined || new Date(dayMs).toDateString() !== new Date().toDateString()) return timeText(DAY_START_HOUR * 60);
        const now = new Date();
        const next = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
        return timeText(Math.min(20 * 60, Math.max(DAY_START_HOUR * 60, next)));
    });
    const startAt = useMemo(() => {
        if (dayMs === undefined) return undefined;
        const [h, m] = startTime.split(':').map(Number);
        return new Date(dayMs).setHours(h, m, 0, 0);
    }, [dayMs, startTime]);

    // Where it starts and where it finishes: the rep's position, a branch, or (start) the day's first stop / (finish) wherever the last stop is.
    const [branches, setBranches] = useState<{ name: string; point: LatLng }[]>([]);
    const [from, setFrom] = useState('here');
    const [to, setTo] = useState('last');
    useEffect(() => {
        let gone = false;
        authFetch(`${API_URL}/api/admin/locations`)
            .then((r) => (r.ok ? r.json() : []))
            .then((list: { name?: string; coordinates?: { lat?: unknown; lng?: unknown } }[]) => {
                if (gone || !Array.isArray(list)) return;
                setBranches(list
                    .filter((l) => l.name && Number.isFinite(l.coordinates?.lat) && Number.isFinite(l.coordinates?.lng))
                    .map((l) => ({ name: l.name!, point: { lat: l.coordinates!.lat as number, lng: l.coordinates!.lng as number } }))
                    .sort((a, b) => a.name.localeCompare(b.name)));
            })
            .catch(() => { /* the branch choices just aren't offered */ });
        return () => { gone = true; };
    }, []);
    // Places the rep typed before (home, a hotel…), on this device; "Another address…" adds one.
    const [places, setPlaces] = useState<SavedPlace[]>(() => readPlaces());
    const [adding, setAdding] = useState<'from' | 'to' | null>(null);
    const [addressText, setAddressText] = useState('');
    const [labelText, setLabelText] = useState('');
    const [finding, setFinding] = useState(false);
    const [findError, setFindError] = useState('');
    const pointFor = (value: string): LatLng | null => {
        const place = places.find((p) => p.id === value);
        return place ? { lat: place.lat, lng: place.lng } : branches.find((b) => b.name === value)?.point ?? null;
    };
    const startPoint = from === 'here' ? origin : from === 'first' ? null : pointFor(from);
    const endPoint = to === 'last' ? null : pointFor(to);
    const placeOptions = places.map((p) => ({ value: p.id, label: p.label }));
    const fromOptions = [{ value: 'here', label: 'My current location' }, { value: 'first', label: 'The first stop' }, ...placeOptions, ...branches.map((b) => ({ value: b.name, label: b.name })), { value: ADD, label: 'Another address…' }];
    const toOptions = [{ value: 'last', label: 'The last stop' }, ...placeOptions, ...branches.map((b) => ({ value: b.name, label: `Back to ${b.name}` })), { value: ADD, label: 'Another address…' }];
    const pick = (which: 'from' | 'to') => (value: string) => {
        if (value === ADD) { setAdding(which); setFindError(''); return; }
        setAdding(null);
        (which === 'from' ? setFrom : setTo)(value);
    };
    // Same Google Maps loader and Places search as the Route Planner's Find new leads
    // (the browser key); the server's geocoding key isn't used for this.
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    const { isLoaded: mapsReady, loadError: mapsError } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: apiKey || '' });
    const [matches, setMatches] = useState<{ name: string; address: string; lat: number; lng: number }[]>([]);
    const findAddress = async () => {
        setFinding(true); setFindError(''); setMatches([]);
        try {
            if (!window.google?.maps) throw new Error('The map is still loading — try again in a moment.');
            const query = addressText.trim();
            let found: { name: string; address: string; lat: number; lng: number }[] = [];
            try {
                const { Place } = await window.google.maps.importLibrary('places') as google.maps.PlacesLibrary;
                const { places } = await Place.searchByText({
                    textQuery: query,
                    fields: ['displayName', 'formattedAddress', 'location'],
                    maxResultCount: 5,
                    region: 'us'
                });
                found = (places || []).filter((p) => p.location).map((p) => ({
                    name: p.displayName || '', address: p.formattedAddress || '', lat: p.location!.lat(), lng: p.location!.lng()
                }));
            } catch (placesError) {
                // Places isn't allowed on this key (or is down): a street address still works through the Geocoder.
                console.warn('[Optimize route] Places search failed, using the Geocoder:', placesError);
                try {
                    const { results } = await new window.google.maps.Geocoder().geocode({ address: query, componentRestrictions: { country: 'US' } });
                    found = results.slice(0, 5).map((r) => ({
                        name: '', address: r.formatted_address, lat: r.geometry.location.lat(), lng: r.geometry.location.lng()
                    }));
                } catch (geocodeError) {
                    const code = String((geocodeError as { code?: string }).code || '');
                    if (code === 'ZERO_RESULTS') found = [];
                    else throw new Error(`Google refused the address search (${code || (geocodeError as Error).message}). The Maps key needs Places API (New) or Geocoding API allowed.`);
                }
            }
            if (!found.length) setFindError('No match — try the street, city and state.');
            setMatches(found);
        } catch (e) { setFindError((e as Error).message || 'Could not look that up.'); } finally { setFinding(false); }
    };
    const choosePlace = (m: { name: string; address: string; lat: number; lng: number }) => {
        const label = labelText.trim() || m.name || m.address.split(',').slice(0, 2).join(',');
        const next = savePlace({ label, address: m.address, lat: m.lat, lng: m.lng });
        setPlaces(next);
        (adding === 'from' ? setFrom : setTo)(next[0].id);
        setAdding(null); setAddressText(''); setLabelText(''); setMatches([]);
    };

    const plan = useMemo(
        () => planDayRoute(stops, { origin: startPoint, end: endPoint, mode, fixedIds: [...fixed], startAt }),
        [stops, startPoint, endPoint, mode, fixed, startAt]
    );
    const saved = Math.max(0, Math.round((plan.milesBefore - plan.milesAfter) * 10) / 10);

    const toggle = (id: string) => setFixed((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    const write = async (changes: { id: string; patch: { startTime: string; endTime?: string } }[]) => {
        const undos: (() => void)[] = [];
        try {
            for (const c of changes) {
                undos.push(patchPlannerItem(c.id, c.patch));
                const res = await moveActivity(c.id, c.patch);
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.message || body.error || 'That did not save.');
                }
            }
            return null;
        } catch (e) {
            undos.reverse().forEach((u) => u());
            return (e as Error).message;
        } finally {
            refreshPlannerSchedule();
        }
    };

    const apply = async () => {
        const changes = plan.stops.filter((s) => s.changed).map((s) => ({ id: s.id, patch: s.patch }));
        if (!changes.length) { onClose(); return; }
        setSaving(true); setError('');
        const before = changes.map((c) => { const i = byId.get(c.id)!; return { id: c.id, startTime: i.startTime, ...(i.endTime ? { endTime: i.endTime } : {}) }; });
        const failed = await write(changes);
        setSaving(false);
        if (failed) { setError(`Nothing was changed — ${failed}`); return; }
        setApplied(before); onChanged?.();
    };

    const undo = async () => {
        if (!applied) return;
        setSaving(true); setError('');
        const failed = await write(applied.map((a) => ({ id: a.id, patch: { startTime: a.startTime, ...(a.endTime ? { endTime: a.endTime } : {}) } })));
        setSaving(false);
        if (failed) { setError(`Could not undo — ${failed}`); return; }
        onChanged?.(); onClose();
    };

    if (applied) {
        return (
            <FormModal title="Route updated" size="s" onClose={onClose} onSubmit={(e) => { e.preventDefault(); onClose(); }} submitLabel="Done" saving={saving}
                footerStart={<button type="button" className="btn-secondary" onClick={undo} disabled={saving}>Undo</button>}>
                <p className="opt-note">{dayTitle} is in the new order. Undo puts every stop back at its old time.</p>
                {error && <p className="opt-error" role="alert">{error}</p>}
            </FormModal>
        );
    }

    const startNote =
        state === 'locating' ? 'Finding where you are…'
        : state === 'gps' ? 'Starting from where you are now.'
        : state === 'last' ? 'Location is off — starting from where you were last time.'
        : 'Location is off — pick a branch to start from, or the first stop.';

    return (
        <FormModal
            title={`Optimize route · ${dayTitle}`}
            size="m"
            onClose={onClose}
            onSubmit={(e) => { e.preventDefault(); apply(); }}
            submitLabel={plan.unchanged ? 'Already the best order' : 'Apply this order'}
            savingLabel="Applying…"
            saving={saving}
            submitDisabled={plan.unchanged || (from === 'here' && state === 'locating')}
        >
            <div className="opt-modes" role="radiogroup" aria-label="How to order the day">
                <button type="button" role="radio" aria-checked={mode === 'all'} className={`opt-mode${mode === 'all' ? ' is-on' : ''}`} onClick={() => setMode('all')}>
                    <strong>Re-order everything</strong>
                    <span>Every stop moves to suit the drive.</span>
                </button>
                <button type="button" role="radio" aria-checked={mode === 'fixed'} className={`opt-mode${mode === 'fixed' ? ' is-on' : ''}`} onClick={() => setMode('fixed')}>
                    <strong>Keep fixed appointments</strong>
                    <span>Tick the stops that must keep their time.</span>
                </button>
            </div>

            <div className="opt-where">
                <FormField name="start" id="opt-start" label="Start time">
                    <FormPicker id="opt-start" value={startTime} onChange={setStartTime} options={TIMES} sheetTitle="Start time" keepInForm />
                </FormField>
                <FormField name="length" id="opt-length" label="Time at each stop">
                    <FormPicker id="opt-length" value={length} onChange={setLength} options={LENGTHS} sheetTitle="Time at each stop" keepInForm />
                </FormField>
                <FormField name="from" id="opt-from" label="Start from">
                    <FormPicker id="opt-from" value={from} onChange={pick('from')} options={fromOptions} sheetTitle="Start from" keepInForm />
                </FormField>
                <FormField name="to" id="opt-to" label="Finish at">
                    <FormPicker id="opt-to" value={to} onChange={pick('to')} options={toOptions} sheetTitle="Finish at" keepInForm />
                </FormField>
            </div>
            {adding && (
                <div className="opt-add">
                    <FormField name="addr" id="opt-addr" label={adding === 'from' ? 'Start address' : 'Finish address'}>
                        <input id="opt-addr" className="fm-input no-capitalize" value={addressText} onChange={(e) => setAddressText(e.target.value)}
                            placeholder="Street, city, state — or a hotel's name and city" autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (addressText.trim().length >= 4 && !finding && mapsReady) findAddress(); } }} />
                    </FormField>
                    <FormField name="lbl" id="opt-lbl" label="Name it (optional)">
                        <input id="opt-lbl" className="fm-input" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="Home, Hotel…" />
                    </FormField>
                    <div className="opt-add-actions">
                        <button type="button" className="btn-secondary" onClick={() => setAdding(null)}>Cancel</button>
                        <button type="button" className="btn-primary" onClick={findAddress} disabled={finding || !mapsReady || addressText.trim().length < 4}>{finding ? 'Finding…' : 'Find'}</button>
                    </div>
                    {mapsError && <p className="opt-error" role="alert">Google Maps failed to load: {mapsError.message}</p>}
                    {findError && <p className="opt-error" role="alert">{findError}</p>}
                    {matches.length > 0 && (
                        <ul className="opt-matches" role="listbox" aria-label="Matches">
                            {matches.map((m) => (
                                <li key={`${m.lat},${m.lng}`}>
                                    <button type="button" role="option" aria-selected="false" onClick={() => choosePlace(m)}>
                                        <strong>{m.name}</strong><span>{m.address}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            {from === 'here' && <p className="opt-note"><Navigation size={14} aria-hidden="true" /> {startNote}</p>}

            <ol className="opt-list">
                {plan.stops.map((s, i) => {
                    const item = byId.get(s.id)!;
                    const was = new Date(item.startTime);
                    return (
                        <li key={s.id} className={`opt-row${s.changed ? ' is-changed' : ''}`}>
                            <span className="opt-n">{i + 1}</span>
                            <div className="opt-main">
                                <div className="opt-name">{customerName(item)}</div>
                                <div className="opt-sub">
                                    {s.kept === 'no-point'
                                        ? <><MapPinOff size={12} aria-hidden="true" /> No map location — kept at its time</>
                                        : `${s.driveMinutes > 0 ? `${s.miles} mi · ${s.driveMinutes} min drive` : 'First stop'} · ${durationText(Math.round((s.end.getTime() - s.start.getTime()) / 60000))} there`}
                                </div>
                            </div>
                            <div className="opt-time">
                                <div>{timeLabel(s.start)}</div>
                                {s.start.getTime() !== was.getTime() && <div className="opt-was">was {timeLabel(was)}</div>}
                            </div>
                            {mode === 'fixed' && s.kept !== 'no-point' && (
                                <label className="opt-fixed" title="Keep this stop at its time">
                                    <input type="checkbox" checked={fixed.has(s.id)} onChange={() => toggle(s.id)} />
                                    <Lock size={12} aria-hidden="true" /> Fixed
                                </label>
                            )}
                        </li>
                    );
                })}
            </ol>

            <p className="opt-summary">
                {plan.milesBefore > 0
                    ? <>Driving: {plan.milesBefore} mi now → <strong>{plan.milesAfter} mi</strong>{saved > 0 && <> (saves {saved} mi)</>}. Straight-line distances; real roads run a little longer.</>
                    : 'Straight-line distances; real roads run a little longer.'}
            </p>
            {plan.finish && (
                <p className="opt-summary">Last stop to {places.find((p) => p.id === to)?.label || to}: {plan.finish.miles} mi · {plan.finish.driveMinutes} min — you're there by <strong>{timeLabel(plan.finish.arrive)}</strong>.</p>
            )}
            {error && <p className="opt-error" role="alert">{error}</p>}
        </FormModal>
    );
}
