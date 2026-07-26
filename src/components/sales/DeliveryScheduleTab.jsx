import React, { useState, useEffect, useCallback } from 'react';
import { Truck, ChevronLeft, ChevronRight, Plus, RefreshCw, Search } from 'lucide-react';
import BoardGrid from './delivery/BoardGrid';
import DriverView from './delivery/DriverView';
import DeliveryModal from './delivery/DeliveryModal';
import {
  getDeliveries,
  saveDelivery,
  deleteDelivery,
  updateDeliveryStatus,
  getDriverUsers
} from '../../api/schedule';
import './DeliveryScheduleTab.css';

function getWeekMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getWeekDates(mondayDate) {
  const dates = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(mondayDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

function formatWeekRangeText(dates) {
  if (!dates || dates.length < 5) return '';
  const d1 = new Date(dates[0] + 'T00:00:00');
  const d5 = new Date(dates[4] + 'T00:00:00');
  const m1 = d1.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const m5 = d5.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${m1} — ${m5}`;
}

const getUserRoleFromPermissions = (user) => {
  if (!user) return 'office';
  const roleName = user.role?.toLowerCase() || '';
  const perms = user.permissions || [];

  if (roleName === 'driver' || roleName === 'logistics') return 'driver';

  if (
    roleName === 'admin' ||
    roleName === 'manager' ||
    perms.includes('edit_delivery_schedule') ||
    perms.includes('manage_delivery_schedule') ||
    perms.includes('manage_users')
  ) return 'office';

  if (roleName === 'sales_rep' || perms.includes('view_delivery_schedule')) return 'sales';

  return 'office';
};

const ROLE_SUBTITLES = {
  office: 'Office · full edit access',
  sales: 'Sales team · view and check capacity',
  driver: 'Driver · your assigned stops'
};

const DeliveryScheduleTab = ({
  currentUser = null,
  theme = 'dark',
  locationsList = ['Seattle', 'Spokane', 'Salt Lake City'],
  customerOptions = [],
  sidebarToggle = null
}) => {
  const [role, setRole] = useState(() => getUserRoleFromPermissions(currentUser));

  useEffect(() => {
    if (currentUser) setRole(getUserRoleFromPermissions(currentUser));
  }, [currentUser]);

  const [trucks, setTrucks] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const [currentMonday, setCurrentMonday] = useState(() => getWeekMonday(new Date()));
  const weekDates = getWeekDates(currentMonday);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const userLocation = currentUser?.location || null;
      const userAssignedLocations = currentUser?.assignedLocations || [];

      const [driverUsers, dList] = await Promise.all([
        getDriverUsers(userLocation, userAssignedLocations),
        getDeliveries()
      ]);

      // Only show real drivers from the Users tab — no hardcoded fallback
      setTrucks(driverUsers && driverUsers.length > 0 ? driverUsers : []);
      setDeliveries(dList);
    } catch (err) {
      console.error('Error loading schedule data:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => { loadData(); }, [loadData]);

  const handlePrevWeek = () => {
    const prev = new Date(currentMonday);
    prev.setDate(prev.getDate() - 7);
    setCurrentMonday(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(currentMonday);
    next.setDate(next.getDate() + 7);
    setCurrentMonday(next);
  };

  const handleTodayWeek = () => setCurrentMonday(getWeekMonday(new Date()));

  const handleOpenAddModal = (truckId = null, dateStr = null) => {
    setEditingDelivery({
      truckId: truckId || trucks[0]?.id || 'trk_1',
      date: dateStr || weekDates[0],
      time: '09:00 AM',
      salesRepName: currentUser?.name || 'Sales Rep',
      status: 'scheduled'
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (delivery) => {
    setEditingDelivery(delivery);
    setIsModalOpen(true);
  };

  const handleSaveDelivery = async (payload) => {
    const updatedList = await saveDelivery(payload);
    setDeliveries(updatedList);
  };

  const handleDeleteDelivery = async (id) => {
    const updatedList = await deleteDelivery(id);
    setDeliveries(updatedList);
  };

  const handleUpdateStatus = async (id, newStatus) => {
    const updatedList = await updateDeliveryStatus(id, newStatus);
    setDeliveries(updatedList);
  };

  const handleUpdateTruck = (id, newName, newDriver) => {
    // Only update local state — drivers are sourced from the Users tab.
    // Permanent driver edits should be done via Users & Roles → edit user.
    setTrucks(prev => prev.map(t =>
      t.id === id ? { ...t, name: newName, driver: newDriver } : t
    ));
  };

  const weekRangeText = formatWeekRangeText(weekDates);

  return (
    <div className={`delivery-schedule-container high-density ${theme}-theme-active`}>

      {/* ── TOP HEADER: Title + Subtitle + New Ticket (office only) ── */}
      <div className="manifest-top-header">
        <div className="manifest-title-block">
          {sidebarToggle}
          <div>
            <h2 className="manifest-title">Manifest</h2>
            <span className="manifest-subtitle">{ROLE_SUBTITLES[role]}</span>
          </div>
        </div>

        {role === 'office' && (
          <button type="button" className="btn-add-delivery" onClick={() => handleOpenAddModal()}>
            <Plus size={16} />
            <span>New ticket</span>
          </button>
        )}
      </div>

      {/* ── SUB-CONTROL BAR: Week Nav + Date + Search (sales only) ── */}
      <div className="manifest-nav-bar">
        <div className="nav-bar-left">
          <div className="week-navigator-controls">
            <button type="button" className="btn-week-nav" onClick={handlePrevWeek} title="Previous Week">
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="btn-week-nav today" onClick={handleTodayWeek} title="Current Week">
              Today
            </button>
            <button type="button" className="btn-week-nav" onClick={handleNextWeek} title="Next Week">
              <ChevronRight size={16} />
            </button>
          </div>
          <span className="week-range-label-text">{weekRangeText}</span>
        </div>

        {/* Search: only show for sales role, office has it inline elsewhere */}
        {role === 'sales' && (
          <div className="search-box-wrap-header">
            <Search size={15} className="search-icon" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customer or address"
              className="board-search-input-header"
            />
          </div>
        )}
      </div>

      {/* ── MAIN CONTENT ── */}
      {loading ? (
        <div className="manifest-loading-box">
          <RefreshCw size={24} className="spin-icon" />
          <span>Loading Dispatch Manifest...</span>
        </div>
      ) : (
        <div className="manifest-role-stage">
          {role === 'office' && (
            <BoardGrid
              trucks={trucks}
              deliveries={deliveries}
              weekDates={weekDates}
              searchQuery={searchQuery}
              editable={true}
              onAddDelivery={handleOpenAddModal}
              onEditDelivery={handleOpenEditModal}
              onUpdateTruck={handleUpdateTruck}
            />
          )}

          {role === 'sales' && (
            <BoardGrid
              trucks={trucks}
              deliveries={deliveries}
              weekDates={weekDates}
              searchQuery={searchQuery}
              editable={false}
              onEditDelivery={null}
            />
          )}

          {role === 'driver' && (
            <DriverView
              trucks={trucks}
              deliveries={deliveries}
              weekDates={weekDates}
              onUpdateStatus={handleUpdateStatus}
            />
          )}
        </div>
      )}

      {/* ── READ-ONLY FOOTER (sales) ── */}
      {role === 'sales' && (
        <div className="manifest-readonly-footer">
          Read-only · contact office to schedule
        </div>
      )}

      <DeliveryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveDelivery}
        onDelete={handleDeleteDelivery}
        initialData={editingDelivery}
        trucks={trucks}
        customerOptions={customerOptions}
        currentUser={currentUser}
      />
    </div>
  );
};

export default DeliveryScheduleTab;
