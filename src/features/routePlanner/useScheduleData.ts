import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { todayKey, pad, customerOf } from './helpers';
import type { Booking, ScheduleRow } from './types';

/**
 * The planner's calendar (GET /api/schedule): each customer's next booking
 * (the panel's "Scheduled …"), and every entry fetched so far grouped by day
 * for the Schedule panel and the "Schedule a visit" sheet.
 */
export function useScheduleData() {
    const [scheduled, setScheduled] = useState(new Map<string, Booking>());
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

    useEffect(() => { loadScheduled(); }, [loadScheduled]);
    // Backfills the current month's days before today — SchedulePanel opens
    // on this month by default, and loadScheduled above only ever covers
    // today onward, so without this the first half of the current month
    // would show as empty until the rep manually paged away and back.
    useEffect(() => { loadScheduleMonth(new Date()); }, [loadScheduleMonth]);

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

    return {
        /** Each customer's next booking, by customer id. */
        scheduled,
        visitsByDate,
        monthLoading: monthFetchesInFlight > 0,
        setScheduleById, loadScheduled, loadScheduleMonth
    };
}

export type ScheduleData = ReturnType<typeof useScheduleData>;
