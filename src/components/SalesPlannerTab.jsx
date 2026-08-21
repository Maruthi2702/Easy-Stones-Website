import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    ChevronLeft, ChevronRight, Calendar as CalendarIcon,
    Plus, Trash2, Edit2, AlertCircle, X, Check, AlertTriangle
} from 'lucide-react';
import { API_URL } from '../config/api';
import { authFetch } from '../api/authFetch';
import SearchableSelect from './SearchableSelect';
import {
    getCachedPlannerRange,
    loadPlannerRange,
    subscribePlannerSchedule,
    refreshPlannerSchedule,
    patchPlannerItem,
    setPlannerUser,
    plannerRangeKey
} from '../api/plannerSchedule';

import GoogleStyleDateTimePicker from './GoogleStyleDateTimePicker';

/**
 * The sales planner.
 *
 * The working week is Monday to Friday and those five days get the full width —
 * squeezing in two days nobody books was costing the readability of the five
 * that are. But a weekend booking is still real: it comes in from the calendar
 * sync, or somebody agrees to a Saturday walkthrough. So Saturday and Sunday sit
 * in a slim rail beside the week rather than being dropped, which is what the
 * old Mon-Fri loop did — silently, with no way to tell from the screen that
 * anything was missing.
 *
 * Every day carries its own + button. Booking Wednesday should not mean opening
 * a form and re-picking a date the calendar already knew. The same goes for
 * moving one: a stop can be dragged onto another day, which is the same edit
 * with the calendar as the input rather than a date field inside a modal.
 *
 * The schedule itself is not held here — it lives in ../api/plannerSchedule,
 * because the dashboard unmounts this component every time another tab is
 * shown. See that module for what survives the unmount and how a change made
 * elsewhere finds its way onto this screen.
 */

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' in local time — the key a day is stored and looked up under. */
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Schedules are stored as a local ISO string with no zone suffix, and are read
 * back the same way. Anything that builds a startTime has to match that or the
 * item lands on the wrong day for anyone east of UTC.
 */
const localISO = (d) =>
    `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000`;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Monday of whatever week `d` falls in. Sunday belongs to the week just ending. */
const mondayOf = (d) => {
    const x = startOfDay(d);
    const g = x.getDay();
    return addDays(x, g === 0 ? -6 : 1 - g);
};

const isSameDay = (a, b) => dayKey(a) === dayKey(b);

/**
 * Whole days between two dates. Rounded rather than truncated because the days
 * a clock goes forward and back are 23 and 25 hours long, and a drag across
 * either of those edges must still count as one day.
 */
const dayOffset = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / 86400000);

const MINUTES_IN_DAY = 24 * 60;

/** Minutes past midnight — all the ordering inside a day depends on. */
const minutesOf = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.getHours() * 60 + d.getMinutes();
};

/** `day` at `minutes` past midnight. setMinutes rolls the hour over itself. */
const atMinutes = (day, minutes) => {
    const d = startOfDay(day);
    d.setMinutes(minutes);
    return d;
};

/**
 * The time a stop takes when it is dropped into slot `index` of `neighbours` —
 * the day's other stops, in order, never including the one being moved.
 *
 * Between two stops it takes the middle of the gap: dropped between a 9am and
 * an 11am it becomes 10am, which is the only reading of "put it here" that a
 * time-ordered list can honour. The middle is rounded to five minutes when the
 * gap is wide enough that rounding cannot land it back on a neighbour — inside
 * a tight gap the exact minute is kept, because a tidy time that shuffles the
 * card back where it came from is worse than an untidy one that does not.
 *
 * At the top it is half an hour before the first stop, at the bottom half an
 * hour after the last. A null index — an empty day, the open end of a column,
 * a month cell with no order to read — means the stop keeps the time it has.
 */
const slotMinutes = (neighbours, index) => {
    if (index === null || neighbours.length === 0) return null;

    const before = index > 0 ? minutesOf(neighbours[index - 1].startTime) : null;
    const after = index < neighbours.length ? minutesOf(neighbours[index].startTime) : null;

    if (before === null && after === null) return null;
    if (before === null) return Math.max(0, after - 30);
    if (after === null) return Math.min(MINUTES_IN_DAY - 1, before + 30);

    const middle = (before + after) / 2;
    const tidy = Math.round(middle / 5) * 5;
    return tidy > before && tidy < after ? tidy : Math.floor(middle);
};

/**
 * Which gap between a day's cards a point falls in, or null for "no gap in
 * particular". Read off the rendered boxes rather than computed, because the
 * cards are different heights — a stop with a note is taller than one without.
 */
const slotAtPoint = (dayEl, y) => {
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

/** The day a 'YYYY-MM-DD' key names, back as a local Date. */
const dayFromKey = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const ACTIVITY_COLORS = {
    'Visit': '#4ade80',
    'Call': '#3b82f6',
    'Drop-off': '#facc15',
    'Other': '#94a3b8'
};

const activityModifier = (type) => {
    switch (type) {
        case 'Call': return 'call';
        case 'Drop-off': return 'dropoff';
        case 'Other': return 'other';
        default: return 'visit';
    }
};

const activityColor = (type) => ACTIVITY_COLORS[type] || ACTIVITY_COLORS.Other;

const timeLabel = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const customerName = (item) =>
    item.customerId?.company || item.customerId?.contactName || 'Unknown';

/**
 * A new activity opens on the day you clicked. On today that means the next
 * five-minute mark, so the picker doesn't hand you a time that has already been
 * and gone; on any other day, 9am — early enough to be worth dragging later.
 */
const defaultStartFor = (day) => {
    const now = new Date();
    const d = day ? new Date(day) : new Date();
    if (isSameDay(d, now)) {
        // setMinutes rolls the hour over on its own when this reaches 60.
        d.setHours(now.getHours(), Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
    } else {
        d.setHours(9, 0, 0, 0);
    }
    return localISO(d);
};

const EMPTY_FORM = { customerId: '', startTime: '', activityType: 'Visit', notes: '' };

/**
 * The span to fetch, which is not the same as the span to draw: week view
 * renders five columns but pulls all seven days, because the weekend rail can
 * only show what was asked for.
 */
const rangeFor = (date, mode) => {
    if (mode === 'day') {
        const s = startOfDay(date);
        return { start: s, end: s };
    }
    if (mode === 'week') {
        const s = mondayOf(date);
        return { start: s, end: addDays(s, 6) };
    }
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return {
        start: addDays(startOfDay(first), -first.getDay()),
        end: addDays(startOfDay(last), 6 - last.getDay())
    };
};

/**
 * Which week you were looking at is part of what you had open. Switching to the
 * Visits tab and back used to snap the planner to today's week in whatever view
 * it defaults to, throwing away a deliberate navigation; this remembers it for
 * as long as the page is loaded.
 */
const lastView = { date: null, mode: 'week' };

const cachedItemsForLastView = () => {
    const date = lastView.date ? new Date(lastView.date) : new Date();
    const r = rangeFor(date, lastView.mode);
    return getCachedPlannerRange(dayKey(r.start), dayKey(r.end));
};

const SalesPlannerTab = ({ customerSelection = [], customerOptions = [], onSelectCustomer, onScheduleChange, isDropdownLoading, currentUserId = null }) => {
    const [currentDate, setCurrentDate] = useState(() => (lastView.date ? new Date(lastView.date) : new Date()));
    const [viewMode, setViewMode] = useState(lastView.mode);
    // Anything already fetched this session paints in the first frame — a tab
    // switch should not cost a round trip before the week reappears.
    const [scheduleItems, setScheduleItems] = useState(() => cachedItemsForLastView() || []);
    const [loading, setLoading] = useState(() => cachedItemsForLastView() === null);
    const [loadError, setLoadError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [addingForDay, setAddingForDay] = useState(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [itemToDelete, setItemToDelete] = useState(null);
    // One drag, whichever input started it: a mouse, a finger, or the keyboard.
    // { item, source: 'mouse'|'touch'|'keyboard', dayKey, index }
    const [drag, setDrag] = useState(null);
    const [edgeDir, setEdgeDir] = useState(0);
    const [moveError, setMoveError] = useState(null);
    const [announcement, setAnnouncement] = useState('');

    const [form, setForm] = useState(EMPTY_FORM);

    const today = useMemo(() => startOfDay(new Date()), []);

    const range = useMemo(() => rangeFor(currentDate, viewMode), [currentDate, viewMode]);

    const rangeStartKey = dayKey(range.start);
    const rangeEndKey = dayKey(range.end);

    useEffect(() => {
        lastView.date = currentDate.getTime();
        lastView.mode = viewMode;
    }, [currentDate, viewMode]);

    // The broadcast reaches every connected client, so the cache needs to know
    // whose schedule this is before it can tell our updates from anyone else's.
    useEffect(() => {
        setPlannerUser(currentUserId);
    }, [currentUserId]);

    /**
     * Load the visible range. What is already cached goes up immediately and the
     * fetch runs behind it, so navigating back to a week you have seen is a
     * repaint rather than a reload. Clicking through months faster than the
     * network answers is safe: each run ignores its own response once the range
     * has moved on, and the cache keys every week separately.
     */
    useEffect(() => {
        let alive = true;
        const cached = getCachedPlannerRange(rangeStartKey, rangeEndKey);

        if (cached) {
            setScheduleItems(cached);
            setLoadError(null);
            setLoading(false);
        } else {
            setLoading(true);
            setLoadError(null);
        }

        loadPlannerRange(rangeStartKey, rangeEndKey)
            .then(items => {
                if (!alive) return;
                setScheduleItems(items);
                setLoadError(null);
            })
            .catch(err => {
                if (!alive) return;
                console.error('Error fetching schedule:', err);
                // A failed refresh must not blank out a week that is already on
                // screen — the banner is for having nothing to show.
                if (!cached) setLoadError(err.message || 'Could not load the schedule.');
            })
            .finally(() => {
                if (!alive) return;
                setLoading(false);
            });

        return () => { alive = false; };
    }, [rangeStartKey, rangeEndKey, refreshKey]);

    /**
     * Someone else's edit — the same user on a phone, a second browser, a
     * calendar sync — arrives here without anyone pressing anything.
     */
    useEffect(() => {
        const key = plannerRangeKey(rangeStartKey, rangeEndKey);
        return subscribePlannerSchedule((updatedKey, items) => {
            if (updatedKey !== key) return;
            setScheduleItems(items);
            setLoadError(null);
            setLoading(false);
        });
    }, [rangeStartKey, rangeEndKey]);

    const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

    /** One pass over the response instead of a filter per day per render. */
    const itemsByDay = useMemo(() => {
        const map = new Map();
        for (const item of scheduleItems || []) {
            const d = new Date(item.startTime);
            if (Number.isNaN(d.getTime())) continue;
            const key = dayKey(d);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(item);
        }
        for (const list of map.values()) {
            list.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
        }
        return map;
    }, [scheduleItems]);

    const itemsFor = useCallback((day) => itemsByDay.get(dayKey(day)) || [], [itemsByDay]);

    const weekdays = useMemo(() => {
        const s = mondayOf(currentDate);
        return [0, 1, 2, 3, 4].map(i => addDays(s, i));
    }, [currentDate]);

    const weekendDays = useMemo(() => {
        const s = mondayOf(currentDate);
        return [addDays(s, 5), addDays(s, 6)];
    }, [currentDate]);

    const monthWeeks = useMemo(() => {
        if (viewMode !== 'month') return [];
        const weeks = [];
        let cursor = new Date(range.start);
        while (cursor <= range.end) {
            weeks.push([0, 1, 2, 3, 4, 5, 6].map(i => addDays(cursor, i)));
            cursor = addDays(cursor, 7);
        }
        return weeks;
    }, [viewMode, range.start, range.end]);

    /**
     * Only meaningful when today is actually inside the span that was fetched —
     * a count of "0 today" while looking at next March would be a lie.
     */
    const todayCount = useMemo(() => {
        if (today < range.start || today > range.end) return null;
        return itemsFor(today).length;
    }, [today, range.start, range.end, itemsFor]);

    /**
     * One period forward or back. Written against the previous date rather than
     * the one in scope because the edge-of-screen flip calls this from inside a
     * timer, where the date this render closed over is already history.
     */
    const stepPeriod = useCallback((dir) => {
        setCurrentDate(prev => {
            const d = new Date(prev);
            if (viewMode === 'day') d.setDate(d.getDate() + dir);
            else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
            else d.setMonth(d.getMonth() + dir);
            return d;
        });
    }, [viewMode]);

    const handlePrev = () => stepPeriod(-1);
    const handleNext = () => stepPeriod(1);

    const handleToday = () => setCurrentDate(new Date());

    const openAdd = (day) => {
        setEditingItem(null);
        setAddingForDay(day ? new Date(day) : new Date());
        setSaveError(null);
        setForm({ ...EMPTY_FORM, startTime: defaultStartFor(day) });
        setShowAddModal(true);
    };

    const openEdit = (item) => {
        setEditingItem(item);
        setAddingForDay(null);
        setSaveError(null);
        setForm({
            customerId: item.customerId?._id || item.customerId || '',
            startTime: item.startTime,
            activityType: item.activityType || 'Visit',
            notes: item.notes || ''
        });
        setShowAddModal(true);
    };

    const closeModal = () => {
        setShowAddModal(false);
        setEditingItem(null);
        setAddingForDay(null);
        setSaveError(null);
    };

    useEffect(() => {
        if (!showAddModal && !showDeleteModal) return undefined;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (showDeleteModal) setShowDeleteModal(false);
            else closeModal();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [showAddModal, showDeleteModal]);

    const handleSave = async (e) => {
        if (e) e.preventDefault();

        if (!form.customerId || !form.startTime) {
            setSaveError('Pick a customer and a start time.');
            return;
        }

        try {
            setSaving(true);
            setSaveError(null);
            const method = editingItem ? 'PUT' : 'POST';
            const url = editingItem
                ? `${API_URL}/api/schedule/${editingItem._id}`
                : `${API_URL}/api/schedule`;

            const response = await authFetch(url, {
                method,
                body: JSON.stringify(form)
            });

            if (response.ok) {
                // The server has already broadcast this write, but our own copy
                // should not wait on the round trip back to hear about it.
                refreshPlannerSchedule();
                if (onScheduleChange) onScheduleChange();
                closeModal();
                setForm(EMPTY_FORM);
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.error('[Planner] Save failed:', errorData);
                setSaveError(errorData.message || errorData.error || 'That did not save. Try again.');
            }
        } catch (error) {
            console.error('[Planner] Save error:', error);
            setSaveError(`Network error: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (id) => {
        setItemToDelete(id);
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            const response = await authFetch(`${API_URL}/api/schedule/${itemToDelete}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                refreshPlannerSchedule();
                if (onScheduleChange) onScheduleChange();
                setShowDeleteModal(false);
                setItemToDelete(null);
            }
        } catch (error) {
            console.error('Error deleting schedule:', error);
        }
    };

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
    const EDGE_ZONE = 64;
    const EDGE_TICK_MS = 60;
    const EDGE_FLIP_MS = 780;

    const scrollRef = useRef(null);
    const ghostRef = useRef(null);
    const touch = useRef(null);
    const edge = useRef({ dir: 0, timer: null, held: 0 });
    const suppressClick = useRef(false);
    const refocus = useRef(null);

    /**
     * What the timers and the window-level pointer handlers read instead of the
     * render they were created in. They outlive it: a week can flip in the
     * middle of a drag, which unmounts the card the drag started on.
     */
    const latest = useRef({});
    latest.current = { drag, itemsFor, stepPeriod };

    const announce = useCallback((message) => setAnnouncement(message), []);

    /* ── the edge of the screen ── */

    /**
     * Held against the side, the calendar moves under the card. Without this,
     * putting a stop into next week is two separate moves, and the second one
     * is a different gesture from the first.
     *
     * Scrolling comes first — on a narrow window the five columns are already
     * wider than the screen — and only once there is nothing left to scroll in
     * that direction does the dwell start counting towards a week flip.
     */
    const stopEdge = useCallback(() => {
        // Called from every dragover that is not near an edge, which is most of
        // them.
        if (!edge.current.dir && !edge.current.timer) return;
        if (edge.current.timer) clearInterval(edge.current.timer);
        edge.current = { dir: 0, timer: null, held: 0 };
        setEdgeDir(0);
    }, []);

    const startEdge = useCallback((dir, { scroll = true } = {}) => {
        if (edge.current.dir === dir) return;
        stopEdge();
        edge.current.dir = dir;
        setEdgeDir(dir);

        edge.current.timer = setInterval(() => {
            const el = scrollRef.current;
            const room = el ? el.scrollWidth - el.clientWidth : 0;
            const at = el ? el.scrollLeft : 0;

            if (scroll && el && room > 0 && (dir < 0 ? at > 0 : at < room)) {
                el.scrollLeft = at + dir * 26;
                edge.current.held = 0;
                return;
            }

            edge.current.held += EDGE_TICK_MS;
            if (edge.current.held < EDGE_FLIP_MS) return;
            edge.current.held = 0;
            latest.current.stepPeriod(dir);
        }, EDGE_TICK_MS);
    }, [stopEdge]);

    /** Called with every pointer position a running drag reports. */
    const edgeAssist = useCallback((x) => {
        const el = scrollRef.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        if (x < box.left + EDGE_ZONE) startEdge(-1);
        else if (x > box.right - EDGE_ZONE) startEdge(1);
        else stopEdge();
    }, [startEdge, stopEdge]);

    useEffect(() => stopEdge, [stopEdge]);

    /* ── the move itself ── */

    /**
     * Move a stop to `day`, optionally into gap `gap` — counted against the day
     * as it is drawn, so it includes the card being moved.
     */
    const moveTo = useCallback(async (item, day, gap = null) => {
        if (!item) return;

        const from = new Date(item.startTime);
        if (Number.isNaN(from.getTime())) return;

        const items = latest.current.itemsFor(day);
        const self = items.findIndex(i => i._id === item._id);

        // Aimed at one of the two gaps it already sits between. Nothing was
        // asked for, so nothing is the honest answer.
        if (self !== -1 && gap !== null && (gap === self || gap === self + 1)) return;

        // The card stays on screen while it is being moved rather than leaving
        // a hole that shifts everything under the cursor, so a gap below its own
        // position is counting it, and has to give one back.
        let slot = gap;
        if (slot !== null && self !== -1 && slot > self) slot -= 1;

        const neighbours = self === -1 ? items : items.filter(i => i._id !== item._id);
        const minutes = slotMinutes(neighbours, slot);
        const days = dayOffset(from, day);

        if (days === 0 && (minutes === null || minutes === minutesOf(item.startTime))) return;

        const nextStart = minutes === null ? addDays(from, days) : atMinutes(day, minutes);
        const patch = { startTime: localISO(nextStart) };

        // The planner never sets an end time, but the calendar sync does. Carry
        // the length across rather than the clock time it used to end at.
        if (item.endTime) {
            const length = new Date(item.endTime) - from;
            if (Number.isFinite(length) && length >= 0) {
                patch.endTime = localISO(new Date(nextStart.getTime() + length));
            }
        }

        setMoveError(null);
        const undo = patchPlannerItem(item._id, patch);
        announce(`${customerName(item)} moved to ${nextStart.toLocaleDateString('en-US', { weekday: 'long' })}, ${timeLabel(nextStart)}.`);

        try {
            const response = await authFetch(`${API_URL}/api/schedule/${item._id}`, {
                method: 'PUT',
                body: JSON.stringify(patch)
            });

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
            const stayed = `${customerName(item)} stayed on ${from.toLocaleDateString('en-US', { weekday: 'long' })} — ${error.message}`;
            setMoveError(stayed);
            announce(stayed);
        }
    }, [announce, onScheduleChange]);

    /** Where the drag points, as far as anything drawing is concerned. */
    const setTarget = useCallback((key, gap) => {
        setDrag(d => (!d || (d.dayKey === key && d.index === gap) ? d : { ...d, dayKey: key, index: gap }));
    }, []);

    const endDrag = useCallback(() => {
        setDrag(null);
        stopEdge();
    }, [stopEdge]);

    /* ── mouse: the browser's own drag ── */

    const handleDragStart = (item) => (e) => {
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
    const dayDropProps = (day, { ordered = true } = {}) => {
        const key = dayKey(day);
        const mine = () => drag && drag.source === 'mouse';

        return {
            'data-planner-day': key,
            'data-planner-ordered': String(ordered),
            onDragOver: (e) => {
                if (!mine()) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setTarget(key, ordered ? slotAtPoint(e.currentTarget, e.clientY) : null);
            },
            onDragLeave: (e) => {
                // Crossing onto a card inside the day is still being over the day.
                if (!mine() || e.currentTarget.contains(e.relatedTarget)) return;
                setDrag(d => (d && d.dayKey === key ? { ...d, dayKey: null, index: null } : d));
            },
            onDrop: (e) => {
                if (!mine()) return;
                e.preventDefault();
                const gap = ordered ? slotAtPoint(e.currentTarget, e.clientY) : null;
                const item = drag.item;
                endDrag();
                moveTo(item, day, gap);
            }
        };
    };

    /* ── touch: a long press, because native drag never fires from a finger ── */

    const positionGhost = (x, y) => {
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

    const handlePointerDown = (item) => (e) => {
        // A mouse already has a drag of its own, and a second one fighting it
        // would only take the drag image away.
        if (e.pointerType === 'mouse' || touch.current) return;
        suppressClick.current = false;

        const onMove = (ev) => {
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
            const dayEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-planner-day]');
            if (!dayEl) {
                setTarget(null, null);
                return;
            }
            setTarget(
                dayEl.dataset.plannerDay,
                dayEl.dataset.plannerOrdered === 'true' ? slotAtPoint(dayEl, ev.clientY) : null
            );
        };

        const onEnd = (ev) => {
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
        const block = (ev) => ev.preventDefault();
        window.addEventListener('touchmove', block, { passive: false });
        return () => window.removeEventListener('touchmove', block);
    }, [drag?.source]);

    // The ghost mounts a frame after the press lands, so it has to be told
    // where the finger was, or it flashes in the top-left corner first.
    useEffect(() => {
        if (drag?.source === 'touch' && touch.current) positionGhost(touch.current.x, touch.current.y);
    }, [drag?.source]);

    /* ── keyboard: pick up, aim, drop ── */

    /**
     * The aims the up and down keys walk through, in order: null first —
     * "leave the time alone", which is what moving to another day usually
     * means — then one per gap between that day's stops.
     */
    const gapsFor = (day) => {
        const n = itemsFor(day).length;
        return [null, ...Array.from({ length: n + 1 }, (_, i) => i)];
    };

    /** What an aim will actually do, in a sentence, for the live region. */
    const describeAim = (item, day, gap) => {
        const where = day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const items = itemsFor(day);
        const self = items.findIndex(i => i._id === item._id);

        if (gap === null) return `${where}, keeping ${timeLabel(item.startTime)}.`;
        if (self !== -1 && (gap === self || gap === self + 1)) return `${where}, where it already is.`;

        let slot = gap;
        if (self !== -1 && slot > self) slot -= 1;
        const neighbours = self === -1 ? items : items.filter(i => i._id !== item._id);
        const minutes = slotMinutes(neighbours, slot);
        return minutes === null
            ? `${where}, keeping ${timeLabel(item.startTime)}.`
            : `${where}, ${timeLabel(atMinutes(day, minutes))}.`;
    };

    const aimAt = useCallback((item, day, gap) => {
        // Aiming past the edge of the week brings that week into view rather
        // than refusing the key — the same thing a drag does at the edge.
        if (day < range.start || day > range.end) setCurrentDate(new Date(day));
        setDrag({ item, source: 'keyboard', dayKey: dayKey(day), index: gap });
    }, [range.start, range.end]);

    const grabWithKeyboard = (item) => (e) => {
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

        const onKey = (e) => {
            const aim = latest.current.drag;
            if (!aim) return;
            const day = dayFromKey(aim.dayKey);

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

            const dayStep = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
            if (dayStep) {
                e.preventDefault();
                // A new day is a new set of gaps and none of them has been asked
                // for yet, so back to "keep the time" until up or down says
                // otherwise.
                const next = addDays(day, dayStep);
                aimAt(aim.item, next, null);
                announce(describeAim(aim.item, next, null));
                return;
            }

            const gapStep = { ArrowUp: -1, ArrowDown: 1 }[e.key];
            if (!gapStep) return;
            e.preventDefault();
            const gaps = gapsFor(day);
            const at = gaps.indexOf(aim.index);
            const next = gaps[Math.min(gaps.length - 1, Math.max(0, (at === -1 ? 0 : at) + gapStep))];
            aimAt(aim.item, day, next);
            announce(describeAim(aim.item, day, next));
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
        const el = document.querySelector(`[data-planner-card="${id}"]`);
        if (!el) return;
        refocus.current = null;
        el.focus();
    }, [drag, scheduleItems]);

    /* ── what the calendar draws while a move is in the air ── */

    const dropClass = (day) => (drag && drag.dayKey === dayKey(day) ? ' is-drop' : '');

    /**
     * Whether to draw the insertion line in gap `gap` of `day`. Never in either
     * of the two gaps beside the card being moved: both of those mean "stay
     * put", and a line promising a move that will not happen is worse than no
     * line at all.
     */
    const showSlot = (day, gap) => {
        if (!drag || drag.index !== gap || drag.dayKey !== dayKey(day)) return false;
        const self = itemsFor(day).findIndex(i => i._id === drag.item._id);
        return self === -1 || (gap !== self && gap !== self + 1);
    };

    const dragProps = (item) => ({
        draggable: true,
        onDragStart: handleDragStart(item),
        onDragEnd: endDrag,
        onPointerDown: handlePointerDown(item),
        onKeyDown: grabWithKeyboard(item),
        onClickCapture: (e) => {
            if (!suppressClick.current) return;
            suppressClick.current = false;
            e.preventDefault();
            e.stopPropagation();
        },
        tabIndex: 0,
        'data-planner-card': item._id
    });

    /** Hovering the week arrows with a card in hand turns the page. */
    const navHoverProps = (dir) => ({
        onDragOver: (e) => {
            if (!drag || drag.source !== 'mouse') return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            startEdge(dir, { scroll: false });
        },
        onDragLeave: stopEdge
    });

    const effectiveCustomerOptions = useMemo(() => {
        if (customerOptions && customerOptions.length > 0) return customerOptions;
        return [...(customerSelection || [])].map(c => ({
            value: c._id,
            label: c.company || c.contactName
        })).sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    }, [customerSelection, customerOptions]);

    const activityTypeOptions = [
        { value: 'Visit', label: 'Visit' },
        { value: 'Call', label: 'Call' },
        { value: 'Drop-off', label: 'Drop-off' },
        { value: 'Other', label: 'Other' }
    ];

    const titleLabel = useMemo(() => {
        if (viewMode === 'day') {
            return currentDate.toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
            });
        }
        if (viewMode === 'week') {
            const a = weekdays[0];
            const b = weekendDays[1];
            const sameMonth = a.getMonth() === b.getMonth();
            const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const right = sameMonth
                ? `${b.getDate()}, ${b.getFullYear()}`
                : b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            return `${left} – ${right}`;
        }
        return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }, [viewMode, currentDate, weekdays, weekendDays]);

    const addLabel = (day) =>
        `Schedule an activity on ${day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`;

    const renderSkeleton = (count = 2) => (
        Array.from({ length: count }, (_, i) => (
            <div key={i} className="pl-skcard" aria-hidden="true">
                <span className="pl-sk" style={{ width: `${70 - i * 12}%` }} />
                <span className="pl-sk pl-sk--thin" style={{ width: `${44 - i * 8}%` }} />
            </div>
        ))
    );

    const itemState = (item) => {
        if (!drag || drag.item._id !== item._id) return '';
        return drag.source === 'keyboard' ? ' is-grabbed' : ' is-dragging';
    };

    // 'Completed'/'linkedVisitId' only get set once an actual visit is logged
    // against this stop (see the Add Visit handler in server.js) — everything
    // else just sits at the 'Scheduled' default whether or not it happened.
    // A 'Scheduled' stop whose day has already passed reads as missed rather
    // than silently staying indistinguishable from one still coming up.
    const visitFlag = (item) => {
        if (item.status === 'Completed') return 'done';
        if (item.status === 'Scheduled' && dayKey(new Date(item.startTime)) < dayKey(new Date())) return 'missed';
        return null;
    };

    const renderItem = (item) => {
        const flag = visitFlag(item);
        return (
            <div
                key={item._id}
                className={`pl-item pl-item--${activityModifier(item.activityType)}${itemState(item)}${flag ? ` is-${flag}` : ''}`}
                title={`${customerName(item)} — drag to another day, or press Space to move it with the arrow keys`}
                {...dragProps(item)}
            >
                <div className="pl-item-top">
                    <span
                        className="pl-typedot"
                        style={{ background: activityColor(item.activityType) }}
                        aria-hidden="true"
                    />
                    <button
                        type="button"
                        className="pl-name"
                        onClick={() => onSelectCustomer && onSelectCustomer(item.customerId)}
                        title={`Open ${customerName(item)}`}
                    >
                        {customerName(item)}
                    </button>
                    <div className="pl-acts">
                        <button type="button" className="pl-act" onClick={() => openEdit(item)} aria-label="Edit activity">
                            <Edit2 size={13} />
                        </button>
                        <button type="button" className="pl-act pl-act--danger" onClick={() => handleDelete(item._id)} aria-label="Delete activity">
                            <Trash2 size={13} />
                        </button>
                    </div>
                </div>
                <div className="pl-meta">
                    {timeLabel(item.startTime)} · {item.activityType || 'Visit'}
                    {flag === 'done' && (
                        <span className="pl-visit-flag pl-visit-flag--done"><Check size={11} /> Visited</span>
                    )}
                    {flag === 'missed' && (
                        <span className="pl-visit-flag pl-visit-flag--missed"><AlertTriangle size={11} /> Missed</span>
                    )}
                </div>
                {item.notes && <div className="pl-note" title={item.notes}>{item.notes}</div>}
            </div>
        );
    };

    /**
     * A day's cards with the insertion line threaded between them, so the gap a
     * drop is aimed at is the gap that opens up.
     */
    const renderDayItems = (day, items) => {
        const nodes = [];
        for (let i = 0; i <= items.length; i++) {
            if (showSlot(day, i)) nodes.push(<div key={`gap-${i}`} className="pl-slot" aria-hidden="true" />);
            if (i < items.length) nodes.push(renderItem(items[i]));
        }
        return nodes;
    };

    const renderDayColumn = (day, { compact = false } = {}) => {
        const items = itemsFor(day);
        const isToday = isSameDay(day, today);
        return (
            <div
                key={dayKey(day)}
                className={`pl-col${isToday ? ' is-today' : ''}${dropClass(day)}`}
                {...dayDropProps(day)}
            >
                <div className="pl-colhead">
                    <span className="pl-dow">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                    <span className="pl-headright">
                        {isToday && <span className="pl-todaytag">Today</span>}
                        <span className="pl-dnum">{day.getDate()}</span>
                        <button
                            type="button"
                            className="pl-addday"
                            onClick={() => openAdd(day)}
                            title={addLabel(day)}
                            aria-label={addLabel(day)}
                        >
                            <Plus size={14} />
                        </button>
                    </span>
                </div>
                <div className="pl-colbody">
                    {loading && items.length === 0
                        ? renderSkeleton(compact ? 1 : 2)
                        : items.length > 0
                            ? renderDayItems(day, items)
                            : (
                                <button type="button" className="pl-empty" onClick={() => openAdd(day)} title={addLabel(day)}>
                                    <Plus size={14} />
                                    <span>Add a stop</span>
                                </button>
                            )}
                </div>
            </div>
        );
    };

    const weekendItemCount = weekendDays.reduce((n, d) => n + itemsFor(d).length, 0);
    const weekendHasToday = weekendDays.some(d => isSameDay(d, today));
    const weekendQuiet = weekendItemCount === 0 && !weekendHasToday;

    const renderWeekendRail = () => (
        <div className={`pl-rail${weekendQuiet ? ' is-quiet' : ''}${weekendHasToday ? ' is-today' : ''}`}>
            <div className="pl-rail-head">Weekend</div>
            {weekendDays.map(day => {
                const items = itemsFor(day);
                const isToday = isSameDay(day, today);
                return (
                    <div
                        key={dayKey(day)}
                        className={`pl-rail-day${isToday ? ' is-today' : ''}${dropClass(day)}`}
                        {...dayDropProps(day)}
                    >
                        <div className="pl-rail-dh">
                            <span className="pl-rail-dow">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                            <span className="pl-headright">
                                {isToday && <span className="pl-todaytag">Today</span>}
                                <span className="pl-rail-dnum">{day.getDate()}</span>
                                <button
                                    type="button"
                                    className="pl-addday"
                                    onClick={() => openAdd(day)}
                                    title={addLabel(day)}
                                    aria-label={addLabel(day)}
                                >
                                    <Plus size={13} />
                                </button>
                            </span>
                        </div>
                        {items.length > 0 && (
                            <div className="pl-rail-items">{renderDayItems(day, items)}</div>
                        )}
                    </div>
                );
            })}
        </div>
    );

    const renderMonth = () => (
        <div className="pl-month">
            <div className="pl-dowrow" aria-hidden="true">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="pl-monthgrid">
                {monthWeeks.map((week, wi) => (
                    <div className="pl-mrow" key={wi}>
                        {week.map(day => {
                            const items = itemsFor(day);
                            const isToday = isSameDay(day, today);
                            const offMonth = day.getMonth() !== currentDate.getMonth();
                            const shown = items.slice(0, 3);
                            return (
                                <div
                                    key={dayKey(day)}
                                    className={`pl-cell${offMonth ? ' is-off' : ''}${isToday ? ' is-today' : ''}${dropClass(day)}`}
                                    {...dayDropProps(day, { ordered: false })}
                                >
                                    <div className="pl-cellhead">
                                        <span className="pl-cnum">{day.getDate()}</span>
                                        <button
                                            type="button"
                                            className="pl-celladd"
                                            onClick={() => openAdd(day)}
                                            title={addLabel(day)}
                                            aria-label={addLabel(day)}
                                        >
                                            <Plus size={12} />
                                        </button>
                                    </div>
                                    {shown.map(item => {
                                        const flag = visitFlag(item);
                                        return (
                                            <button
                                                key={item._id}
                                                type="button"
                                                className={`pl-ev${itemState(item)}${flag ? ` is-${flag}` : ''}`}
                                                onClick={() => openEdit(item)}
                                                title={`${timeLabel(item.startTime)} · ${customerName(item)}${flag === 'done' ? ' · Visited' : flag === 'missed' ? ' · Missed' : ''} — drag to another day, or press Space to move it with the arrow keys`}
                                                {...dragProps(item)}
                                            >
                                                <span
                                                    className="pl-typedot"
                                                    style={{ background: activityColor(item.activityType) }}
                                                    aria-hidden="true"
                                                />
                                                <span className="pl-evtime">{timeLabel(item.startTime)}</span>
                                                <span className="pl-evname">{customerName(item)}</span>
                                                {flag === 'done' && <Check size={10} className="pl-ev-flag pl-ev-flag--done" aria-hidden="true" />}
                                                {flag === 'missed' && <AlertTriangle size={10} className="pl-ev-flag pl-ev-flag--missed" aria-hidden="true" />}
                                            </button>
                                        );
                                    })}
                                    {items.length > shown.length && (
                                        <button
                                            type="button"
                                            className="pl-more"
                                            onClick={() => { setCurrentDate(new Date(day)); setViewMode('day'); }}
                                        >
                                            +{items.length - shown.length} more
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="pl-wrap">
            <div className="pl-toolbar">
                <div className="pl-toolbar-left">
                    <div className="pl-nav">
                        <button
                            type="button"
                            onClick={handlePrev}
                            className={`pl-navbtn${edgeDir < 0 ? ' is-edge' : ''}`}
                            aria-label="Previous"
                            {...navHoverProps(-1)}
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <div className="pl-views" role="group" aria-label="Calendar view">
                            {[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([mode, label]) => (
                                <button
                                    key={mode}
                                    type="button"
                                    className={`pl-viewbtn${viewMode === mode ? ' is-on' : ''}`}
                                    aria-pressed={viewMode === mode}
                                    onClick={() => setViewMode(mode)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={handleNext}
                            className={`pl-navbtn${edgeDir > 0 ? ' is-edge' : ''}`}
                            aria-label="Next"
                            {...navHoverProps(1)}
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>

                    <button type="button" className="pl-today" onClick={handleToday}>Today</button>

                    <h3 className="pl-title">{titleLabel}</h3>

                    {todayCount !== null && todayCount > 0 && (
                        <span className="pl-chip">
                            {todayCount} {todayCount === 1 ? 'stop' : 'stops'} today
                        </span>
                    )}
                </div>

                <button className="pl-new" type="button" onClick={() => openAdd(null)}>
                    <Plus size={18} /> Schedule Activity
                </button>
            </div>

            {loadError && (
                <div className="pl-error" role="alert">
                    <AlertCircle size={16} />
                    <span>{loadError}</span>
                    <button type="button" onClick={refresh}>Try again</button>
                </div>
            )}

            {moveError && (
                <div className="pl-error" role="alert">
                    <AlertCircle size={16} />
                    <span>{moveError}</span>
                    <button type="button" onClick={() => setMoveError(null)}>Dismiss</button>
                </div>
            )}

            <div
                className="pl-scroll"
                ref={scrollRef}
                onDragOver={e => { if (drag && drag.source === 'mouse') edgeAssist(e.clientX); }}
            >
                {viewMode === 'day' && (
                    <div className="pl-grid pl-grid--day">
                        {renderDayColumn(currentDate)}
                    </div>
                )}

                {viewMode === 'week' && (
                    <div className={`pl-grid pl-grid--week${weekendQuiet ? ' is-quiet-weekend' : ''}`}>
                        {weekdays.map(day => renderDayColumn(day))}
                        {renderWeekendRail()}
                    </div>
                )}

                {viewMode === 'month' && renderMonth()}
            </div>

            {/* A finger has no drag image of its own, and the card it picked up
                is somewhere under it. This is what it is holding. */}
            {drag?.source === 'touch' && (
                <div className="pl-ghost" ref={ghostRef} aria-hidden="true">
                    <span
                        className="pl-typedot"
                        style={{ background: activityColor(drag.item.activityType) }}
                    />
                    <span className="pl-ghost-name">{customerName(drag.item)}</span>
                    <span className="pl-ghost-time">{timeLabel(drag.item.startTime)}</span>
                </div>
            )}

            {/* A keyboard move happens entirely off screen for anyone using a
                reader — this is the only place it is spoken. */}
            <div className="pl-live" role="status" aria-live="polite">{announcement}</div>

            <div className="pl-legend">
                {Object.keys(ACTIVITY_COLORS).map(type => (
                    <span className="pl-lg" key={type}>
                        <span className="pl-typedot" style={{ background: ACTIVITY_COLORS[type] }} aria-hidden="true" />
                        {type}
                    </span>
                ))}
            </div>

            {showAddModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h2>{editingItem ? 'Edit Activity' : 'Schedule New Activity'}</h2>
                                {!editingItem && addingForDay && (
                                    <p className="pl-modal-sub">
                                        <CalendarIcon size={13} />
                                        {addingForDay.toLocaleDateString('en-US', {
                                            weekday: 'long', month: 'long', day: 'numeric'
                                        })}
                                    </p>
                                )}
                            </div>
                            <button type="button" className="close-btn" onClick={closeModal}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <form onSubmit={handleSave} className="planner-form">
                                <div className="form-group">
                                    <label>Customer <span style={{ color: 'red' }}>*</span></label>
                                    <SearchableSelect
                                        options={effectiveCustomerOptions}
                                        value={form.customerId}
                                        onChange={value => setForm({ ...form, customerId: value })}
                                        placeholder="Select a Customer..."
                                        required
                                        isLoading={isDropdownLoading}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Start Time <span style={{ color: 'red' }}>*</span></label>
                                    <GoogleStyleDateTimePicker
                                        value={form.startTime}
                                        onChange={value => setForm({ ...form, startTime: value })}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Activity Type</label>
                                    <SearchableSelect
                                        options={activityTypeOptions}
                                        value={form.activityType}
                                        onChange={value => setForm({ ...form, activityType: value })}
                                        placeholder="Select Type..."
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Notes</label>
                                    <textarea
                                        value={form.notes}
                                        onChange={e => setForm({ ...form, notes: e.target.value })}
                                        placeholder="Agenda or special instructions..."
                                    />
                                </div>
                            </form>
                            {saveError && (
                                <div className="pl-form-err" role="alert">
                                    <AlertCircle size={15} /> <span>{saveError}</span>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button type="button" onClick={closeModal} className="btn-secondary">Cancel</button>
                            <button type="button" onClick={handleSave} className="btn-primary" disabled={saving}>
                                {saving ? 'Saving...' : 'Save Plan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeleteModal && (
                <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
                    <div className="modal-content" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Delete Schedule</h2>
                            <button type="button" className="close-btn" onClick={() => setShowDeleteModal(false)}><X size={20} /></button>
                        </div>
                        <div className="modal-body pl-confirm">
                            <AlertCircle size={44} className="pl-confirm-icon" />
                            <p className="pl-confirm-title">Delete this scheduled activity?</p>
                            <p className="pl-confirm-note">This action cannot be undone.</p>
                        </div>
                        <div className="modal-footer">
                            <button type="button" onClick={() => setShowDeleteModal(false)} className="btn-secondary">Cancel</button>
                            <button type="button" onClick={confirmDelete} className="btn-primary pl-danger-btn">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SalesPlannerTab;
