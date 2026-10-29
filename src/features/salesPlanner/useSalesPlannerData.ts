import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    getCachedPlannerRange,
    loadPlannerRange,
    subscribePlannerSchedule,
    setPlannerUser,
    plannerRangeKey
} from './plannerSchedule';
import type { PlannerItem } from './plannerSchedule';
import {
    dayKey, startOfDay, rangeFor, groupByDay, weekdaysOf, weekendOf, weeksBetween,
    type ViewMode
} from './salesPlanner';

/**
 * Which week you were looking at is part of what you had open. Switching to the
 * Visits tab and back used to snap the planner to today's week in whatever view
 * it defaults to, throwing away a deliberate navigation; this remembers it for
 * as long as the page is loaded.
 */
const lastView: { date: number | null; mode: ViewMode | null } = { date: null, mode: null };

/** Phones (under 640px, the phone tab bar's breakpoint) open on Day; tablets and desktop on Week. */
const defaultMode = (): ViewMode =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'day' : 'week';

const cachedItemsForLastView = () => {
    const date = lastView.date ? new Date(lastView.date) : new Date();
    const r = rangeFor(date, lastView.mode ?? defaultMode());
    return getCachedPlannerRange(dayKey(r.start), dayKey(r.end));
};

/**
 * The planner's data: which day and view are on screen, the schedule for the
 * span they fetch (from ./plannerSchedule's cache, revalidated behind it), and
 * that schedule grouped by day.
 */
export default function useSalesPlannerData(currentUserId: string | null) {
    const [currentDate, setCurrentDate] = useState(() => (lastView.date ? new Date(lastView.date) : new Date()));
    const [viewMode, setViewMode] = useState<ViewMode>(() => lastView.mode ?? defaultMode());
    // Anything already fetched this session paints in the first frame — a tab
    // switch should not cost a round trip before the week reappears.
    const [scheduleItems, setScheduleItems] = useState<PlannerItem[]>(() => cachedItemsForLastView() || []);
    const [loading, setLoading] = useState(() => cachedItemsForLastView() === null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

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
            // eslint-disable-next-line react-hooks/set-state-in-effect -- as it was before the split (the rule now sees it)
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

    const itemsByDay = useMemo(() => groupByDay(scheduleItems), [scheduleItems]);

    const itemsFor = useCallback((day: Date) => itemsByDay.get(dayKey(day)) || [], [itemsByDay]);

    const weekdays = useMemo(() => weekdaysOf(currentDate), [currentDate]);

    const weekendDays = useMemo(() => weekendOf(currentDate), [currentDate]);

    const monthWeeks = useMemo(() => {
        if (viewMode !== 'month') return [];
        return weeksBetween(range.start, range.end);
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
    const stepPeriod = useCallback((dir: number) => {
        setCurrentDate(prev => {
            const d = new Date(prev);
            if (viewMode === 'day') d.setDate(d.getDate() + dir);
            else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
            else d.setMonth(d.getMonth() + dir);
            return d;
        });
    }, [viewMode]);

    return {
        currentDate, setCurrentDate, viewMode, setViewMode, today, range,
        scheduleItems, loading, loadError, refresh,
        itemsFor, weekdays, weekendDays, monthWeeks, todayCount, stepPeriod
    };
}

export type SalesPlannerData = ReturnType<typeof useSalesPlannerData>;
