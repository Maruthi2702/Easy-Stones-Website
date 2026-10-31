import { useState, useEffect, useCallback, useRef } from 'react';
import { patchPlannerItem, refreshPlannerSchedule } from './plannerSchedule';
import type { PlannerItem } from './plannerSchedule';
import { moveActivity } from './salesPlannerApi';
import {
    addDays, dayKey, dayFromKey, planMove, gapsFor, describeAim, customerName, timeLabel,
    type Drag
} from './salesPlanner';
import type { SalesPlannerData } from './useSalesPlannerData';
import type { EdgeFlip } from './useEdgeFlip';

/* ── moving a stop ──────────────────────────────────────────────────────
 *
 * Three ways in, one meaning. A mouse uses the browser's own drag; a finger
 * gets a long press, because native drag never fires from touch and half
 * the people using this are holding a tablet in a yard; the keyboard gets
 * Space to pick up and the arrow keys to aim, because a drag has no
 * keyboard equivalent and "open the form instead" is not one.
 *
 * All three land in `moveTo`, given a stop, a day, and optionally which gap
 * between that day's stops it was aimed at. Aim at a gap and the time moves
 * to fit it; drop on the open end of a column and the stop keeps the time
 * it had, because there the gesture was about the day and nothing else.
 */

const LONG_PRESS_MS = 350;
const TOUCH_SLOP = 10;

/** A long press in progress (see handlePointerDown). */
type TouchPress = {
    pointerId: number; item: PlannerItem; x: number; y: number; active: boolean;
    onMove: (ev: PointerEvent) => void; onEnd: (ev: PointerEvent) => void; onCancel: () => void;
    timer: ReturnType<typeof setTimeout>;
};

/**
 * Which gap between a day's cards a point falls in, or null for "no gap in
 * particular". Read off the rendered boxes rather than computed, because the
 * cards are different heights — a stop with a note is taller than one without.
 */
const slotAtPoint = (dayEl: Element, y: number): number | null => {
    const cards = dayEl.querySelectorAll('[data-planner-card]');
    if (cards.length === 0) return null;

    for (let i = 0; i < cards.length; i++) {
        const r = cards[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) return i;
    }

    // Just under the last card is still a gap. Further down is the open end of
    // the column, where the gesture is "move this to Wednesday" and the answer
    // is the time it already had — which is what a null says.
    const last = cards[cards.length - 1].getBoundingClientRect();
    return y < last.bottom + last.height ? cards.length : null;
};

type MoveInputs = Pick<SalesPlannerData, 'itemsFor' | 'range' | 'setCurrentDate' | 'scheduleItems'> & {
    edge: Pick<EdgeFlip, 'startEdge' | 'stopEdge' | 'edgeAssist'>;
    onScheduleChange?: () => void;
    /**
     * False while the planner shows anyone's calendar but yours alone (the
     * team calendar): a move is placed among the day's other stops, and
     * there they'd be other people's. Cards and days then take no drag.
     */
    enabled?: boolean;
};

/**
 * Moving a stop by mouse, finger or keyboard: the move in the air, where it is
 * aimed, the save (drawn at once, put back if the server refuses), and the
 * props that make cards draggable and days drop targets.
 */
export default function useMoveStop({ itemsFor, range, setCurrentDate, scheduleItems, edge, onScheduleChange, enabled = true }: MoveInputs) {
    const { startEdge, stopEdge, edgeAssist } = edge;
    // One drag, whichever input started it: a mouse, a finger, or the keyboard.
    // { item, source: 'mouse'|'touch'|'keyboard', dayKey, index }
    const [drag, setDrag] = useState<Drag | null>(null);
    const [moveError, setMoveError] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState('');

    const ghostRef = useRef<HTMLDivElement>(null);
    const touch = useRef<TouchPress | null>(null);
    const suppressClick = useRef(false);
    const refocus = useRef<string | null>(null);

    /**
     * What the timers and the window-level pointer handlers read instead of the
     * render they were created in. They outlive it: a week can flip in the
     * middle of a drag, which unmounts the card the drag started on.
     */
    const latest = useRef({} as { drag: Drag | null; itemsFor: (day: Date) => PlannerItem[] });
    latest.current = { drag, itemsFor };

    const announce = useCallback((message: string) => setAnnouncement(message), []);

    /* ── the move itself ── */

    /**
     * Move a stop to `day`, optionally into gap `gap` — counted against the day
     * as it is drawn, so it includes the card being moved.
     */
    const moveTo = useCallback(async (item: PlannerItem | null, day: Date, gap: number | null = null) => {
        if (!item) return;

        const plan = planMove(item, day, latest.current.itemsFor(day), gap);
        if (!plan) return;
        const { nextStart, patch } = plan;
        const from = new Date(item.startTime);

        setMoveError(null);
        const undo = patchPlannerItem(item._id, patch);
        announce(`${customerName(item)} moved to ${nextStart.toLocaleDateString('en-US', { weekday: 'long' })}, ${timeLabel(nextStart)}.`);

        try {
            const response = await moveActivity(item._id, patch);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || errorData.error || 'That move did not save.');
            }

            refreshPlannerSchedule();
            if (onScheduleChange) onScheduleChange();
        } catch (error) {
            console.error('[Planner] Move failed:', error);
            // Put it back for the eye straight away, then ask the server what
            // the day actually is — a rejected write is exactly the case where
            // our copy is the one that cannot be trusted. A refresh that fails
            // too leaves the restored card standing, which is the right answer.
            undo();
            refreshPlannerSchedule();
            const stayed = `${customerName(item)} stayed on ${from.toLocaleDateString('en-US', { weekday: 'long' })} — ${(error as Error).message}`;
            setMoveError(stayed);
            announce(stayed);
        }
    }, [announce, onScheduleChange]);

    /** Where the drag points, as far as anything drawing is concerned. */
    const setTarget = useCallback((key: string | null, gap: number | null) => {
        setDrag(d => (!d || (d.dayKey === key && d.index === gap) ? d : { ...d, dayKey: key, index: gap }));
    }, []);

    const endDrag = useCallback(() => {
        setDrag(null);
        stopEdge();
    }, [stopEdge]);

    /* ── mouse: the browser's own drag ── */

    const handleDragStart = (item: PlannerItem) => (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = 'move';
        // Firefox will not start a drag with an empty transfer.
        try {
            e.dataTransfer.setData('text/plain', item._id);
        } catch {
            // Some browsers lock the transfer down; the item in state still works.
        }
        setDrag({ item, source: 'mouse', dayKey: null, index: null });
    };

    /**
     * What makes one day a drop target.
     *
     * The handlers are always attached and decide inside, rather than being
     * added once a drag is known about: dragstart and the first dragover can
     * arrive in the same frame, and a day that is not listening yet at that
     * point spends the first stretch of the drag showing a "no entry" cursor.
     *
     * Deciding inside is also what keeps preventDefault off any drag this
     * calendar cannot take — a file dragged onto the window is not something a
     * column should be swallowing.
     */
    const dayDropProps = (day: Date, { ordered = true }: { ordered?: boolean } = {}) => {
        const key = dayKey(day);
        const mine = () => drag && drag.source === 'mouse';

        return {
            'data-planner-day': key,
            'data-planner-ordered': String(ordered),
            onDragOver: (e: React.DragEvent<HTMLElement>) => {
                if (!mine()) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setTarget(key, ordered ? slotAtPoint(e.currentTarget, e.clientY) : null);
            },
            onDragLeave: (e: React.DragEvent<HTMLElement>) => {
                // Crossing onto a card inside the day is still being over the day.
                if (!mine() || e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setDrag(d => (d && d.dayKey === key ? { ...d, dayKey: null, index: null } : d));
            },
            onDrop: (e: React.DragEvent<HTMLElement>) => {
                if (!mine()) return;
                e.preventDefault();
                const gap = ordered ? slotAtPoint(e.currentTarget, e.clientY) : null;
                const item = drag!.item;
                endDrag();
                moveTo(item, day, gap);
            }
        };
    };

    /* ── touch: a long press, because native drag never fires from a finger ── */

    const positionGhost = (x: number, y: number) => {
        const el = ghostRef.current;
        if (el) el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };

    const releaseTouch = useCallback(() => {
        const t = touch.current;
        if (!t) return;
        clearTimeout(t.timer);
        window.removeEventListener('pointermove', t.onMove);
        window.removeEventListener('pointerup', t.onEnd);
        window.removeEventListener('pointercancel', t.onCancel);
        touch.current = null;
    }, []);

    const handlePointerDown = (item: PlannerItem) => (e: React.PointerEvent) => {
        // A mouse already has a drag of its own, and a second one fighting it
        // would only take the drag image away.
        if (e.pointerType === 'mouse' || touch.current) return;
        suppressClick.current = false;

        const onMove = (ev: PointerEvent) => {
            const t = touch.current;
            if (!t || t.pointerId !== ev.pointerId) return;

            if (!t.active) {
                // Still deciding. A finger that has travelled this far is
                // scrolling the page, not picking a card up.
                if (Math.abs(ev.clientX - t.x) > TOUCH_SLOP || Math.abs(ev.clientY - t.y) > TOUCH_SLOP) {
                    releaseTouch();
                }
                return;
            }

            t.x = ev.clientX;
            t.y = ev.clientY;
            positionGhost(ev.clientX, ev.clientY);
            edgeAssist(ev.clientX);

            // There is no dragover to say what is underneath, so ask the
            // document. The ghost takes no pointer events, or it would be the
            // only thing this ever found.
            const dayEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-planner-day]');
            if (!dayEl) {
                setTarget(null, null);
                return;
            }
            setTarget(
                dayEl.dataset.plannerDay as string,
                dayEl.dataset.plannerOrdered === 'true' ? slotAtPoint(dayEl, ev.clientY) : null
            );
        };

        const onEnd = (ev: PointerEvent) => {
            const t = touch.current;
            if (!t || t.pointerId !== ev.pointerId) return;
            const wasDragging = t.active;
            const aim = latest.current.drag;
            releaseTouch();
            if (!wasDragging) return;
            endDrag();
            if (aim && aim.dayKey) moveTo(aim.item, dayFromKey(aim.dayKey), aim.index);
        };

        const onCancel = () => {
            releaseTouch();
            endDrag();
        };

        touch.current = {
            pointerId: e.pointerId,
            item,
            x: e.clientX,
            y: e.clientY,
            active: false,
            onMove,
            onEnd,
            onCancel,
            timer: setTimeout(() => {
                const t = touch.current;
                if (!t) return;
                t.active = true;
                // The press has already outlived a tap, and letting the click
                // through on release would open a customer nobody asked for.
                suppressClick.current = true;
                setDrag({ item: t.item, source: 'touch', dayKey: dayKey(new Date(t.item.startTime)), index: null });
                positionGhost(t.x, t.y);
            }, LONG_PRESS_MS)
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onCancel);
    };

    useEffect(() => releaseTouch, [releaseTouch]);

    /**
     * Scrolling stays available until the press has been held: `touch-action`
     * cannot be turned off at the moment we find out this is a drag, so the
     * page is blocked here instead, once, for as long as a drag is running.
     */
    useEffect(() => {
        if (drag?.source !== 'touch') return undefined;
        const block = (ev: Event) => ev.preventDefault();
        window.addEventListener('touchmove', block, { passive: false });
        return () => window.removeEventListener('touchmove', block);
    }, [drag?.source]);

    // The ghost mounts a frame after the press lands, so it has to be told
    // where the finger was, or it flashes in the top-left corner first.
    useEffect(() => {
        if (drag?.source === 'touch' && touch.current) positionGhost(touch.current.x, touch.current.y);
    }, [drag?.source]);

    /* ── keyboard: pick up, aim, drop ── */

    const aimAt = useCallback((item: PlannerItem, day: Date, gap: number | null) => {
        // Aiming past the edge of the week brings that week into view rather
        // than refusing the key — the same thing a drag does at the edge.
        if (day < range.start || day > range.end) setCurrentDate(new Date(day));
        setDrag({ item, source: 'keyboard', dayKey: dayKey(day), index: gap });
    }, [range.start, range.end, setCurrentDate]);

    const grabWithKeyboard = (item: PlannerItem) => (e: React.KeyboardEvent) => {
        // The buttons inside the card keep their own keys, and a card that is
        // already in hand is steered from the document instead — a week flip
        // unmounts this element, and with it anything listening here.
        if (e.target !== e.currentTarget) return;
        if (e.key !== ' ' && e.key !== 'Enter') return;
        if (drag) return;

        e.preventDefault();
        aimAt(item, new Date(item.startTime), null);
        announce(`${customerName(item)} picked up. Left and right for the day, up and down for the time, Enter to drop, Escape to cancel.`);
    };

    /**
     * A card in hand is steered from the document, not from the card. Arrowing
     * off the edge of the week flips it, and that unmounts the element the
     * keydown started on — a listener living there would go with it, one key
     * into the move.
     *
     * Deliberately re-attached on every render rather than pinned to a
     * dependency list: the handler reads what the day currently holds, and a
     * list that froze that would announce times from the week before last.
     */
    useEffect(() => {
        if (drag?.source !== 'keyboard') return undefined;

        const onKey = (e: KeyboardEvent) => {
            const aim = latest.current.drag;
            if (!aim) return;
            const day = dayFromKey(aim.dayKey as string);

            if (e.key === 'Escape') {
                e.preventDefault();
                refocus.current = aim.item._id;
                endDrag();
                announce(`${customerName(aim.item)} left where it was.`);
                return;
            }

            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                refocus.current = aim.item._id;
                endDrag();
                moveTo(aim.item, day, aim.index);
                return;
            }

            const dayStep = ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[e.key];
            if (dayStep) {
                e.preventDefault();
                // A new day is a new set of gaps and none of them has been asked
                // for yet, so back to "keep the time" until up or down says
                // otherwise.
                const next = addDays(day, dayStep);
                aimAt(aim.item, next, null);
                announce(describeAim(aim.item, next, itemsFor(next), null));
                return;
            }

            const gapStep = ({ ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[e.key];
            if (!gapStep) return;
            e.preventDefault();
            const gaps = gapsFor(itemsFor(day).length);
            const at = gaps.indexOf(aim.index);
            const next = gaps[Math.min(gaps.length - 1, Math.max(0, (at === -1 ? 0 : at) + gapStep))];
            aimAt(aim.item, day, next);
            announce(describeAim(aim.item, day, itemsFor(day), next));
        };

        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    });

    /**
     * A keyboard move ends with the card somewhere else on screen and the focus
     * nowhere, because the element it was on has been unmounted and redrawn in
     * another column. Put it back on the card that moved.
     */
    useEffect(() => {
        const id = refocus.current;
        if (!id || drag) return;
        const el = document.querySelector<HTMLElement>(`[data-planner-card="${id}"]`);
        if (!el) return;
        refocus.current = null;
        el.focus();
    }, [drag, scheduleItems]);

    /* ── what the calendar draws while a move is in the air ── */

    const dropClass = (day: Date) => (drag && drag.dayKey === dayKey(day) ? ' is-drop' : '');

    /**
     * Whether to draw the insertion line in gap `gap` of `day`. Never in either
     * of the two gaps beside the card being moved: both of those mean "stay
     * put", and a line promising a move that will not happen is worse than no
     * line at all.
     */
    const showSlot = (day: Date, gap: number) => {
        if (!drag || drag.index !== gap || drag.dayKey !== dayKey(day)) return false;
        const self = itemsFor(day).findIndex(i => i._id === drag.item._id);
        return self === -1 || (gap !== self && gap !== self + 1);
    };

    // With moving off (`enabled`) a card is plain: no drag, no keyboard grab,
    // so no day ever becomes a drop target either.
    const dragProps = (item: PlannerItem) => (!enabled ? {} : {
        draggable: true,
        onDragStart: handleDragStart(item),
        onDragEnd: endDrag,
        onPointerDown: handlePointerDown(item),
        onKeyDown: grabWithKeyboard(item),
        onClickCapture: (e: React.MouseEvent) => {
            if (!suppressClick.current) return;
            suppressClick.current = false;
            e.preventDefault();
            e.stopPropagation();
        },
        tabIndex: 0,
        'data-planner-card': item._id
    });

    /** Hovering the week arrows with a card in hand turns the page. */
    const navHoverProps = (dir: number) => ({
        onDragOver: (e: React.DragEvent) => {
            if (!drag || drag.source !== 'mouse') return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            startEdge(dir, { scroll: false });
        },
        onDragLeave: stopEdge
    });

    /** The scroll box's dragover: a mouse drag near its sides scrolls or flips. */
    const onScrollDragOver = (e: React.DragEvent) => { if (drag && drag.source === 'mouse') edgeAssist(e.clientX); };

    const itemState = (item: PlannerItem) => {
        if (!drag || drag.item._id !== item._id) return '';
        return drag.source === 'keyboard' ? ' is-grabbed' : ' is-dragging';
    };

    return {
        drag, moveError, clearMoveError: () => setMoveError(null), announcement, ghostRef,
        dayDropProps, dropClass, showSlot, dragProps, navHoverProps, onScrollDragOver, itemState
    };
}

export type StopMove = ReturnType<typeof useMoveStop>;
