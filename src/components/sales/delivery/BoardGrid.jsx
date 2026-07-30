import React, { useState, useEffect, useRef } from 'react';
import { Plus, LayoutGrid, Calendar, Clock, MapPin, CheckCircle2, AlertTriangle, User, FileText } from 'lucide-react';
import TicketChip from './TicketChip';
import { MAX_TRUCK_CAPACITY } from '../../../api/schedule';
import { formatForDateInput } from '../../../utils/dateUtils';

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
  weekDates = [],
  searchQuery = '',
  editable = false,
  userLocation = null,
  onAddDelivery,
  onEditDelivery,
  onUpdateTruck
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

  // Filter deliveries by search query & location
  const filteredDeliveries = deliveries.filter(d => {
    if (userLocation && d.location && d.location !== userLocation) return false;
    if (!activeSearch.trim()) return true;
    const q = activeSearch.toLowerCase().trim();
    return (
      d.customerName?.toLowerCase().includes(q) ||
      d.address?.toLowerCase().includes(q) ||
      d.salesRepName?.toLowerCase().includes(q) ||
      d.soNumber?.toLowerCase().includes(q) ||
      d.invoiceNumber?.toLowerCase().includes(q)
    );
  });

  // Pre-index deliveries by `${truckId}_${date}` in O(N) for optimal rendering performance
  const cellMap = React.useMemo(() => {
    const map = new Map();
    for (const d of filteredDeliveries) {
      const key = `${d.truckId || ''}_${d.date}`;
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
    const hasUnassigned = deliveries.some(d => !d.truckId || d.truckId === '' || d.truckId === 'unassigned');
    if (hasUnassigned) {
      return [
        { id: '', name: 'Unassigned', driver: 'Unassigned', color: '#94A3B8' },
        ...trucks
      ];
    }
    return trucks;
  }, [trucks, deliveries]);

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

  // Helper for screenshot pill tab label e.g., "Mon 27"
  const getPillTabLabel = (dayShort, dateStr) => {
    if (!dateStr) return dayShort;
    const parts = dateStr.split('-');
    if (parts.length < 3) return dayShort;
    const dayNum = parseInt(parts[2], 10);
    return `${dayShort} ${dayNum}`;
  };

  const totalStopsSelectedDay = deliveries.filter(d => d.date === selectedDate).length;

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

  const pillsRef = React.useRef(null);

  useEffect(() => {
    if (pillsRef.current) {
      const activePill = pillsRef.current.querySelector('.screenshot-pill-btn.active');
      if (activePill) {
        activePill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [selectedDate]);

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
                      <span className={`ux-capacity-badge ${capCount > 0 ? 'has-stops' : 'empty'}`}>
                        {capCount}/{MAX_TRUCK_CAPACITY}
                      </span>
                      {editable && (
                        <button
                          type="button"
                          className="ux-btn-add-stop"
                          onClick={() => onAddDelivery && onAddDelivery(trk.id, selectedDate)}
                          title={`Add stop for ${trk.driver}`}
                        >
                          <Plus size={14} /> Add stop
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Driver Delivery Ticket Cards */}
                  {trkDeliveries.length === 0 ? (
                    <div className="ux-no-stops-text">No stops scheduled</div>
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
          <table className="manifest-dispatch-table">
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

                      return (
                        <td key={trk.id} className="dispatch-cell">
                          <div className="cell-header-bar">
                            <span
                              className={`cell-capacity-pill ${capClass}`}
                              title={`${rawCount} of ${MAX_TRUCK_CAPACITY} deliveries booked`}
                            >
                              {rawCount}/{MAX_TRUCK_CAPACITY}
                            </span>
                            {editable && (
                              <button
                                type="button"
                                className="cell-add-btn"
                                onClick={() => onAddDelivery && onAddDelivery(trk.id, dateStr)}
                                title={`Add delivery — ${trk.driver} on ${dayObj.name}`}
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
