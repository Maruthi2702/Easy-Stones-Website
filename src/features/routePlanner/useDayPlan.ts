import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { saveDraft, loadDraft, clearDraft } from '../../utils/sessionDraft';
import { orderStops, planDay, daySummary, hasPoint, milesBetween, pointInPolygon, DEFAULT_DAY } from '../../utils/routePlan';
import { todayKey, visitRecency } from './helpers';
import type { DayStop, DaySummary, DrawMode, LatLng, MapPin as Customer, Pin, Preselect, SelectionShape } from './types';

/** The Tools panel's day, saved for the session when a sign-in expires mid-edit. */
type DayDraft = { date: string; startAt: string; stopMinutes: string | number; origin: LatLng | null; replaceExisting: boolean };

export type DayPlanDeps = {
    pins: Pin[];
    /** What the filters show — a draw only picks up what's on the map. */
    visible: Customer[];
    /** Where the day starts from (useMyLocation). */
    origin: LatLng | null;
    setOrigin: Dispatch<SetStateAction<LatLng | null>>;
    setDrawMode: Dispatch<SetStateAction<DrawMode>>;
    setShowToolsPanel: Dispatch<SetStateAction<boolean>>;
    preselect: Preselect;
};

/**
 * The day being planned in the Tools panel: its date, start and minutes per
 * stop, the selection it's built from (a Radius or Lasso draw, "Plan route"
 * from the Customers list, or rows removed one by one), and the stops in
 * driving order with their times (src/utils/routePlan.js).
 */
export function useDayPlan({ pins, visible, origin, setOrigin, setDrawMode, setShowToolsPanel, preselect }: DayPlanDeps) {
    // Either kind of draw replaces selectedIds outright (see
    // handleRadiusSelect/handleLassoSelect below) rather than adding to it;
    // it otherwise persists — across filter changes, and against manual
    // add/remove via Selected Points — until the rep clears it or acts on
    // it via Mass Update or Create Route.
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

    const [date, setDate] = useState(todayKey());
    const [startAt, setStartAt] = useState('09:00');
    const [stopMinutes, setStopMinutes] = useState<string | number>(DEFAULT_DAY.stopMinutes);
    const [replaceExisting, setReplaceExisting] = useState(false);

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    const orderById = useMemo(() => {
        const map = new Map<string, number>();
        day.forEach(stop => map.set(stop._id, stop.order));
        return map;
    }, [day]);

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
    }, [visible, setDrawMode]);

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
    }, [visible, setDrawMode]);

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

    return {
        date, setDate, startAt, setStartAt, stopMinutes, setStopMinutes, replaceExisting, setReplaceExisting,
        selectionShape, selectedPins, unselectedPins, day, summary, orderById,
        handleRadiusSelect, handleLassoSelect, removeSelectedPoint, reorderStop, clearSelection
    };
}
