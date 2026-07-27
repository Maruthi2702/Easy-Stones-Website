import React, { useState, useEffect } from 'react';
import { Clock, MapPin, CheckCircle2, AlertTriangle, FileText, User } from 'lucide-react';

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const DriverView = ({
  trucks = [],
  deliveries = [],
  weekDates = [],
  currentUser = null,
  onUpdateStatus
}) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const initialDate = weekDates.includes(todayStr) ? todayStr : (weekDates[0] || todayStr);
  const [selectedDate, setSelectedDate] = useState(initialDate);

  // Sync selectedDate when weekDates changes
  useEffect(() => {
    if (weekDates && weekDates.length > 0 && !weekDates.includes(selectedDate)) {
      const fallbackDate = weekDates.includes(todayStr) ? todayStr : weekDates[0];
      setSelectedDate(fallbackDate);
    }
  }, [weekDates, todayStr]);

  // Robust delivery matching helper (handles ISO timestamps, truckId, driver name)
  const isDeliveryMatchingTruck = (d, trk) => {
    if (!d || !trk) return false;
    const dTruckId = String(d.truckId || '');
    const trkId = String(trk.id || trk._id || '');
    const trkDriver = String(trk.driver || trk.name || '').toLowerCase();
    const dDriver = String(d.driver || '').toLowerCase();
    const dTruckName = String(d.truckName || '').toLowerCase();
    const trkName = String(trk.name || '').toLowerCase();

    return (
      (trkId && dTruckId === trkId) ||
      (dDriver && trkDriver && dDriver === trkDriver) ||
      (dTruckName && trkName && dTruckName === trkName)
    );
  };

  const isDeliveryMatchingDate = (d, targetDate) => {
    if (!d || !d.date) return false;
    const delDateStr = String(d.date).slice(0, 10);
    const targetDateStr = String(targetDate).slice(0, 10);
    return delDateStr === targetDateStr;
  };

  // Helper to format date string e.g. "Mon 21"
  const getFormattedDayLabel = (dateStr, idx) => {
    const dayName = DAYS_SHORT[idx] || 'Day';
    if (!dateStr) return `${dayName}`;
    const dayNum = dateStr.slice(8, 10);
    return `${dayName} ${parseInt(dayNum, 10) || dayNum}`;
  };

  // Get total stops scheduled across all trucks for the selected date
  const selectedDayDeliveries = deliveries.filter(d => isDeliveryMatchingDate(d, selectedDate));
  const totalStopsOnSelectedDay = selectedDayDeliveries.length;

  // Identify current logged-in driver's truck ID if applicable
  const currentLoggedDriverName = (currentUser?.name || currentUser?.username || '').toLowerCase();

  // If trucks list is empty, build default list from drivers
  const displayTrucks = trucks && trucks.length > 0 ? trucks : [
    { id: 'trk_1', name: 'Sergio', driver: 'Sergio', color: '#D4AF37' },
    { id: 'trk_2', name: 'Rene', driver: 'Rene', color: '#2F8F73' },
    { id: 'trk_3', name: 'Luis', driver: 'Luis', color: '#E1602A' },
    { id: 'trk_4', name: 'Marco', driver: 'Marco', color: '#3B82F6' }
  ];

  // Sort trucks so the logged-in driver appears at the top if logged in
  const sortedTrucks = [...displayTrucks].sort((a, b) => {
    if (!currentLoggedDriverName) return 0;
    const aName = String(a.driver || a.name).toLowerCase();
    const bName = String(b.driver || b.name).toLowerCase();
    if (aName === currentLoggedDriverName) return -1;
    if (bName === currentLoggedDriverName) return 1;
    return 0;
  });

  return (
    <div className="dispatch-board-container">
      {/* Header */}
      <h2 className="dispatch-title">This week</h2>

      {/* Horizontal Day Pills (Mon 21, Tue 22, Wed 23, Thu 24, Fri 25) */}
      <div className="dispatch-day-tabs">
        {weekDates.slice(0, 5).map((dateStr, idx) => {
          const isSelected = selectedDate === dateStr;
          const label = getFormattedDayLabel(dateStr, idx);

          return (
            <button
              key={dateStr || idx}
              type="button"
              className={`dispatch-day-pill ${isSelected ? 'active' : ''}`}
              onClick={() => setSelectedDate(dateStr)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Subheader summary: "5 trucks · 1 stop scheduled" */}
      <div className="dispatch-summary-text">
        {displayTrucks.length} trucks · {totalStopsOnSelectedDay} stop{totalStopsOnSelectedDay !== 1 ? 's' : ''} scheduled
      </div>

      {/* Fleet Driver Cards List */}
      <div className="dispatch-cards-list">
        {sortedTrucks.map(truck => {
          const stopsForTruck = deliveries.filter(d =>
            isDeliveryMatchingTruck(d, truck) && isDeliveryMatchingDate(d, selectedDate)
          );
          const stopCount = stopsForTruck.length;
          const isCurrentDriverCard = currentLoggedDriverName &&
            String(truck.driver || truck.name).toLowerCase() === currentLoggedDriverName;

          return (
            <div
              key={truck.id || truck._id}
              className={`dispatch-truck-card ${isCurrentDriverCard ? 'current-driver-highlight' : ''}`}
              style={{ borderLeftColor: truck.color || '#D4AF37' }}
            >
              {/* Card Top: Dot + Driver Name + Capacity Badge (e.g. 1/8) */}
              <div className="truck-card-header">
                <div className="truck-driver-info">
                  <span className="driver-dot" style={{ background: truck.color || '#D4AF37' }} />
                  <span className="driver-name">{truck.driver || truck.name}</span>
                </div>
                <span className={`capacity-badge ${stopCount > 0 ? 'has-stops' : ''}`}>
                  {stopCount}/8
                </span>
              </div>

              {/* Card Body: Stops List or "No stops scheduled" */}
              {stopCount === 0 ? (
                <div className="no-stops-message">No stops scheduled</div>
              ) : (
                <div className="truck-stops-wrapper">
                  {stopsForTruck.map(del => {
                    const statusStr = (del.status || 'scheduled').toLowerCase();
                    let statusLabel = 'SCHEDULED';
                    if (statusStr === 'completed' || statusStr === 'delivered') statusLabel = 'COMPLETE';
                    if (statusStr === 'delayed' || statusStr === 'late') statusLabel = 'DELAYED';

                    return (
                      <div className="truck-stop-item" key={del.id}>
                        {/* Time & Status Badge */}
                        <div className="stop-time-and-status">
                          <span className="stop-time-text">
                            <Clock size={13} style={{ marginRight: '4px' }} />
                            {del.time || '09:00 AM'}
                          </span>
                          <span className={`stop-status-pill ${statusStr}`}>
                            {statusLabel}
                          </span>
                        </div>

                        {/* Customer Name */}
                        <h4 className="stop-customer-title">{del.customerName}</h4>

                        {/* Address / Location */}
                        <div className="stop-location-subtitle">
                          <MapPin size={13} style={{ marginRight: '4px' }} />
                          {del.address || 'Location not specified'}
                        </div>

                        {del.notes && (
                          <div className="stop-notes-text">
                            <FileText size={12} style={{ marginRight: '4px' }} />
                            {del.notes}
                          </div>
                        )}

                        {/* Quick action buttons for status updating */}
                        <div className="driver-quick-actions">
                          <button
                            type="button"
                            className="btn-action-late"
                            onClick={() => onUpdateStatus && onUpdateStatus(del.id, 'delayed')}
                            disabled={statusStr === 'delayed' || statusStr === 'late'}
                          >
                            <AlertTriangle size={14} />
                            Running Late
                          </button>
                          <button
                            type="button"
                            className="btn-action-delivered"
                            onClick={() => onUpdateStatus && onUpdateStatus(del.id, 'completed')}
                            disabled={statusStr === 'completed' || statusStr === 'delivered'}
                          >
                            <CheckCircle2 size={14} />
                            Delivered
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DriverView;
