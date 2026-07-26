import React, { useState, useEffect } from 'react';
import { Truck, Calendar, Clock, MapPin, CheckCircle2, AlertTriangle, FileText, User } from 'lucide-react';
import StatusPill from './StatusPill';

const DAYS_OF_WEEK = [
  { name: 'Mon', short: 'Mon', index: 1 },
  { name: 'Tue', short: 'Tue', index: 2 },
  { name: 'Wed', short: 'Wed', index: 3 },
  { name: 'Thu', short: 'Thu', index: 4 },
  { name: 'Fri', short: 'Fri', index: 5 }
];

const DriverView = ({
  trucks = [],
  deliveries = [],
  weekDates = [],
  currentUser = null,
  onUpdateStatus
}) => {
  const todayStr = new Date().toISOString().split('T')[0];

  // Auto-detect truck assigned to current logged-in driver user
  const getAssignedTruck = () => {
    if (!trucks || trucks.length === 0) return null;
    const match = trucks.find(t => {
      const dName = (t.driver || '').toLowerCase();
      const tName = (t.name || '').toLowerCase();
      const uName = (currentUser?.name || '').toLowerCase();
      const uUsername = (currentUser?.username || '').toLowerCase();
      return (
        (uName && (dName === uName || tName === uName)) ||
        (uUsername && (dName === uUsername || tName === uUsername)) ||
        t.id === currentUser?.id ||
        t.id === currentUser?._id
      );
    });
    return match || trucks[0];
  };

  const initialTruck = getAssignedTruck();
  const initialDate = weekDates.includes(todayStr) ? todayStr : (weekDates[0] || todayStr);

  const [selectedTruckId, setSelectedTruckId] = useState(initialTruck?.id || 'trk_1');
  const [selectedDate, setSelectedDate] = useState(initialDate);

  // Sync selectedDate when weekDates changes
  useEffect(() => {
    if (weekDates && weekDates.length > 0 && !weekDates.includes(selectedDate)) {
      const fallbackDate = weekDates.includes(todayStr) ? todayStr : weekDates[0];
      setSelectedDate(fallbackDate);
    }
  }, [weekDates, todayStr]);

  // Sync selectedTruckId when trucks or currentUser changes
  useEffect(() => {
    const assigned = getAssignedTruck();
    if (assigned && assigned.id !== selectedTruckId) {
      setSelectedTruckId(assigned.id);
    }
  }, [currentUser, trucks]);

  const currentTruck = trucks.find(t => t.id === selectedTruckId) || trucks[0];

  // Robust delivery matching by truckId, truck name, or driver name
  const driverDeliveries = deliveries.filter(d => {
    const matchesDate = d.date === selectedDate;
    if (!matchesDate) return false;

    const matchesTruckId = d.truckId === selectedTruckId || (currentTruck && d.truckId === currentTruck.id);
    const matchesDriverName = currentTruck && (
      (d.driver && d.driver.toLowerCase() === (currentTruck.driver || '').toLowerCase()) ||
      (d.truckName && d.truckName.toLowerCase() === (currentTruck.name || '').toLowerCase())
    );

    return matchesTruckId || matchesDriverName;
  });

  return (
    <div className="driver-view-container mobile-first">
      {/* Row 1: Day Selector Tabs (Mon-Fri) */}
      <div className="driver-day-tabs">
        {DAYS_OF_WEEK.map((day, idx) => {
          const dateStr = weekDates[idx] || '';
          const isSelected = selectedDate === dateStr;
          const isToday = dateStr === todayStr;

          return (
            <button
              key={day.short}
              type="button"
              className={`driver-tab-btn ${isSelected ? 'active' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => setSelectedDate(dateStr)}
            >
              <span className="tab-day-name">{day.name}</span>
              <span className="tab-day-date">{dateStr ? dateStr.slice(5) : ''}</span>
            </button>
          );
        })}
      </div>

      {/* Row 2: Drivers / Trucks Selector Bar */}
      {trucks.length > 0 && (
        <div className="driver-horizontal-row-bar">
          <div className="row-bar-title">
            <Truck size={18} className="truck-icon-gold" />
            <span>Assigned Driver / Truck:</span>
          </div>
          <div className="driver-pills-row">
            {trucks.map(trk => {
              const isSelected = trk.id === selectedTruckId;
              return (
                <button
                  key={trk.id}
                  type="button"
                  className={`driver-single-pill ${isSelected ? 'active' : ''}`}
                  style={{ borderLeftColor: trk.color || '#D4AF37' }}
                  onClick={() => setSelectedTruckId(trk.id)}
                >
                  <div className="pill-color-dot" style={{ background: trk.color || '#D4AF37' }} />
                  <div className="pill-text-wrap">
                    <span className="pill-driver-name">{trk.driver}</span>
                    <span className="pill-truck-name">{trk.name}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Deliveries List for Driver */}
      <div className="driver-stops-list">
        <div className="driver-stops-header">
          <h3>
            Stops for {currentTruck?.driver || currentTruck?.name || 'Driver'} — {selectedDate}
          </h3>
          <span className="stops-count-badge">{driverDeliveries.length} Stops</span>
        </div>

        {driverDeliveries.length === 0 ? (
          <div className="empty-stops-placeholder">
            <Truck size={36} className="empty-truck-icon" />
            <p>No delivery stops scheduled for this day ({selectedDate}).</p>
          </div>
        ) : (
          <div className="driver-cards-grid">
            {driverDeliveries.map((del, index) => (
              <div
                key={del.id}
                className="driver-stop-card"
                style={{ borderLeftColor: currentTruck?.color || '#D4AF37' }}
              >
                <div className="stop-card-header">
                  <span className="stop-number">Stop #{index + 1}</span>
                  <span className="stop-time">
                    <Clock size={13} /> {del.time}
                  </span>
                  <StatusPill status={del.status} size="small" />
                </div>

                <h4 className="stop-customer">{del.customerName}</h4>

                <div className="stop-address">
                  <MapPin size={15} />
                  <span>{del.address}</span>
                </div>

                {del.notes && (
                  <div className="stop-notes-box">
                    <FileText size={13} />
                    <span>{del.notes}</span>
                  </div>
                )}

                <div className="stop-sales-rep">
                  <User size={12} /> Rep: {del.salesRepName || 'Sales Rep'}
                </div>

                {/* Driver Quick Action Buttons */}
                <div className="driver-action-buttons">
                  <button
                    type="button"
                    className="btn-action-late"
                    onClick={() => onUpdateStatus && onUpdateStatus(del.id, 'delayed')}
                    disabled={del.status === 'delayed'}
                  >
                    <AlertTriangle size={15} />
                    <span>Running Late</span>
                  </button>

                  <button
                    type="button"
                    className="btn-action-delivered"
                    onClick={() => onUpdateStatus && onUpdateStatus(del.id, 'completed')}
                    disabled={del.status === 'completed'}
                  >
                    <CheckCircle2 size={15} />
                    <span>Delivered</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DriverView;
