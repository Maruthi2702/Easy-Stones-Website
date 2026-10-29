import { useState } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { nameOf, whenLabel, customerOf } from './helpers';
import type { ScheduleData } from './useScheduleData';
import type { DayStop, MapPin as Customer, SavedDay, ScheduleRow, ScheduleVisitInput, VisitSlotInput } from './types';

export type ScheduleActionsDeps = {
    schedule: Pick<ScheduleData, 'scheduled' | 'setScheduleById' | 'loadScheduled'>;
    /** The Tools panel's day (useDayPlan). */
    date: string;
    replaceExisting: boolean;
    /** May replace stops already planned that day (edit_route_plan). */
    canReplace: boolean;
    setError: (message: string) => void;
};

/**
 * Every write to the planner's calendar from this screen: put the Tools
 * panel's day on it or clear it, book / move / remove one customer's visit,
 * and the Schedule panel's add, edit and remove. Each reloads the bookings
 * after.
 */
export function useScheduleActions({ schedule, date, replaceExisting, canReplace, setError }: ScheduleActionsDeps) {
    const { scheduled, setScheduleById, loadScheduled } = schedule;
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState<SavedDay | null>(null);
    // Separate from `saving` above — that one covers the Tools panel's
    // route-day scheduling flow; this is ScheduleActivityForm's own
    // add/edit save, a different action with its own button/disabled state.
    const [savingVisit, setSavingVisit] = useState(false);

    // "Schedule a visit" (ScheduleVisitSheet): the customer being put on a day, or
    // rescheduled. Books the chosen day and time — a new entry, or the customer's
    // existing one moved — instead of the day set in the Tools panel.
    const saveVisitSlot = async ({ customer, booking, id, startTime, endTime, activityType, notes }: VisitSlotInput) => {
        if (saving) return false;
        setSaving(true);
        setError('');
        try {
            const res = booking
                ? await authFetch(`${API_URL}/api/schedule/${booking.id}`, { method: 'PUT', body: JSON.stringify({ startTime, endTime, activityType, notes }) })
                : await authFetch(`${API_URL}/api/schedule/bulk`, {
                    method: 'POST',
                    body: JSON.stringify({
                        date: startTime.slice(0, 10),
                        items: [{ _id: id, customerId: customer._id, startTime, endTime, activityType, notes }]
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

    // Add/edit from ScheduleActivityForm — POST for a new visit, PUT (by the
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
            const { id, ...fields } = form;
            const res = await authFetch(url, { method, body: JSON.stringify(id ? { ...fields, _id: id } : fields) });
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
                    replace: replaceExisting && canReplace,
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

    return {
        saving, saved, setSaved, savingVisit,
        saveVisitSlot, removeFromCalendar, deleteScheduledVisit, saveScheduleVisit, scheduleStops, clearPlannedDay
    };
}
