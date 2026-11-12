import { useEffect, useMemo, useState } from 'react';
import { Navigation, Lock, MapPinOff } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { planDayRoute, type DayStop, type LatLng, type RouteMode } from '../../../utils/routeDay';
import { DEFAULT_VISIT_MINUTES } from '../../../utils/scheduleRecord';
import { forgetLocationOk, readLastPosition, rememberPosition } from '../../../utils/geolocationAccess';
import { moveActivity } from '../salesPlannerApi';
import { patchPlannerItem, refreshPlannerSchedule, type PlannerItem } from '../plannerSchedule';
import { customerName, customerOf, timeLabel } from '../salesPlanner';
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
    const stops = useMemo(() => items.map(toStop), [items]);
    const plan = useMemo(
        () => planDayRoute(stops, { origin, mode, fixedIds: [...fixed] }),
        [stops, origin, mode, fixed]
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
        : 'Location is off — starting from the stop that fits the day best.';

    return (
        <FormModal
            title={`Optimize route · ${dayTitle}`}
            size="m"
            onClose={onClose}
            onSubmit={(e) => { e.preventDefault(); apply(); }}
            submitLabel={plan.unchanged ? 'Already the best order' : 'Apply this order'}
            savingLabel="Applying…"
            saving={saving}
            submitDisabled={plan.unchanged || state === 'locating'}
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

            <p className="opt-note"><Navigation size={14} aria-hidden="true" /> {startNote}</p>

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
                                        : s.driveMinutes > 0 ? `${s.miles} mi · ${s.driveMinutes} min drive` : 'First stop'}
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
            {error && <p className="opt-error" role="alert">{error}</p>}
        </FormModal>
    );
}
