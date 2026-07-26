import React, { useState } from 'react';
import { Plus, Edit2 } from 'lucide-react';
import TicketChip from './TicketChip';
import { MAX_TRUCK_CAPACITY } from '../../../api/schedule';

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
  userLocation = null,        // ← new: filter deliveries by location
  onAddDelivery,
  onEditDelivery,
  onUpdateTruck
}) => {
  const [internalSearch] = useState('');
  const activeSearch = searchQuery || internalSearch;
  const [editingTruckId, setEditingTruckId] = useState(null);
  const [tempTruckName, setTempTruckName] = useState('');
  const [tempDriverName, setTempDriverName] = useState('');

  // Filter deliveries: by search query AND by location (if provided)
  const filteredDeliveries = deliveries.filter(d => {
    // Location filter — skip if no filter or delivery has no location
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

  // All deliveries for a cell (ignoring search) for capacity calculation
  const getRawCapacity = (truckId, dateStr) =>
    deliveries.filter(d => d.truckId === truckId && d.date === dateStr).length;

  const getCapacityColorClass = (count) => {
    if (count >= MAX_TRUCK_CAPACITY) return 'capacity-alert-red';
    if (count >= MAX_TRUCK_CAPACITY - 2) return 'capacity-warn-amber';
    return 'capacity-ok-green';
  };

  const handleStartEditTruck = (trk) => {
    if (!editable) return;
    setEditingTruckId(trk.id);
    setTempTruckName(trk.name);
    setTempDriverName(trk.driver);
  };

  const handleSaveTruck = (trkId) => {
    if (onUpdateTruck) onUpdateTruck(trkId, tempTruckName, tempDriverName);
    setEditingTruckId(null);
  };

  const formatDaySubtext = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isToday = dateStr === new Date().toISOString().split('T')[0];
    return isToday ? `${formatted} · today` : formatted;
  };

  // Weekly totals per truck
  const getWeeklyTotal = (truckId) =>
    deliveries.filter(d => d.truckId === truckId && weekDates.includes(d.date)).length;

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
                  {editingTruckId === trk.id ? (
                    <div className="truck-edit-inline">
                      <input
                        type="text"
                        value={tempTruckName}
                        onChange={(e) => setTempTruckName(e.target.value)}
                        placeholder="Truck Name"
                        className="truck-input-sm"
                      />
                      <input
                        type="text"
                        value={tempDriverName}
                        onChange={(e) => setTempDriverName(e.target.value)}
                        placeholder="Driver Name"
                        className="truck-input-sm"
                      />
                      <button
                        type="button"
                        className="btn-save-truck-sm"
                        onClick={() => handleSaveTruck(trk.id)}
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <div className="truck-label-wrap" onClick={() => handleStartEditTruck(trk)}>
                      <div className="truck-color-dot" style={{ background: trk.color || '#D4AF37' }} />
                      <div className="truck-text-details">
                        <span className="truck-name">{trk.driver}</span>
                        <span className="truck-driver">{trk.name}</span>
                      </div>
                      {editable && <Edit2 size={12} className="edit-truck-icon" />}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {DAYS_OF_WEEK.map((dayObj, idx) => {
              const dateStr = weekDates[idx] || '';
              const isToday = dateStr === new Date().toISOString().split('T')[0];

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

          {/* Weekly totals footer row */}
          <tfoot>
            <tr className="weekly-totals-row">
              <td className="totals-label-cell">Week Total</td>
              {trucks.map(trk => {
                const total = getWeeklyTotal(trk.id);
                const weekMax = MAX_TRUCK_CAPACITY * 5;
                return (
                  <td key={trk.id} className="totals-count-cell">
                    <span
                      className={`week-total-pill ${total >= weekMax ? 'capacity-alert-red' : total >= weekMax * 0.75 ? 'capacity-warn-amber' : 'capacity-ok-green'}`}
                    >
                      {total} / {weekMax}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default BoardGrid;
