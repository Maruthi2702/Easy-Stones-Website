// The office/sales dispatch board: truck columns × week days, drag-and-drop
// to move/reorder stops. Rendered by DeliveryScheduleTab.tsx for both the
// 'office' (editable) and 'sales' (read-only) roles — DriverView.tsx is the
// separate, mobile-first component a driver sees instead. See
// src/features/delivery/README.md for how this fits with the rest
// of the feature (deliverySchedule.ts's cache, the backend router, the socket).
import React, { useState, useEffect, useRef } from 'react';
import TicketChip from './TicketChip';
import BoardCards from './BoardCards';
import BoardTable from './BoardTable';
import { useBoardScroll } from './useBoardScroll';
import { compareStops, DROP_HINTS } from './boardRules';
import { dropOnCell, dropOnStop, stopZoneFor } from './boardDrops';
import type { DropMode, DropSlot } from './boardRules';
import { formatForDateInput } from '../../../utils/dateUtils';
import { isThirdPartyTruck } from '../../../utils/deliveryPickup';
import { orderBoardColumns, WILL_CALL_COLUMN } from '../../../utils/deliveryColumns';
import { columnIdFor } from '../../../utils/deliveryTypes';
import { groupStops } from '../../../utils/stopGrouping';
import type { Assignment, BoardColumn, StopOrder, Ticket } from '../types';

export type BoardGridProps = {
  trucks?: BoardColumn[];
  deliveries?: Ticket[];
  pending?: Ticket[];
  cancelled?: Ticket[];
  weekDates?: string[];
  todayRequest?: number;
  searchQuery?: string;
  columnOrder?: string[] | null;
  editable?: boolean;
  onAddDelivery?: (truckId?: string | null, dateStr?: string | null) => void;
  onEditDelivery?: ((delivery: Ticket) => void) | null;
  /** Resolves once the move is saved; reports its own failure. */
  onMoveDelivery?: (id: string, assignment: Assignment) => unknown;
  onReorderDeliveries?: (updates: StopOrder[]) => unknown;
  onViewPod?: (delivery: Ticket) => void;
  onOpenPod?: (delivery: Ticket) => void;
  /** Passed by the page (its local rename of a column); the board doesn't use it. */
  onUpdateTruck?: (id: string, newName: string, newDriver: string) => void;
};

const BoardGrid = ({
  trucks = [],
  deliveries = [],
  // Orders with no driver assigned yet — rendered separately by
  // PendingDeliveries, not part of `deliveries`. A drag can originate from
  // there, so the drop handler below has to be able to find it too.
  pending = [],
  // Same reasoning, for CancelledOrders — dragging a cancelled ticket onto a
  // truck cell has to find it here since it isn't in `deliveries` either.
  cancelled = [],
  weekDates = [],
  // Bumped by the toolbar's Today button: bring today's day back into view.
  todayRequest = 0,
  searchQuery = '',
  // This branch's saved column order (ids), or null for the default order.
  columnOrder = null,
  editable = false,
  onAddDelivery,
  onEditDelivery,
  onMoveDelivery,
  // Saves a whole cell's stop order at once. Without it the board still moves
  // cards between columns, it just cannot fix their running order.
  onReorderDeliveries,
  onViewPod,
  onOpenPod
}: BoardGridProps) => {
  const todayStr = formatForDateInput(new Date());
  const initialDate = weekDates.includes(todayStr) ? todayStr : (weekDates[0] || todayStr);

  const [selectedDate, setSelectedDate] = useState(initialDate);

  // Track the week start so we only react when the user navigates to a DIFFERENT week
  const prevWeekStartRef = useRef(weekDates[0] || '');

  useEffect(() => {
    const currentWeekStart = weekDates[0] || '';
    const weekChanged = currentWeekStart !== prevWeekStartRef.current;
    prevWeekStartRef.current = currentWeekStart;

    if (weekDates && weekDates.length > 0) {
      if (weekChanged) {
        // User navigated to a new week — auto-select today if in range, else first day
        if (weekDates.includes(todayStr)) {
          setSelectedDate(todayStr);
        } else {
          setSelectedDate(weekDates[0]);
        }
      } else if (!weekDates.includes(selectedDate)) {
        // Same week but selectedDate no longer valid (edge case), fall back
        setSelectedDate(weekDates[0]);
      }
    }
  }, [weekDates]);

  // Automatic screen size detection (Desktop/Laptop >= 900px -> Dispatch Matrix 'table', Mobile/iPad < 900px -> Cards View 'cards')
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 900 ? 'table' : 'cards';
    }
    return 'table';
  });

  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== 'undefined') {
        setViewMode(window.innerWidth >= 900 ? 'table' : 'cards');
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [internalSearch] = useState('');
  const activeSearch = searchQuery || internalSearch;

  const { tableScrollRef, moreSide, scrollColumns } = useBoardScroll({ weekDates, viewMode, todayRequest, todayStr, setSelectedDate });

  // Which cell (truck x day) a dragged ticket is currently hovering over, for
  // the drop-target highlight. Table view only — the cards view has no cells.
  const [dragOverCellKey, setDragOverCellKey] = useState<string | null>(null);

  // Which ticket the pointer is over mid-drag, and which third of it —
  // 'before'/'after' to insert as a new stop there, 'merge' to join that
  // ticket's stop. Separate from dragOverCellKey: that highlights the whole
  // cell for a plain move, this marks one zone on one card.
  const [dropSlot, setDropSlot] = useState<DropSlot | null>(null);

  const handleDropOnStop = (trk: BoardColumn, dateStr: string, targetId: string, mode: DropMode, cellStops: StopOrder[], e: React.DragEvent) =>
    dropOnStop({ trk, dateStr, targetId, mode, cellStops, e, clearHighlights: () => { setDropSlot(null); setDragOverCellKey(null); }, onMoveDelivery, onReorderDeliveries });

  /**
   * One cell's cards, each wrapped in a slot that accepts a drop on its top,
   * middle or bottom third. The wrapper exists purely to own those handlers —
   * TicketChip is used in the pending list and elsewhere, and ordering is
   * meaningless there.
   */
  const renderCellTickets = (trk: BoardColumn, dateStr: string, cellDeliveries: Ticket[], listClassName: string) => {
    const cellKey = `${trk.id}_${dateStr}`;
    // Not in a former driver's column: nothing new can be dropped onto them.
    const cellCanReorder = Boolean(editable && onReorderDeliveries && !trk?.inactive);
    // Plain {id, routeNumber} pairs, not the delivery objects — see the note on
    // handleDropOnStop above for why the handler needs data rather than a
    // reference into `deliveries`/`cellDeliveries`.
    const cellStops = (fullCellMap.get(cellKey) || cellDeliveries).map(d => ({ id: d.id, routeNumber: Number(d.routeNumber) || 1 }));
    const groupOf = new Map<string, { gi: number; size: number }>();
    groupStops(cellStops).forEach((ids: string[], gi: number) => ids.forEach(id => groupOf.set(id, { gi, size: ids.length })));

    return (
      <div className={listClassName}>
        {cellDeliveries.map((del) => {
          const active = dropSlot && dropSlot.cellKey === cellKey && dropSlot.targetId === del.id
            ? dropSlot.mode
            : null;
          // A shared stop gets a quiet marker rather than a redesigned card —
          // just enough that "these four belong together" reads at a glance,
          // without changing how a lone stop looks (still the vast majority).
          const group = groupOf.get(del.id);
          const sharedStopClass = group && group.size > 1 ? ' shared-stop' : '';
          return (
            <div
              key={del.id}
              className={`ticket-slot${sharedStopClass}${active === 'before' ? ' drop-above' : ''}${active === 'after' ? ' drop-below' : ''}${active === 'merge' ? ' drop-merge' : ''}`}
              title={group && group.size > 1 ? `Same stop as ${group.size - 1} other invoice${group.size > 2 ? 's' : ''}` : undefined}
              onDragOver={cellCanReorder ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                const mode = stopZoneFor(e);
                setDropSlot(prev => (prev && prev.cellKey === cellKey && prev.targetId === del.id && prev.mode === mode)
                  ? prev
                  : { cellKey, targetId: del.id, mode });
              } : undefined}
              onDrop={cellCanReorder
                ? (e) => handleDropOnStop(trk, dateStr, del.id, stopZoneFor(e), cellStops, e)
                : undefined}
            >
              {active && (() => {
                const { icon: HintIcon, text } = DROP_HINTS[active];
                return (
                  // pointer-events: none — this sits directly over the same
                  // element that owns onDragOver/onDrop, and intercepting the
                  // pointer here would fire those events against the label
                  // instead of the slot, freezing the indicator on whatever
                  // zone the cursor first crossed into.
                  <div className={`drop-hint drop-hint-${active}`}>
                    <HintIcon size={12} />
                    {text}
                  </div>
                );
              })()}
              <TicketChip
                delivery={del}
                onClick={onEditDelivery}
                editable={editable}
                searchQuery={activeSearch}
                onViewPod={onViewPod}
                onOpenPod={podHandlerFor(trk.id)}
              />
            </div>
          );
        })}
      </div>
    );
  };

  // Dropped on the cell itself rather than on one of its cards (boardDrops.ts).
  const handleDropOnCell = (trk: BoardColumn, dateStr: string, e: React.DragEvent) =>
    dropOnCell({ trk, dateStr, e, clearCellHighlight: () => setDragOverCellKey(null), deliveries, pending, cancelled, fullCellMap, onMoveDelivery, onReorderDeliveries });

  // Filter deliveries by search query. Location scoping now happens server-side
  // against the user's assignedLocations; filtering again here would re-hide
  // branches a multi-location user is entitled to, since this only ever compared
  // against their single primary `location`.
  const filteredDeliveries = deliveries.filter(d => {
    if (!activeSearch.trim()) return true;
    const q = activeSearch.toLowerCase().trim();
    return (
      d.customerName?.toLowerCase().includes(q) ||
      d.address?.toLowerCase().includes(q) ||
      d.salesRepName?.toLowerCase().includes(q) ||
      d.soNumber?.toLowerCase().includes(q) ||
      d.invoiceNumber?.toLowerCase().includes(q) ||
      // The chip shows the pickup vehicle in place of the address on a will
      // call, so the plate on it is searchable the same way an address is.
      d.pickupInfo?.toLowerCase().includes(q)
    );
  });

  // Pre-index deliveries by `${truckId}_${date}` in O(N) for optimal rendering performance
  const cellMap = React.useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const d of filteredDeliveries) {
      // Keyed by column, not by truck: that pulls a will call out of the driver
      // column its truckId still points at on older tickets, with no migration.
      const key = `${columnIdFor(d)}_${d.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    // Sort each cell's list by routeNumber ascending (Stop #1, Stop #2...), then by time
    for (const list of map.values()) list.sort(compareStops);
    return map;
  }, [filteredDeliveries]);

  // The same cells before the search: a drop is worked out against every
  // ticket in the cell, not just the ones a search left on screen. Renumbering
  // only the visible cards left the hidden ones holding numbers the drop now
  // claimed, and the server refused it ("This run changed since you loaded
  // it") on every try while a search was active.
  const fullCellMap = React.useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const d of deliveries) {
      const key = `${columnIdFor(d)}_${d.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    for (const list of map.values()) list.sort(compareStops);
    return map;
  }, [deliveries]);

  // Recomputed each render — a few drivers, cheaper than a memo the compiler
  // can't keep (see the cellMap note above).
  const displayTrucks: BoardColumn[] = (() => {
    // No "Unassigned" column: an order without a driver belongs to the Pending
    // list beneath the board, not to a column of its own. Will Call is the only
    // driverless column — it holds customer pickups and the occasional slab a
    // customer brings back themselves, both being orders that move without one
    // of our drivers.
    //
    // Left to right is the branch's saved order (an admin's Arrange columns),
    // else our drivers A–Z, contract trucks, then Will Call — see
    // src/utils/deliveryColumns.ts.
    //
    // A deactivated driver (Users & Roles) keeps a column only on weeks they
    // have orders: their history stays where it happened, and anything still
    // on them can be dragged to someone else. Nothing can be added to them.
    const weekHasOrders = new Set(deliveries.map(d => d.truckId));
    const shown = trucks.filter(t => !t.inactive || weekHasOrders.has(t.id));
    return orderBoardColumns([...shown, WILL_CALL_COLUMN], columnOrder);
  })();

  /**
   * Which columns hold orders that change hands at the counter rather than at
   * a jobsite. Those are the ones the office signs for — a will call because
   * the customer carries it out, contract freight because the carrier's driver
   * does, a returned slab because the customer walks it back in. Everything
   * else is signed for at the jobsite, on the driver's phone, including a
   * return one of our own drivers goes out to collect.
   */
  const pickupColumnIds = new Set(
    displayTrucks.filter(t => t.isWillCall || isThirdPartyTruck(t)).map(t => t.id)
  );

  const podHandlerFor = (truckId: string) =>
    (pickupColumnIds.has(truckId) ? onOpenPod : undefined);

  const getDeliveriesForCell = (truckId: string, dateStr: string) =>
    cellMap.get(`${truckId || ''}_${dateStr}`) || [];

  const getRawCapacity = (truckId: string, dateStr: string) =>
    (cellMap.get(`${truckId || ''}_${dateStr}`) || []).length;

  const formatDaySubtext = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isToday = dateStr === todayStr;
    return isToday ? `${formatted} · today` : formatted;
  };


  const totalStopsSelectedDay = deliveries.filter(d => d.date === selectedDate).length;

  // Every hook above the empty state: a branch with no drivers once rendered
  // fewer hooks than the same board with one, and React throws when the count
  // changes. (A day-pill scroll effect lived here; its selector matched nothing
  // and the five pills always fit, so it was removed 2026-10-24.)

  if (trucks.length === 0) {
    return (
      <div className="manifest-empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="empty-truck-icon">
          <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
        <h3>No drivers assigned to this location</h3>
        <p>Give a role <strong>Driver view</strong> under <strong>Users &amp; Roles → Delivery Schedule</strong>, then assign its users to this location.</p>
      </div>
    );
  }

  return (
    <div className="manifest-board-wrapper">
      {viewMode === 'cards' ? (
        <BoardCards
          weekDates={weekDates}
          todayStr={todayStr}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          deliveries={deliveries}
          trucks={trucks}
          displayTrucks={displayTrucks}
          totalStopsSelectedDay={totalStopsSelectedDay}
          editable={editable}
          onAddDelivery={onAddDelivery}
          getDeliveriesForCell={getDeliveriesForCell}
          getRawCapacity={getRawCapacity}
          renderCellTickets={renderCellTickets}
        />
      ) : (
        <BoardTable
          weekDates={weekDates}
          todayStr={todayStr}
          displayTrucks={displayTrucks}
          tableScrollRef={tableScrollRef}
          moreSide={moreSide}
          scrollColumns={scrollColumns}
          dragOverCellKey={dragOverCellKey}
          setDragOverCellKey={setDragOverCellKey}
          setDropSlot={setDropSlot}
          editable={editable}
          onAddDelivery={onAddDelivery}
          onMoveDelivery={onMoveDelivery}
          handleDropOnCell={handleDropOnCell}
          getDeliveriesForCell={getDeliveriesForCell}
          getRawCapacity={getRawCapacity}
          formatDaySubtext={formatDaySubtext}
          renderCellTickets={renderCellTickets}
        />
      )}
    </div>
  );
};

export default BoardGrid;
