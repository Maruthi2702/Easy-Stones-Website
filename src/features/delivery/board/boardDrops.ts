// What dropping a ticket on the dispatch board does (BoardGrid): onto one card
// (a new stop before/after it, or the same stop), or onto a cell's empty
// space. BoardGrid keeps the highlight state and passes in how to clear it.
import { groupStops, applyStopMove, flattenGroups, sameStopOrder } from '../../../utils/stopGrouping';
import { columnIdFor } from '../../../utils/deliveryTypes';
import { assignmentFor } from './boardRules';
import type { DropMode } from './boardRules';
import type { Assignment, BoardColumn, StopOrder, Ticket } from '../types';

type Handlers = {
  onMoveDelivery?: (id: string, assignment: Assignment) => unknown;
  onReorderDeliveries?: (updates: StopOrder[]) => unknown;
};
type StopDrop = {
  trk: BoardColumn; dateStr: string; targetId: string; mode: DropMode; cellStops: StopOrder[]; e: React.DragEvent;
  /** Clears the card's drop zone and the cell's highlight. */
  clearHighlights: () => void;
};
type CellDrop = {
  trk: BoardColumn; dateStr: string; e: React.DragEvent;
  clearCellHighlight: () => void;
  deliveries: Ticket[]; pending: Ticket[]; cancelled: Ticket[];
  /** Every ticket per cell before the search, in running order. */
  fullCellMap: Map<string, Ticket[]>;
};

/**
 * Which of a card's three drop zones the pointer is in. Top and bottom
 * thirds insert a new stop before/after; the middle third means "same stop
 * as this one" — see the note atop stopGrouping.js for why that distinction
 * exists: several invoices for one customer are routinely delivered as a
 * single stop, and a plain "insert here" gesture cannot express joining one.
 */
export const stopZoneFor = (e: React.DragEvent<HTMLElement>): DropMode => {
  const box = e.currentTarget.getBoundingClientRect();
  const y = e.clientY - box.top;
  const third = box.height / 3;
  if (y < third) return 'before';
  if (y > third * 2) return 'after';
  return 'merge';
};

/**
 * Drop onto one card in a cell: reorder by stop (see stopGrouping.js),
 * moving the ticket here first if it came from somewhere else.
 *
 * `cellStops` — [{ id, routeNumber }] for the cell, in on-screen order — is
 * built at the render site and handed in rather than read from the
 * `deliveries` prop or the cellMap memo here. Reading either inside this
 * handler is enough on its own to stop React Compiler preserving that
 * memo's optimization for the whole board; passing plain data in avoids it
 * and is the more honest source besides — it is exactly the order the
 * dispatcher is looking at.
 */
export const dropOnStop = (
  { trk, dateStr, targetId, mode, cellStops, e, clearHighlights, onMoveDelivery, onReorderDeliveries }: StopDrop & Handlers
) => {
  e.preventDefault();
  e.stopPropagation();
  if (trk?.inactive) { clearHighlights(); return; } // a former driver takes no new orders
  clearHighlights();

  const deliveryId = e.dataTransfer.getData('text/plain');
  if (!deliveryId || deliveryId === targetId) return;

  const arrivedFromElsewhere = !cellStops.some(s => s.id === deliveryId);
  const groups = groupStops(cellStops);
  const nextGroups = applyStopMove(groups, deliveryId, targetId, mode);
  const nextStops = flattenGroups(nextGroups);

  const saveOrder = () => {
    if (!arrivedFromElsewhere && sameStopOrder(cellStops, nextStops)) return;
    return onReorderDeliveries && onReorderDeliveries(nextStops);
  };

  if (!arrivedFromElsewhere) {
    saveOrder();
    return;
  }

  // Came from another column, another day, or the Pending list: it has to be
  // assigned here before its position here means anything. Chained rather
  // than awaited — an async handler closing over these props is enough on
  // its own to stop React Compiler optimizing the whole board.
  if (!onMoveDelivery) return;
  // Type comes off the drag itself (see TicketChip's onDragStart), so this
  // handler never reads the deliveries/pending props.
  const dragged = { id: deliveryId, deliveryType: e.dataTransfer.getData('application/x-delivery-type') || 'jobsite' };
  Promise.resolve(onMoveDelivery(deliveryId, assignmentFor(trk, dragged, dateStr)))
    .then(saveOrder)
    // The move reports its own failure; without it landing there is no cell
    // for this ticket to be ordered within.
    .catch(() => {});
};

// Dropped on the cell itself rather than on one of its cards — the empty
// strip below the last stop, or an empty cell entirely. Ticket-level drops
// (handleDropOnStop above) cover everything else; this only has to decide
// what "just put it in this cell somewhere" means.
export const dropOnCell = (
  { trk, dateStr, e, clearCellHighlight, deliveries, pending, cancelled, fullCellMap, onMoveDelivery, onReorderDeliveries }: CellDrop & Handlers
) => {
  e.preventDefault();
  clearCellHighlight();
  if (!onMoveDelivery || trk.inactive) return; // a former driver takes no new orders

  const deliveryId = e.dataTransfer.getData('text/plain');
  const delivery = deliveries.find(d => d.id === deliveryId)
    || pending.find(d => d.id === deliveryId)
    || cancelled.find(d => d.id === deliveryId);
  if (!delivery) return;

  const assignment = assignmentFor(trk, delivery, dateStr);
  const existing = (fullCellMap.get(`${trk.id || ''}_${dateStr}`) || []).filter(d => d.id !== deliveryId);

  // Dropped back on the cell it started in with nothing else to land on —
  // nothing to change. (A drop onto a specific card is handled by
  // handleDropOnStop before it ever reaches here.)
  if (!existing.length && columnIdFor(delivery) === trk.id && delivery.date === dateStr) return;

  if (!existing.length) {
    onMoveDelivery(delivery.id, assignment);
    return;
  }

  // The cell already holds stops — land after the last one rather than
  // leaving the dropped ticket's routeNumber whatever it happened to arrive
  // with, which could collide with an existing stop or default it to 1 and
  // jump the whole queue.
  const cellStops = existing.map(d => ({ id: d.id, routeNumber: Number(d.routeNumber) || 1 }));
  const nextStops = flattenGroups([...groupStops(cellStops), [delivery.id]]);
  const saveOrder = () => onReorderDeliveries && onReorderDeliveries(nextStops);

  if (columnIdFor(delivery) === trk.id && delivery.date === dateStr) {
    saveOrder();
    return;
  }
  Promise.resolve(onMoveDelivery(delivery.id, assignment)).then(saveOrder).catch(() => {});
};
