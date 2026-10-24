import { useState } from 'react';
import {
  saveDelivery,
  deleteDelivery,
  updateDeliveryStatus,
  updateDeliveryAssignment,
  reorderDeliveries
} from '../../api/deliverySchedule';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { reportDaysForMove, submittedDayLabel } from '../../utils/deliveryForm';
import type { Loose } from '../../types/records';
import type { DeliveryPayload } from './form/DeliveryForm';
import type { Assignment, BoardColumn, StopOrder, Ticket } from './types';

type Args = {
  deliveries: Ticket[];
  pending: Ticket[];
  cancelled: Ticket[];
  applyUpdatedList: (list: Ticket[] | undefined) => Promise<void>;
  setEditingDelivery: (delivery: Loose | null) => void;
  setLoadError: (message: string | null) => void;
  setTrucks: React.Dispatch<React.SetStateAction<BoardColumn[]>>;
};

/**
 * What the board, the form and the driver view change: save, delete, status,
 * drag to a driver / Pending / Cancelled, reorder — each refreshing the board
 * — and the notice when a move touches an already-submitted Daily Report day.
 */
export function useScheduleActions({ deliveries, pending, cancelled, applyUpdatedList, setEditingDelivery, setLoadError, setTrucks }: Args) {
  const handleSaveDelivery = async (payload: DeliveryPayload) => {
    const updatedList = await saveDelivery(payload);
    await applyUpdatedList(updatedList);
    // Don't null editingDelivery here — modal awaits this and calls onClose itself
    return updatedList;
  };

  const handleDeleteDelivery = async (id: string) => {
    const updatedList = await deleteDelivery(id);
    await applyUpdatedList(updatedList);
    setEditingDelivery(null);
  };

  // Deliberately rethrows. The driver view puts the failure on screen — a tap
  // that silently does nothing is worse than one that says it didn't work.
  const handleUpdateStatus = async (id: string, newStatus: string) => {
    const updatedList = await updateDeliveryStatus(id, newStatus);
    await applyUpdatedList(updatedList);
    return updatedList;
  };

  // A rejected move used to fail completely silently: nothing awaits or
  // catches the drop handlers below, so a 4xx from the server became an
  // unhandled rejection and the card simply snapped back with no explanation.
  // That is indistinguishable from "drag and drop is broken" — which is how
  // it was reported. Put the reason on screen instead.
  const reportMoveFailure = (err: unknown) => {
    console.error('[schedule] move failed:', err);
    setLoadError((err as Error)?.message || "Couldn't move that delivery.");
  };

  // After a drag lands: if the day the ticket left, or the day it landed on,
  // already has a submitted Daily Report (its branch's day, and a transfer's
  // arrival day at the destination), say so — that report is frozen, so the
  // board and it now disagree until someone reopens the day. The same check
  // the delivery form makes (reportDaysForMove / submitted-days). Never blocks
  // the move; a failed check just shows nothing.
  const [submittedDayNotice, setSubmittedDayNotice] = useState('');
  const findTicket = (id: string) => [...deliveries, ...pending, ...cancelled].find(d => d.id === id);
  const warnIfSubmittedDays = async (before: Ticket | undefined, after: Loose) => {
    if (!before) return;
    const days = reportDaysForMove(before, after);
    if (!days.length) return;
    try {
      const key = days.map(d => `${d.location}|${d.date}`).join(',');
      const res = await authFetch(`${API_URL}/api/daily-reports/submitted-days?days=${encodeURIComponent(key)}`);
      if (!res.ok) return;
      const found = (await res.json()).days || [];
      if (!found.length) return;
      const one = found.length === 1;
      setSubmittedDayNotice(`${found.map(submittedDayLabel).join(' and ')} ${one ? 'is' : 'are'} already submitted, so ${one ? "it doesn't" : "they don't"} include this move. Reopen ${one ? 'that day' : 'those days'} in the Daily Report to bring the figures up to date.`);
    } catch {
      // Advice only.
    }
  };

  // Drag-and-drop move on the dispatch board: which driver/column/day a
  // ticket belongs to, nothing else (stop numbers are left as-is).
  const handleMoveDelivery = async (id: string, assignment: Assignment) => {
    const before = findTicket(id);
    try {
      const updatedList = await updateDeliveryAssignment(id, assignment);
      await applyUpdatedList(updatedList);
      warnIfSubmittedDays(before, { ...before, ...assignment });
      return updatedList;
    } catch (err) {
      reportMoveFailure(err);
    }
  };

  // Drag-to-reorder inside a cell. Takes the whole cell's new order, not just
  // the card that moved, because a stop number only means anything as part of a
  // complete running order.
  const handleReorderDeliveries = async (updates: StopOrder[]) => {
    try {
      const updatedList = await reorderDeliveries(updates);
      await applyUpdatedList(updatedList);
      return updatedList;
    } catch (err) {
      reportMoveFailure(err);
    }
  };

  // The reverse of the move above: dragging a ticket off the board and onto
  // the Pending list gives its driver back. Pending is defined in
  // src/utils/deliveryTypes.js, so clearing truckId is (almost) the whole
  // change — the week query and the pending query are complements, and the
  // ticket swaps sides on its own.
  //
  // A return also has customerDropOff cleared here: dragging it to Pending is
  // an explicit "nobody's assigned to this yet", which has to win over
  // whatever that flag was previously set to — otherwise a return someone had
  // marked a customer drop-off would just bounce straight back to the Will
  // Call column instead of actually landing in Pending.
  const handleMoveToPending = async (id: string) => {
    // Also checks `cancelled` — a cancelled ticket can be dragged straight
    // onto Pending, not just onto a truck cell, so it isn't in `deliveries`.
    const delivery = [...deliveries, ...cancelled].find(d => d.id === id);
    if (!delivery) return;

    try {
      const updatedList = await updateDeliveryAssignment(id, {
        truckId: '',
        // A will call has no driver by definition, so it can never be pending —
        // it has to become an ordinary stop on the way out. Same conversion the
        // board already makes in the other direction, when a will call is
        // dragged from its column onto a truck.
        deliveryType: delivery.deliveryType === 'will_call' ? 'jobsite' : (delivery.deliveryType || 'jobsite'),
        customerDropOff: false,
        // Kept, not cleared: it's the last date that was agreed, and re-assigning
        // a driver shouldn't have to rediscover it. Empty is fine too — Pending
        // itself has no date requirement, only a real truck column does.
        date: delivery.date
      });
      await applyUpdatedList(updatedList);
      warnIfSubmittedDays(delivery, { ...delivery, truckId: '', customerDropOff: false, deliveryType: delivery.deliveryType === 'will_call' ? 'jobsite' : delivery.deliveryType });
      return updatedList;
    } catch (err) {
      reportMoveFailure(err);
    }
  };

  // The other reverse move: dragging a ticket onto Cancelled Orders. Goes
  // through the status endpoint, not the assignment one — cancelling doesn't
  // touch truckId/date, it's the one thing that's kept as a record of what to
  // restore the ticket to (see handleMoveDelivery/handleMoveToPending above,
  // and PATCH /deliveries/:id/assignment server-side for the restore itself).
  const handleMoveToCancelled = async (id: string) => {
    const before = findTicket(id);
    try {
      const updatedList = await updateDeliveryStatus(id, 'cancelled');
      await applyUpdatedList(updatedList);
      warnIfSubmittedDays(before, { ...before, status: 'cancelled' });
      return updatedList;
    } catch (err) {
      reportMoveFailure(err);
    }
  };

  const handleUpdateTruck = (id: string, newName: string, newDriver: string) => {
    // Only update local state — drivers are sourced from the Users tab.
    // Permanent driver edits should be done via Users & Roles → edit user.
    setTrucks(prev => prev.map(t =>
      t.id === id ? { ...t, name: newName, driver: newDriver } : t
    ));
  };

  return {
    submittedDayNotice, setSubmittedDayNotice,
    handleSaveDelivery, handleDeleteDelivery, handleUpdateStatus, handleMoveDelivery, handleReorderDeliveries,
    handleMoveToPending, handleMoveToCancelled, handleUpdateTruck
  };
}
