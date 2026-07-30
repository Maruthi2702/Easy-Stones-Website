import React, { useState } from 'react';
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
  // Default viewMode: 'table' (Dispatch Matrix) for Laptop/Desktop (>= 1024px), 'cards' (Cards View) for Mobile/iPad (< 1024px)
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024 ? 'table' : 'cards';
    }
    return 'table';
  });
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
      d.salesRepName?.toLowerCase().includes(q)
    );
  });

  const getDeliveriesForCell = (truckId, dateStr) =>
    filteredDeliveries.filter(d => d.truckId === truckId && d.date === dateStr);

  const getRawCapacity = (truckId, dateStr) =>
    deliveries.filter(d => d.truckId === truckId && d.date === dateStr).length;

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

  return (
    <div className="manifest-board-wrapper">
      <div className="view-switcher-bar" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem', gap: '0.5rem' }}>
        <button
          type="button"
          className={`btn-view-toggle ${viewMode === 'cards' ? 'active' : ''}`}
          onClick={() => setViewMode('cards')}
          title="Switch to Cards View"
        >
          <LayoutGrid size={14} />
          <span>Cards View</span>
        </button>
        <button
          type="button"
          className={`btn-view-toggle ${viewMode === 'table' ? 'active' : ''}`}
          onClick={() => setViewMode('table')}
          title="Switch to Dispatch Matrix"
        >
          <Calendar size={14} />
          <span>Dispatch Matrix</span>
        </button>
      </div>

      {viewMode === 'cards' ? (
        /* ── SCREENSHOT DESIGN LAYOUT ── */
        <div className="screenshot-schedule-card">

          {/* Day Selector Pills Row */}
          <div className="screenshot-day-pills">
            {DAYS_OF_WEEK.map((dayObj, idx) => {
              const dateStr = weekDates[idx] || '';
              const isSelected = selectedDate === dateStr;
              const isToday = dateStr === todayStr;
              const pillLabel = getPillTabLabel(dayObj.short, dateStr);
              const dayStopsCount = deliveries.filter(d => d.date === dateStr).length;

              return (
                <button
                  key={dayObj.short}
                  type="button"
                  className={`screenshot-pill-btn ${isSelected ? 'active' : ''} ${isToday ? 'is-today' : ''}`}
                  onClick={() => setSelectedDate(dateStr)}
                >
                  <span className="pill-label-text">{pillLabel}</span>
                  {dayStopsCount > 0 && <span className="pill-count-dot">{dayStopsCount}</span>}
                </button>
              );
            })}
          </div>

          {/* Subheader summary text */}
          <div className="screenshot-subtext">
            {trucks.length} {trucks.length === 1 ? 'truck' : 'trucks'} · {totalStopsSelectedDay} {totalStopsSelectedDay === 1 ? 'stop' : 'stops'} scheduled
          </div>

          {/* Driver Cards List */}
          <div className="screenshot-driver-list">
            {trucks.map(trk => {
              const trkDeliveries = getDeliveriesForCell(trk.id, selectedDate);
              const capCount = getRawCapacity(trk.id, selectedDate);

              return (
                <div
                  key={trk.id}
                  className="screenshot-driver-card"
                  style={{ borderLeftColor: trk.color || '#D4AF37' }}
                >
                  {/* Card Header Row */}
                  <div className="driver-card-header">
                    <div className="driver-name-wrap">
                      <span className="driver-color-dot" style={{ background: trk.color || '#D4AF37' }} />
                      <span className="driver-name-text">{trk.driver || trk.name}</span>
                    </div>

                    <div className="card-top-right">
                      <span className={`capacity-badge ${capCount > 0 ? 'has-stops' : 'empty'}`}>
                        {capCount}/{MAX_TRUCK_CAPACITY}
                      </span>
                      {editable && (
                        <button
                          type="button"
                          className="btn-card-add-stop"
                          onClick={() => onAddDelivery && onAddDelivery(trk.id, selectedDate)}
                          title={`Add stop for ${trk.driver}`}
                        >
                          <Plus size={14} /> Add stop
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Card Content Body */}
                  {trkDeliveries.length === 0 ? (
                    <div className="no-stops-subtext">No stops scheduled</div>
                  ) : (
                    <div className="stops-items-list">
                      {trkDeliveries.map((del, idx) => (
                        <div
                          key={del.id}
                          className="screenshot-stop-item"
                          onClick={() => onEditDelivery && onEditDelivery(del)}
                          title={editable ? "Click to edit delivery ticket" : del.customerName}
                        >
                          <div className="stop-item-top">
                            <span className="stop-time">
                              <Clock size={13} style={{ marginRight: '5px', opacity: 0.85 }} />
                              {del.time || '09:00 AM'}
                            </span>
                            <span className={`stop-status-badge ${del.status || 'scheduled'}`}>
                              {del.status === 'completed' || del.status === 'delivered' ? (
                                <><CheckCircle2 size={11} style={{ marginRight: '3px' }} /> COMPLETED</>
                              ) : del.status === 'delayed' ? (
                                <><AlertTriangle size={11} style={{ marginRight: '3px' }} /> DELAYED</>
                              ) : (
                                <><Clock size={11} style={{ marginRight: '3px' }} /> SCHEDULED</>
                              )}
                            </span>
                          </div>

                          <h4 className="stop-customer-title">{del.customerName}</h4>

                          {del.address && (
                            <div className="stop-location-text">
                              <MapPin size={13} style={{ marginRight: '5px', opacity: 0.75 }} />
                              {del.address}
                            </div>
                          )}

                          {(del.salesRepName || del.notes) && (
                            <div className="stop-meta-footer">
                              {del.salesRepName && (
                                <span className="stop-rep-badge">
                                  <User size={11} /> {del.salesRepName}
                                </span>
                              )}
                              {del.notes && (
                                <span className="stop-notes-badge" title={del.notes}>
                                  <FileText size={11} /> Notes
                                </span>
                              )}
                            </div>
                          )}
                        </div>
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
                {trucks.map(trk => (
                  <th
                    key={trk.id}
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

                    {trucks.map(trk => {
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
