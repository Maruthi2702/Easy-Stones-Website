import React, { useState, useEffect } from 'react';
import { Truck, Clock, MapPin, CheckCircle2, AlertTriangle, FileText, User } from 'lucide-react';
import StatusPill from './StatusPill';
import { MAX_TRUCK_CAPACITY } from '../../../api/schedule';
import { formatForDateInput } from '../../../utils/dateUtils';

const DAYS_OF_WEEK = [
  { name: 'Monday',    short: 'Mon', index: 1 },
  { name: 'Tuesday',  short: 'Tue', index: 2 },
  { name: 'Wednesday',short: 'Wed', index: 3 },
  { name: 'Thursday', short: 'Thu', index: 4 },
  { name: 'Friday',   short: 'Fri', index: 5 }
];

const DriverView = ({
  trucks = [],
  deliveries = [],
  weekDates = [],
  currentUser = null,
  onUpdateStatus
}) => {
  const todayStr = formatForDateInput(new Date());

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

  useEffect(() => {
    if (weekDates && weekDates.length > 0 && !weekDates.includes(selectedDate)) {
      const fallbackDate = weekDates.includes(todayStr) ? todayStr : weekDates[0];
      setSelectedDate(fallbackDate);
    }
  }, [weekDates, todayStr]);

  useEffect(() => {
    const assigned = getAssignedTruck();
    if (assigned && assigned.id !== selectedTruckId) {
      setSelectedTruckId(assigned.id);
    }
  }, [currentUser, trucks]);

  const currentTruck = trucks.find(t => t.id === selectedTruckId) || initialTruck;

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

  const driverDeliveries = deliveries.filter(d =>
    isDeliveryMatchingTruck(d, currentTruck) && isDeliveryMatchingDate(d, selectedDate)
  );

  const getPillTabLabel = (dayShort, dateStr) => {
    if (!dateStr) return dayShort;
    const dayNum = dateStr.split('-')[2] || '';
    return `${dayShort} ${dayNum}`;
  };

  const getStopsCountForDay = (dateStr) => {
    return deliveries.filter(d =>
      isDeliveryMatchingTruck(d, currentTruck) && isDeliveryMatchingDate(d, dateStr)
    ).length;
  };

  const findOtherDaysWithStops = () => {
    return weekDates.filter(dStr => dStr !== selectedDate && getStopsCountForDay(dStr) > 0);
  };

  const otherDaysWithStops = findOtherDaysWithStops();
  const driverDisplayName = currentUser?.name || currentTruck?.driver || currentTruck?.name || 'Driver';

  return (
    <div className="screenshot-schedule-card driver-mode">
      <h2 className="this-week-title">This week</h2>

      {/* Day Selector Pills Row */}
      <div className="screenshot-day-pills">
        {DAYS_OF_WEEK.map((dayObj, idx) => {
          const dateStr = weekDates[idx] || '';
          const isSelected = selectedDate === dateStr;
          const pillLabel = getPillTabLabel(dayObj.short, dateStr);
          const count = getStopsCountForDay(dateStr);

              return (
                <button
                  key={dayObj.short}
                  type="button"
                  className={`screenshot-pill-btn ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedDate(dateStr)}
                >
                  <span className="pill-label-text">{pillLabel}</span>
                  {count > 0 && <span className="pill-count-dot">{count}</span>}
                </button>
              );
        })}
      </div>

      {/* Subheader summary text */}
      <div className="screenshot-subtext">
        {driverDisplayName} · {driverDeliveries.length} {driverDeliveries.length === 1 ? 'stop' : 'stops'} scheduled
      </div>

      {/* Driver Single Card */}
      <div className="screenshot-driver-list">
        <div
          className="screenshot-driver-card"
          style={{ borderLeftColor: currentTruck?.color || '#D4AF37' }}
        >
          {/* Card Header Row */}
          <div className="driver-card-header">
            <div className="driver-name-wrap">
              <span className="driver-color-dot" style={{ background: currentTruck?.color || '#D4AF37' }} />
              <span className="driver-name-text">{driverDisplayName}</span>
            </div>
            <span className={`capacity-badge ${driverDeliveries.length > 0 ? 'has-stops' : 'empty'}`}>
              {driverDeliveries.length}/{MAX_TRUCK_CAPACITY}
            </span>
          </div>

          {/* Card Content Body */}
          {driverDeliveries.length === 0 ? (
            <div className="no-stops-container">
              <div className="no-stops-subtext">No stops scheduled for {selectedDate}</div>
              {otherDaysWithStops.length > 0 && (
                <div className="other-days-subbar">
                  <span style={{ fontSize: '0.82rem', color: '#e6c25e' }}>Stops on other days this week:</span>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                    {otherDaysWithStops.map(dStr => (
                      <button
                        key={dStr}
                        type="button"
                        onClick={() => setSelectedDate(dStr)}
                        className="btn-other-day-pill"
                      >
                        {dStr.slice(5)} ({getStopsCountForDay(dStr)} stops)
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="stops-items-list">
              {driverDeliveries.map((del, idx) => (
                <div key={del.id} className="screenshot-stop-item">
                  <div className="stop-item-top">
                    <span className="stop-time">
                      <Clock size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      {del.time || '09:00 AM'}
                    </span>
                    <span className={`stop-status-badge ${del.status || 'scheduled'}`}>
                      {(del.status === 'completed' ? 'COMPLETE' : del.status || 'SCHEDULED').toUpperCase()}
                    </span>
                  </div>

                  <h4 className="stop-customer-title">{del.customerName}</h4>

                  {del.address && (
                    <div className="stop-location-text">
                      <MapPin size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      {del.address}
                    </div>
                  )}

                  {del.notes && (
                    <div className="driver-notes-box">
                      <FileText size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                      {del.notes}
                    </div>
                  )}

                  {/* Driver Quick Actions */}
                  <div className="driver-action-buttons" style={{ marginTop: '0.75rem' }}>
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
    </div>
  );
};

export default DriverView;
