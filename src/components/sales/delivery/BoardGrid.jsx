import React, { useState, useEffect, useRef } from 'react';
import { Plus, LayoutGrid, Calendar, Clock, MapPin, CheckCircle2, AlertTriangle, User, FileText } from 'lucide-react';
import TicketChip from './TicketChip';
import { MAX_TRUCK_CAPACITY } from '../../../api/schedule';
import { formatForDateInput } from '../../../utils/dateUtils';
import { isThirdPartyTruck } from '../../../utils/deliveryPickup';

// Widths the dispatch table is laid out from. A driver column needs roughly this
// much to keep stop, reference number and status pill on one line; below it the
// three start colliding, so the table scrolls sideways rather than going narrower.
const DAY_COL_WIDTH = 170;
const MIN_TRUCK_COL_WIDTH = 290;
// The stylesheet's existing floor — never render narrower than the board does today.
const MIN_TABLE_WIDTH = 1100;

// A will call is collected by the customer, so it belongs to no driver and to no
// truck's daily load. It gets a column of its own at the end of the board rather
// than sitting under whoever happened to be selected when the ticket was made.
export const WILL_CALL_COLUMN_ID = '__will_call__';

const WILL_CALL_COLUMN = {
  id: WILL_CALL_COLUMN_ID,
  driver: 'Will Call',
  name: 'Customer Pickup',
  color: '#2dd4bf',
  isWillCall: true
};

const columnIdFor = (d) =>
  d?.deliveryType === 'will_call' ? WILL_CALL_COLUMN_ID : (d?.truckId || '');

const DAYS_OF_WEEK = [
  { name: 'Monday',    short: 'Mon', index: 1 },
  { name: 'Tuesday',  short: 'Tue', index: 2 },
  { name: 'Wednesday',short: 'Wed', index: 3 },
  { name: 'Thursday', short: 'Thu', index: 4 },
  { name: 'Friday',   short: 'Fri', index: 5 }
];

const BoardGrid = ({
  trucks = [],
  deliveries = [],
  // Orders with no driver assigned yet — rendered separately by
  // PendingDeliveries, not part of `deliveries`. A drag can originate from
  // there, so the drop handler below has to be able to find it too.
  pending = [],
  weekDates = [],
  searchQuery = '',
  editable = false,
  onAddDelivery,
  onEditDelivery,
  onMoveDelivery,
  onViewPod,
  onOpenPod
}) => {
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

  // Which cell (truck x day) a dragged ticket is currently hovering over, for
  // the drop-target highlight. Table view only — the cards view has no cells.
  const [dragOverCellKey, setDragOverCellKey] = useState(null);

  const handleDropOnCell = (trk, dateStr, e) => {
    e.preventDefault();
    setDragOverCellKey(null);
    if (!onMoveDelivery) return;

    const deliveryId = e.dataTransfer.getData('text/plain');
    const delivery = deliveries.find(d => d.id === deliveryId) || pending.find(d => d.id === deliveryId);
    if (!delivery) return;

    // Dropped back on the slot it started in — nothing to change.
    if (columnIdFor(delivery) === trk.id && delivery.date === dateStr) return;

    let truckId = trk.id;
    let deliveryType = delivery.deliveryType;
    if (trk.isWillCall) {
      truckId = '';
      deliveryType = 'will_call';
    } else if (delivery.deliveryType === 'will_call') {
      // Leaving Will Call must become a real stop on the new column.
      deliveryType = 'jobsite';
    }
    // else: normal column -> normal column, deliveryType unchanged (preserves 'transfer')

    onMoveDelivery(delivery.id, { truckId, deliveryType, date: dateStr });
  };

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
    const map = new Map();
    for (const d of filteredDeliveries) {
      // Keyed by column, not by truck: that pulls a will call out of the driver
      // column its truckId still points at on older tickets, with no migration.
      const key = `${columnIdFor(d)}_${d.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(d);
    }
    // Sort each cell's list by routeNumber ascending (Stop #1, Stop #2...), then by time
    for (const list of map.values()) {
      list.sort((a, b) => {
        const rA = Number(a.routeNumber) || 1;
        const rB = Number(b.routeNumber) || 1;
        if (rA !== rB) return rA - rB;
        return (a.time || '').localeCompare(b.time || '');
      });
    }
    return map;
  }, [filteredDeliveries]);

  const displayTrucks = React.useMemo(() => {
    // No "Unassigned" column: an order without a driver belongs to the Pending
    // list beneath the board, not to a column of its own. Will Call is the one
    // driverless column, pinned last so the drivers still read left to right.
    return [...trucks, WILL_CALL_COLUMN];
  }, [trucks]);

  /**
   * Which columns hold orders that are collected rather than delivered. Those
   * are the ones the office signs for at the counter — a will call because the
   * customer carries it out, contract freight because the carrier's driver
   * does. Everything else is signed for at the jobsite, on the driver's phone.
   */
  const pickupColumnIds = React.useMemo(
    () => new Set(
      displayTrucks.filter(t => t.isWillCall || isThirdPartyTruck(t)).map(t => t.id)
    ),
    [displayTrucks]
  );

  const podHandlerFor = (truckId) =>
    (pickupColumnIds.has(truckId) ? onOpenPod : undefined);

  const getDeliveriesForCell = (truckId, dateStr) =>
    cellMap.get(`${truckId || ''}_${dateStr}`) || [];

  const getRawCapacity = (truckId, dateStr) =>
    (cellMap.get(`${truckId || ''}_${dateStr}`) || []).length;

  const getCapacityColorClass = (count) => {
    if (count >= MAX_TRUCK_CAPACITY) return 'capacity-alert-red';
    if (count >= MAX_TRUCK_CAPACITY - 2) return 'capacity-warn-amber';
    return 'capacity-ok-green';
  };

  const formatDaySubtext = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isToday = dateStr === todayStr;
    return isToday ? `${formatted} · today` : formatted;
  };


  const totalStopsSelectedDay = deliveries.filter(d => d.date === selectedDate).length;

  // Above the empty state on purpose. These two used to sit below it, so a
  // branch with no drivers rendered zero hooks and the same board rendered two
  // the moment a driver was assigned — React counts hooks per render and throws
  // when the count changes, blanking the delivery board on the way in.
  const pillsRef = React.useRef(null);

  useEffect(() => {
    if (pillsRef.current) {
      const activePill = pillsRef.current.querySelector('.screenshot-pill-btn.active');
      if (activePill) {
        activePill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [selectedDate]);

  if (trucks.length === 0) {
    return (
      <div className="manifest-empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="empty-truck-icon">
          <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
        <h3>No drivers assigned to this location</h3>
        <p>Add users with the <strong>Driver</strong> role in <strong>Users &amp; Roles</strong> and assign them to this location.</p>
      </div>
    );
  }

  return (
    <div className="manifest-board-wrapper">
      {viewMode === 'cards' ? (
        /* ── UX REDESIGN MOBILE LAYOUT ── */
        <div className="ux-mobile-schedule-container">

          {/* Day Selector Pills Bar */}
          <div className="ux-day-pills-bar" ref={pillsRef}>
            {DAYS_OF_WEEK.map((dayObj, idx) => {
              const dateStr = weekDates[idx] || '';
              const isSelected = selectedDate === dateStr;
              const isToday = dateStr === todayStr;
              const dayStopsCount = deliveries.filter(d => d.date === dateStr).length;

              return (
                <button
                  key={dayObj.short}
                  type="button"
                  className={`ux-day-pill-card ${isSelected ? 'active' : ''} ${isToday ? 'is-today' : ''}`}
                  onClick={() => setSelectedDate(dateStr)}
                >
                  <span className="ux-pill-day-name">{dayObj.short.toUpperCase()}</span>
                  <span className="ux-pill-date-num">{dateStr ? dateStr.split('-')[2] : ''}</span>
                  <span className="ux-pill-stops-count">
                    {isSelected ? 'Active' : (dayStopsCount > 0 ? `${dayStopsCount} ${dayStopsCount === 1 ? 'stop' : 'stops'}` : '0 stops')}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Day Subtext Summary */}
          <div className="ux-schedule-subtext">
            {trucks.length} {trucks.length === 1 ? 'truck' : 'trucks'} · {totalStopsSelectedDay} {totalStopsSelectedDay === 1 ? 'stop' : 'stops'} scheduled
          </div>

          {/* Driver Sections */}
          <div className="ux-driver-list">
            {displayTrucks.map(trk => {
              const trkDeliveries = getDeliveriesForCell(trk.id, selectedDate);
              const capCount = getRawCapacity(trk.id, selectedDate);

              return (
                <div
                  key={trk.id || 'unassigned'}
                  className="ux-driver-card"
                  style={{ borderLeftColor: trk.color || '#D4AF37' }}
                >
                  {/* Driver Header */}
                  <div className="ux-driver-header">
                    <div className="ux-driver-name-wrap">
                      <span className="ux-driver-dot" style={{ background: trk.color || '#D4AF37' }} />
                      <span className="ux-driver-name">{trk.driver || trk.name}</span>
                    </div>

                    <div className="ux-driver-actions">
                      {/* Will calls are collected by the customer, so the daily
                          truck load does not apply — count them, don't cap them. */}
                      <span className={`ux-capacity-badge ${capCount > 0 ? 'has-stops' : 'empty'}`}>
                        {trk.isWillCall ? capCount : `${capCount}/${MAX_TRUCK_CAPACITY}`}
                      </span>
                      {editable && (
                        <button
                          type="button"
                          className="ux-btn-add-stop"
                          onClick={() => onAddDelivery && onAddDelivery(trk.id, selectedDate)}
                          title={trk.isWillCall ? 'Add a customer pickup' : `Add stop for ${trk.driver}`}
                        >
                          <Plus size={14} /> {trk.isWillCall ? 'Add pickup' : 'Add stop'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Driver Delivery Ticket Cards */}
                  {trkDeliveries.length === 0 ? (
                    <div className="ux-no-stops-text">
                      {trk.isWillCall ? 'No pickups scheduled' : 'No stops scheduled'}
                    </div>
                  ) : (
                    <div className="ux-tickets-list">
                      {trkDeliveries.map(del => (
                        <TicketChip
                          key={del.id}
                          delivery={del}
                          truckColor={trk.color || '#D4AF37'}
                          editable={editable}
                          searchQuery={searchQuery}
                          onClick={onEditDelivery}
                          onViewPod={onViewPod}
                          onOpenPod={podHandlerFor(trk.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── DISPATCH TABLE MATRIX ── */
        <div className="board-grid-scroll-container">
          {/* table-layout is fixed, so without a width that grows per driver the
              columns just divide the same 1100px and every extra driver squeezes
              the cards further. Give each driver a floor and let the container
              scroll sideways instead. */}
          <table
            className="manifest-dispatch-table"
            style={{ minWidth: `${Math.max(MIN_TABLE_WIDTH, DAY_COL_WIDTH + displayTrucks.length * MIN_TRUCK_COL_WIDTH)}px` }}
          >
            <thead>
              <tr>
                <th className="day-col-header-row">
                  <div className="th-day-inner"><span>Day</span></div>
                </th>
                {displayTrucks.map(trk => (
                  <th
                    key={trk.id || 'unassigned'}
                    className="truck-col-header"
                    style={{ '--truck-color': trk.color || '#D4AF37' }}
                  >
                    <div className="truck-label-wrap">
                      <div className="truck-color-dot" style={{ background: trk.color || '#D4AF37' }} />
                      <div className="truck-text-details">
                        <span className="truck-name">{trk.driver || trk.name}</span>
                        {trk.name && trk.driver && trk.name !== trk.driver && (
                          <span className="truck-driver">{trk.name}</span>
                        )}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {DAYS_OF_WEEK.map((dayObj, idx) => {
                const dateStr = weekDates[idx] || '';
                const isToday = dateStr === todayStr;

                return (
                  <tr key={dayObj.short} className={`day-grid-row ${isToday ? 'today-row' : ''}`}>
                    <td className={`day-info-cell ${isToday ? 'today-cell' : ''}`}>
                      <div className="day-label-wrap">
                        <span className="day-name">{dayObj.name}</span>
                        <span className="day-date">{formatDaySubtext(dateStr)}</span>
                      </div>
                    </td>

                    {displayTrucks.map(trk => {
                      const cellDeliveries = getDeliveriesForCell(trk.id, dateStr);
                      const rawCount = getRawCapacity(trk.id, dateStr);
                      const capClass = getCapacityColorClass(rawCount);

                      const cellKey = `${trk.id}_${dateStr}`;

                      return (
                        <td
                          key={trk.id}
                          className={`dispatch-cell ${dragOverCellKey === cellKey ? 'drop-target' : ''}`}
                          onDragOver={(e) => {
                            if (!onMoveDelivery) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                          }}
                          onDragEnter={() => onMoveDelivery && setDragOverCellKey(cellKey)}
                          onDragLeave={() => onMoveDelivery &&
                            setDragOverCellKey(prev => (prev === cellKey ? null : prev))}
                          onDrop={(e) => handleDropOnCell(trk, dateStr, e)}
                        >
                          <div className="cell-header-bar">
                            <span
                              className={`cell-capacity-pill ${trk.isWillCall ? 'capacity-ok-green' : capClass}`}
                              title={trk.isWillCall
                                ? `${rawCount} customer ${rawCount === 1 ? 'pickup' : 'pickups'} booked`
                                : `${rawCount} of ${MAX_TRUCK_CAPACITY} deliveries booked`}
                            >
                              {trk.isWillCall ? rawCount : `${rawCount}/${MAX_TRUCK_CAPACITY}`}
                            </span>
                            {editable && (
                              <button
                                type="button"
                                className="cell-add-btn"
                                onClick={() => onAddDelivery && onAddDelivery(trk.id, dateStr)}
                                title={trk.isWillCall
                                  ? `Add will call pickup — ${dayObj.name}`
                                  : `Add delivery — ${trk.driver} on ${dayObj.name}`}
                              >
                                <Plus size={14} />
                              </button>
                            )}
                          </div>

                          <div className="cell-tickets-list">
                            {cellDeliveries.map(del => (
                              <TicketChip
                                key={del.id}
                                delivery={del}
                                truckColor={trk.color}
                                onClick={onEditDelivery}
                                editable={editable}
                                searchQuery={activeSearch}
                                onViewPod={onViewPod}
                                onOpenPod={podHandlerFor(trk.id)}
                              />
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default BoardGrid;
