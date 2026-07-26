import React, { useState } from 'react';
import { Plus, Search, Filter, Calendar, Truck, User, AlertCircle, Edit2 } from 'lucide-react';
import TicketChip from './TicketChip';
import { MAX_TRUCK_CAPACITY } from '../../../api/schedule';

const DAYS_OF_WEEK = [
  { name: 'Monday', short: 'Mon', index: 1 },
  { name: 'Tuesday', short: 'Tue', index: 2 },
  { name: 'Wednesday', short: 'Wed', index: 3 },
  { name: 'Thursday', short: 'Thu', index: 4 },
  { name: 'Friday', short: 'Fri', index: 5 }
];

const BoardGrid = ({
  trucks = [],
  deliveries = [],
  weekDates = [],
  searchQuery = '',
  editable = false,
  onAddDelivery,
  onEditDelivery,
  onUpdateTruck
}) => {
  const [internalSearch, setInternalSearch] = useState('');
  const activeSearch = searchQuery || internalSearch;
  const [editingTruckId, setEditingTruckId] = useState(null);
  const [tempTruckName, setTempTruckName] = useState('');
  const [tempDriverName, setTempDriverName] = useState('');

  // Filter deliveries based on search query
  const filteredDeliveries = deliveries.filter(d => {
    if (!activeSearch.trim()) return true;
    const q = activeSearch.toLowerCase().trim();
    return (
      d.customerName?.toLowerCase().includes(q) ||
      d.address?.toLowerCase().includes(q) ||
      d.salesRepName?.toLowerCase().includes(q)
    );
  });

  const getDeliveriesForCell = (truckId, dateStr) => {
    return filteredDeliveries.filter(d => d.truckId === truckId && d.date === dateStr);
  };

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
    if (onUpdateTruck) {
      onUpdateTruck(trkId, tempTruckName, tempDriverName);
    }
    setEditingTruckId(null);
  };

  const formatDaySubtext = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isToday = dateStr === new Date().toISOString().split('T')[0];
    return isToday ? `${formatted} · today` : formatted;
  };

  if (trucks.length === 0) {
    return (
      <div className="manifest-empty-state">
        <Truck size={40} className="empty-truck-icon" />
        <h3>No drivers assigned to this location</h3>
        <p>Add users with the <strong>Driver</strong> role in <strong>Users &amp; Roles</strong> and assign them to this location.</p>
      </div>
    );
  }

  return (
    <div className="manifest-board-wrapper">
      {/* Dispatch Board Grid Container — Days as Rows, Trucks/Drivers as Columns */}
      <div className="board-grid-scroll-container">
        <table className="manifest-dispatch-table">
          <thead>
            <tr>
              <th className="day-col-header-row">
                <div className="th-day-inner">
                  <span>Day</span>
                </div>
              </th>
              {trucks.map(trk => (
                <th key={trk.id} className="truck-col-header">
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
                        <span className="truck-name">{trk.name}</span>
                        <span className="truck-driver">{trk.driver}</span>
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
                  {/* Day Info Cell (Row Title) */}
                  <td className={`day-info-cell ${isToday ? 'today-cell' : ''}`}>
                    <div className="day-label-wrap">
                      <span className="day-name">{dayObj.name}</span>
                      <span className="day-date">{formatDaySubtext(dateStr)}</span>
                    </div>
                  </td>

                  {/* Truck Columns for this Day */}
                  {trucks.map(trk => {
                    const cellDeliveries = getDeliveriesForCell(trk.id, dateStr);
                    const count = cellDeliveries.length;
                    const capClass = getCapacityColorClass(count);

                    return (
                      <td key={trk.id} className="dispatch-cell">
                        <div className="cell-header-bar">
                          <span className={`cell-capacity-pill ${capClass}`} title={`${count} of ${MAX_TRUCK_CAPACITY} deliveries booked`}>
                            {count}/{MAX_TRUCK_CAPACITY}
                          </span>

                          {editable && (
                            <button
                              type="button"
                              className="cell-add-btn"
                              onClick={() => onAddDelivery && onAddDelivery(trk.id, dateStr)}
                              title={`Add delivery to ${trk.name} on ${dayObj.name}`}
                            >
                              <Plus size={14} />
                            </button>
                          )}
                        </div>

                        {/* Ticket Cards List */}
                        <div className="cell-tickets-list">
                          {cellDeliveries.map(del => (
                            <TicketChip
                              key={del.id}
                              delivery={del}
                              truckColor={trk.color}
                              onClick={onEditDelivery}
                              editable={editable}
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
    </div>
  );
};

export default BoardGrid;
