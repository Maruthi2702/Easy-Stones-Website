import React, { useState, useEffect } from 'react';
import { Truck, Clock, MapPin, CheckCircle2, AlertTriangle, FileText, User } from 'lucide-react';
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
    const uName = (currentUser?.name || '').toLowerCase();
    const uUsername = (currentUser?.username || '').toLowerCase();

    if (trucks && trucks.length > 0 && (uName || uUsername)) {
      const match = trucks.find(t => {
        const dName = (t.driver || '').toLowerCase();
        const tName = (t.name || '').toLowerCase();
        return (
          (uName && (dName === uName || tName === uName)) ||
          (uUsername && (dName === uUsername || tName === uUsername)) ||
          t.id === currentUser?.id ||
          t.id === currentUser?._id
        );
      });
      if (match) return match;
    }

    // If logged-in user has driver role, create/use their driver profile
    if (currentUser) {
      return {
        id: currentUser._id || currentUser.id || `drv_${currentUser.username}`,
        name: currentUser.name || currentUser.username,
        driver: currentUser.name || currentUser.username,
        color: '#D4AF37'
      };
    }

    return trucks[0] || { id: 'trk_1', name: 'Driver Truck', driver: 'Driver', color: '#D4AF37' };
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

  const currentTruck = trucks.find(t => t.id === selectedTruckId) || initialTruck;

  // Strict delivery matching for current logged in driver
  const isDeliveryMatchingTruck = (d, trk) => {
    if (!d) return false;
    const dTruckId = String(d.truckId || '');
    const trkId = String(trk?.id || '');
    const trkDriver = String(trk?.driver || '').toLowerCase();
    const trkName = String(trk?.name || '').toLowerCase();
    const dDriver = String(d.driver || '').toLowerCase();
    const dTruckName = String(d.truckName || '').toLowerCase();

    const uName = String(currentUser?.name || '').toLowerCase();
    const uUsername = String(currentUser?.username || '').toLowerCase();
    const uId = String(currentUser?._id || currentUser?.id || '');

    const matchesTruck = (trkId && dTruckId === trkId) ||
      (dDriver && trkDriver && dDriver === trkDriver) ||
      (dTruckName && trkName && dTruckName === trkName);

    const matchesUser = (uName && dDriver === uName) ||
      (uUsername && dDriver === uUsername) ||
      (uId && dTruckId === uId);

    return matchesTruck || matchesUser;
  };

  const isDeliveryMatchingDate = (d, targetDate) => {
    if (!d || !d.date) return false;
    const delDateStr = String(d.date).slice(0, 10);
    const targetDateStr = String(targetDate).slice(0, 10);
    return delDateStr === targetDateStr;
  };

  // Filter deliveries ONLY for this driver
  const driverDeliveries = deliveries.filter(d =>
    isDeliveryMatchingTruck(d, currentTruck) && isDeliveryMatchingDate(d, selectedDate)
  );

  const getStopsCountForDay = (dateStr) => {
    return deliveries.filter(d =>
      isDeliveryMatchingTruck(d, currentTruck) && isDeliveryMatchingDate(d, dateStr)
    ).length;
  };

  // Check if driver has scheduled stops on ANY other day this week
  const findOtherDaysWithStops = () => {
    return weekDates.filter(dStr => dStr !== selectedDate && getStopsCountForDay(dStr) > 0);
  };

  const otherDaysWithStops = findOtherDaysWithStops();
  const driverDisplayName = currentUser?.name || currentTruck?.driver || currentTruck?.name || 'Driver';

  return (
    <div className="driver-view-container mobile-first">
      {/* Row 1: Day Selector Tabs (Mon-Fri) with Stop Counts */}
      <div className="driver-day-tabs">
        {DAYS_OF_WEEK.map((day, idx) => {
          const dateStr = weekDates[idx] || '';
          const isSelected = selectedDate === dateStr;
          const isToday = dateStr === todayStr;
          const count = getStopsCountForDay(dateStr);

          return (
            <button
              key={day.short}
              type="button"
              className={`driver-tab-btn ${isSelected ? 'active' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => setSelectedDate(dateStr)}
            >
              <span className="tab-day-name">
                {day.name} {count > 0 ? `(${count})` : ''}
              </span>
              <span className="tab-day-date">{dateStr ? dateStr.slice(5) : ''}</span>
            </button>
          );
        })}
      </div>

      {/* Deliveries List for Driver */}
      <div className="driver-stops-list">
        <div className="driver-stops-header">
          <h3>
            Stops for {driverDisplayName} — {selectedDate}
          </h3>
          <span className="stops-count-badge">{driverDeliveries.length} Stops</span>
        </div>

        {driverDeliveries.length === 0 ? (
          <div className="empty-stops-placeholder">
            <Truck size={36} className="empty-truck-icon" />
            <p>No delivery stops scheduled for this day ({selectedDate}).</p>
            {otherDaysWithStops.length > 0 && (
              <div className="other-days-notice" style={{ marginTop: '0.85rem' }}>
                <span style={{ fontSize: '0.85rem', color: '#d4af37' }}>
                  Stops scheduled on other days this week:
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {otherDaysWithStops.map(dStr => (
                    <button
                      key={dStr}
                      type="button"
                      onClick={() => setSelectedDate(dStr)}
                      style={{
                        background: 'linear-gradient(135deg, #d4af37, #c5a028)',
                        color: '#000000',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.4rem 0.85rem',
                        fontSize: '0.82rem',
                        fontWeight: '700',
                        cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(212, 175, 55, 0.25)'
                      }}
                    >
                      {dStr} ({getStopsCountForDay(dStr)} stops)
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                    <Clock size={14} /> {del.time || '09:00 AM'}
                  </span>
                  <StatusPill status={del.status} size="small" />
                </div>

                <h4 className="stop-customer">{del.customerName}</h4>

                <div className="stop-address">
                  <MapPin size={15} />
                  <span>{del.address || 'Address not provided'}</span>
                </div>

                {del.notes && (
                  <div className="stop-notes-box">
                    <FileText size={14} />
                    <span>{del.notes}</span>
                  </div>
                )}

                {del.salesRepName && (
                  <div className="stop-sales-rep">
                    <User size={13} /> Rep: {del.salesRepName}
                  </div>
                )}

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
