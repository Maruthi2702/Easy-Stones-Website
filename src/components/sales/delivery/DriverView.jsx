import React, { useState, useEffect } from 'react';
import { Truck, Clock, MapPin, CheckCircle2, AlertTriangle, FileText, Package, Hash, ChevronLeft, ChevronRight, Navigation, Copy, Check, User } from 'lucide-react';
import { MAX_TRUCK_CAPACITY } from '../../../api/schedule';
import { formatForDateInput } from '../../../utils/dateUtils';
import StatusPill from './StatusPill';

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
  onUpdateStatus,
  onOpenPod,
  onViewPod,
  onPrevWeek,
  onNextWeek,
  onTodayWeek,
  weekRangeText = ''
}) => {
  const todayStr = formatForDateInput(new Date());

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
  const [currentTruck, setCurrentTruck] = useState(initialTruck);
  const [selectedDate, setSelectedDate] = useState(todayStr);

  useEffect(() => {
    setCurrentTruck(getAssignedTruck());
  }, [currentUser, trucks]);

  useEffect(() => {
    if (weekDates.length > 0 && !weekDates.includes(selectedDate)) {
      setSelectedDate(weekDates[0]);
    }
  }, [weekDates]);

  const isDeliveryMatchingTruck = (del, trk) => {
    if (!del || !trk) return false;
    if (del.truckId && String(del.truckId) === String(trk.id)) return true;
    if (del.truckDriver && trk.driver && del.truckDriver.toLowerCase() === trk.driver.toLowerCase()) return true;
    if (del.assignedDriver && trk.driver && del.assignedDriver.toLowerCase() === trk.driver.toLowerCase()) return true;
    if (del.driverName && trk.driver && del.driverName.toLowerCase() === trk.driver.toLowerCase()) return true;
    return false;
  };

  const isDeliveryMatchingDate = (d, targetDate) => {
    if (!d || !d.date) return false;
    return String(d.date).slice(0, 10) === String(targetDate).slice(0, 10);
  };

  const driverDeliveries = deliveries
    .filter(d => isDeliveryMatchingTruck(d, currentTruck) && isDeliveryMatchingDate(d, selectedDate))
    .sort((a, b) => (a.routeNumber || 1) - (b.routeNumber || 1));

  const getStopsCountForDay = (dateStr) =>
    deliveries.filter(d => isDeliveryMatchingTruck(d, currentTruck) && isDeliveryMatchingDate(d, dateStr)).length;

  const otherDaysWithStops = weekDates.filter(dStr => dStr !== selectedDate && getStopsCountForDay(dStr) > 0);
  const driverDisplayName = currentUser?.name || currentTruck?.driver || currentTruck?.name || 'Driver';
  const completedCount = driverDeliveries.filter(d => d.status === 'completed').length;

  return (
    <div className="driver-view-container driver-mode">

      {/* Day Selector Pills Bar (100% Identical to Office View ux-day-pills-bar) */}
      <div className="ux-day-pills-bar">
        {DAYS_OF_WEEK.map((dayObj, idx) => {
          const dateStr = weekDates[idx] || '';
          const isSelected = selectedDate === dateStr;
          const isToday = dateStr === todayStr;
          const count = getStopsCountForDay(dateStr);
          const dayNum = dateStr ? dateStr.split('-')[2] : '';
          const subtext = isSelected ? 'Active' : (count === 1 ? '1 stop' : `${count} stops`);

          return (
            <button
              key={dayObj.short}
              type="button"
              className={`ux-day-pill-card ${isSelected ? 'active' : ''} ${isToday ? 'is-today' : ''}`}
              onClick={() => setSelectedDate(dateStr)}
            >
              <span className="ux-pill-day-name">{dayObj.short.toUpperCase()}</span>
              <span className="ux-pill-date-num">{dayNum}</span>
              <span className="ux-pill-stops-count">{subtext}</span>
            </button>
          );
        })}
      </div>

      {/* Summary subtext line */}
      <div className="screenshot-subtext">
        {driverDeliveries.length === 0
          ? 'No stops scheduled for this day'
          : `${driverDeliveries.length} stop${driverDeliveries.length !== 1 ? 's' : ''} · ${completedCount} delivered`}
      </div>

      {/* Truck Section Card (identical to Office View .ux-driver-card) */}
      <div className="screenshot-driver-list">
        <div className="ux-driver-card" style={{ borderLeftColor: currentTruck?.color || '#D4AF37' }}>
          
          {/* Driver Header */}
          <div className="ux-driver-header">
            <div className="ux-driver-name-wrap">
              <span className="ux-driver-dot" style={{ background: currentTruck?.color || '#D4AF37' }} />
              <span className="ux-driver-name">{driverDisplayName}</span>
            </div>
            <div className="ux-driver-actions">
              <span className={`ux-capacity-badge ${driverDeliveries.length > 0 ? 'has-stops' : 'empty'}`}>
                {completedCount}/{driverDeliveries.length || MAX_TRUCK_CAPACITY}
              </span>
            </div>
          </div>

          {/* Stops List */}
          {driverDeliveries.length === 0 ? (
            <div className="no-stops-container">
              <Package size={36} style={{ color: 'var(--text-muted, #606060)', marginBottom: '0.75rem', opacity: 0.5 }} />
              <div className="no-stops-subtext">No deliveries scheduled for this day</div>
              {otherDaysWithStops.length > 0 && (
                <div className="other-days-subbar">
                  <span style={{ fontSize: '0.82rem', color: '#e6c25e' }}>You have stops on:</span>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                    {otherDaysWithStops.map(dStr => (
                      <button key={dStr} type="button" onClick={() => setSelectedDate(dStr)} className="btn-other-day-pill">
                        {dStr.slice(5)} ({getStopsCountForDay(dStr)} stop{getStopsCountForDay(dStr) !== 1 ? 's' : ''})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="stops-items-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {driverDeliveries.map((del, idx) => {
                const soVal = del.soNumber || del.invoiceNumber;
                const stopNum = del.routeNumber || (idx + 1);

                return (
                  <div
                    key={del.id}
                    className={`manifest-ticket-chip driver-stop-card-v2 status-border-${del.status || 'scheduled'}`}
                    style={{ borderLeftColor: currentTruck?.color || '#D4AF37' }}
                  >
                    {/* Top Row: Navigation + Stop # | SO# + Status Pill */}
                    <div className="ticket-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <span className="ticket-time-mono" style={{ fontSize: '0.8rem', color: '#d4af37', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Navigation size={12} /> Stop #{stopNum}
                        {soVal && (
                          <span style={{ color: '#b0b0b0', fontWeight: 600, marginLeft: 4 }}>
                            {' | SO# '}
                            <span style={{ color: '#ffffff' }}>{soVal}</span>
                          </span>
                        )}
                      </span>
                      <StatusPill status={del.status} size="small" />
                    </div>

                    {/* Customer Title */}
                    <h4 className="ticket-customer" style={{ margin: '0.2rem 0 0.4rem 0', fontSize: '1.05rem', fontWeight: 700, color: '#ffffff' }}>
                      {del.customerName}
                    </h4>

                    {/* Meta info: Address & Salesperson */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: '#b0b0b0', marginBottom: '0.75rem' }}>
                      {(del.city || del.address || del.location) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <MapPin size={13} style={{ color: '#808080' }} />
                          <span>{del.address || `${del.city || ''} ${del.location || ''}`.trim()}</span>
                        </div>
                      )}
                      {(del.salesperson || del.driver || currentUser?.name) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <User size={13} style={{ color: '#808080' }} />
                          <span>{del.salesperson || currentUser?.name || 'Assigned'}</span>
                        </div>
                      )}
                    </div>

                    {/* Driver Action Buttons */}
                    <div className="driver-action-buttons" style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '0.65rem' }}>
                      <button
                        type="button"
                        className="driver-btn driver-btn-late"
                        onClick={() => onUpdateStatus && onUpdateStatus(del.id, 'delayed')}
                        disabled={del.status === 'delayed'}
                      >
                        <AlertTriangle size={15} /> Running Late
                      </button>
                      <button
                        type="button"
                        className={`driver-btn driver-btn-delivered ${del.status === 'completed' ? 'signed' : ''}`}
                        onClick={() => {
                          if (del.status === 'completed' && onViewPod) {
                            onViewPod(del);
                          } else if (onOpenPod) {
                            onOpenPod(del);
                          }
                        }}
                      >
                        <CheckCircle2 size={15} />
                        <span>{del.status === 'completed' ? '✓ View ePOD' : 'Delivered / Sign ePOD'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>

    </div>
  );
};

export default DriverView;
