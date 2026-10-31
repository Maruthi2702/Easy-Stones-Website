// The dispatch board's fixed rules (BoardGrid): column widths, what a column
// counts, the order a cell reads in, what dropping a ticket on a column means,
// the drop-zone labels and the load colours. No React state.
import { ArrowUpToLine, ArrowDownToLine, Link2 } from 'lucide-react';
import { MAX_TRUCK_CAPACITY } from '../../../api/deliverySchedule';
import { isReturn } from '../../../utils/deliveryTypes';
import type { Assignment, BoardColumn, Ticket } from '../types';

// Widths the dispatch table is laid out from. A driver column needs roughly this
// much to keep stop, reference number and status pill on one line; below it the
// three start colliding, so the table scrolls sideways rather than going narrower.
// The Day column is held at its width (a <col>, not a share of the spare room —
// it used to take ~25% of a wide screen and push Will Call off the edge); the
// driver columns split everything else.
export const DAY_COL_WIDTH = 132;
export const MIN_TRUCK_COL_WIDTH = 290;
// The stylesheet's existing floor — never render narrower than the board does today.
export const MIN_TABLE_WIDTH = 1100;

// The Will Call column (one driverless column for pickups) lives in
// src/utils/deliveryColumns.ts with the rest of the column order rules.

// A column nobody drives. The daily truck load is meaningless for it, so it
// shows a plain count rather than a count against MAX_TRUCK_CAPACITY.
export const isCounterColumn = (trk: BoardColumn | undefined) => Boolean(trk?.isWillCall);

// What one ticket in this column is called, so the empty state and the add
// button read naturally.
export const columnNoun = (trk: BoardColumn | undefined) => (trk?.isWillCall ? 'pickup' : 'stop');

// The cell's count, saying what it counts: "3/12 stops" on a truck (its day's
// load), "2 pickups" in Will Call (no cap).
export const countLabel = (trk: BoardColumn, count: number) => (isCounterColumn(trk)
  ? `${count} ${columnNoun(trk)}${count === 1 ? '' : 's'}`
  : `${count}/${MAX_TRUCK_CAPACITY} stops`);

// The order a cell reads in: explicit stop number first, then time as the
// tie-break for everything still sitting on the default of 1. Shared by the
// render and by the drag handler, so the list a drop is calculated against is
// the same list the dispatcher is looking at.
export const compareStops = (a: Ticket, b: Ticket) => {
  const rA = Number(a.routeNumber) || 1;
  const rB = Number(b.routeNumber) || 1;
  if (rA !== rB) return rA - rB;
  return (a.time || '').localeCompare(b.time || '');
};

/** Which third of a card a drag is over: insert before/after it, or join its stop. */
export type DropMode = 'before' | 'after' | 'merge';
export type DropSlot = { cellKey: string; targetId: string; mode: DropMode };

/**
 * The truck/type/date a ticket needs to sit in this column, shared by the
 * plain cell drop and the drop-at-a-position one so the two cannot disagree
 * about what dropping somewhere means.
 */
export const assignmentFor = (trk: BoardColumn, delivery: Partial<Ticket>, dateStr: string): Assignment => {
  let truckId = trk.id;
  let deliveryType = delivery.deliveryType;
  // Carried through unchanged by default; only the branches below that
  // actually change who's collecting a return touch it.
  let customerDropOff = delivery.customerDropOff;
  if (trk.isWillCall) {
    // Nobody of ours moves it any more. A return stays a return — the
    // customer is bringing the slabs back themselves, which is still material
    // coming in, and relabelling it a will call here would quietly reverse
    // the direction of the ticket and drop it off the report's Returns line.
    truckId = '';
    if (!isReturn(delivery)) {
      deliveryType = 'will_call';
    } else {
      // Dropping a return here, with no driver, is exactly what it means to
      // mark it a customer drop-off rather than a still-undecided return —
      // see isCounterReturn in src/utils/deliveryTypes.ts.
      customerDropOff = true;
    }
  } else if (delivery.deliveryType === 'will_call') {
    // Leaving Will Call must become a real stop on the new column.
    deliveryType = 'jobsite';
  } else {
    // A real driver is now doing the collecting, not the customer — clears
    // a stale flag so it doesn't resurface as a drop-off if this driver is
    // ever unassigned again later.
    customerDropOff = false;
  }
  // else: normal column -> normal column, deliveryType unchanged. That
  // preserves 'transfer', and preserves 'return' too — dragging a return
  // onto a driver means that driver is going out to collect it, which is
  // still a return, just one we now do the driving for.
  return { truckId, deliveryType, customerDropOff, date: dateStr };
};

/** What each drop zone means, spelled out — the icon+colour language alone
 * (a gold line vs a blue ring) reads fine once you know it, but nothing
 * about a 2px box-shadow teaches a first-time user what dropping there will
 * do. Shown as a label riding along with the cursor's exact position, not a
 * legend somewhere else on screen the eye has to leave the drag for. */
export const DROP_HINTS: Record<DropMode, { icon: typeof ArrowUpToLine; text: string }> = {
  before: { icon: ArrowUpToLine, text: 'New stop before this one' },
  after: { icon: ArrowDownToLine, text: 'New stop after this one' },
  merge: { icon: Link2, text: 'Same stop as this delivery' }
};

export const getCapacityColorClass = (count: number) => {
  if (count >= MAX_TRUCK_CAPACITY) return 'capacity-alert-red';
  if (count >= MAX_TRUCK_CAPACITY - 2) return 'capacity-warn-amber';
  return 'capacity-ok-green';
};
