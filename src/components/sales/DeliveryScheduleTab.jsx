import React, { useState, useEffect, useCallback } from 'react';
import { Truck, Calendar, ChevronLeft, ChevronRight, Plus, RefreshCw, Shield, Eye } from 'lucide-react';
import RoleGate from './delivery/RoleGate';
import BoardGrid from './delivery/BoardGrid';
import DriverView from './delivery/DriverView';
import DeliveryModal from './delivery/DeliveryModal';
import {
  getTrucks,
  saveTrucks,
  getDeliveries,
  saveDelivery,
  deleteDelivery,
  updateDeliveryStatus
} from '../../api/schedule';
import './DeliveryScheduleTab.css';

function getWeekMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  return new Date(d.setDate(diff));
}

function getWeekDates(mondayDate) {
  const dates = [];
  for (let i = 0; i < 5; i++) { // Mon - Fri
    const d = new Date(mondayDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

const getUserRoleFromPermissions = (user) => {
  if (!user) return 'office';
  const roleName = user.role?.toLowerCase() || '';
  const perms = user.permissions || [];

  if (roleName === 'driver' || roleName === 'logistics') {
    return 'driver';
  }

  if (
    roleName === 'admin' ||
    roleName === 'manager' ||
    perms.includes('edit_delivery_schedule') ||
    perms.includes('manage_delivery_schedule') ||
    perms.includes('manage_users')
  ) {
    return 'office';
  }

  if (roleName === 'sales_rep' || perms.includes('view_delivery_schedule')) {
    return 'sales';
  }

  return 'office';
};

const DeliveryScheduleTab = ({
  currentUser = null,
  theme = 'dark',
  locationsList = ['Seattle', 'Spokane', 'Salt Lake City'],
  customerOptions = [],
  sidebarToggle = null
}) => {
  // Compute default role directly from user info & permissions
  const [role, setRole] = useState(() => getUserRoleFromPermissions(currentUser));

  useEffect(() => {
    if (currentUser) {
      setRole(getUserRoleFromPermissions(currentUser));
    }
  }, [currentUser]);

  const [trucks, setTrucks] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);

  // Week State
  const [currentMonday, setCurrentMonday] = useState(() => getWeekMonday(new Date()));
  const weekDates = getWeekDates(currentMonday);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState(null);

  // Initial Data Load
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tList, dList] = await Promise.all([getTrucks(), getDeliveries()]);
      setTrucks(tList);
      setDeliveries(dList);
    } catch (err) {
      console.error('Error loading schedule data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Week Navigation
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

  const handleTodayWeek = () => {
    setCurrentMonday(getWeekMonday(new Date()));
  };

  // Add / Edit Handlers
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

  const handleSaveDelivery = async (deliveryPayload) => {
    const updatedList = await saveDelivery(deliveryPayload);
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

  const handleUpdateTruck = async (id, newName, newDriver) => {
    const updatedTrucks = trucks.map(t =>
      t.id === id ? { ...t, name: newName, driver: newDriver } : t
    );
    setTrucks(updatedTrucks);
    await saveTrucks(updatedTrucks);
  };

  const weekRangeText = `${weekDates[0]} to ${weekDates[4]}`;

  return (
    <div className={`delivery-schedule-container high-density ${theme}-theme-active`}>
      {/* Top Header Bar */}
      <div className="delivery-schedule-header compact-header">
        <div className="header-left-title">
          {sidebarToggle}
          <div className="header-icon-ring compact">
            <Truck size={18} />
          </div>
          <div>
            <h2 className="title-text-compact">Manifest — Dispatch Scheduler</h2>
            <span className="subtitle-manifest">Shared Weekly Dispatch & Driver Operations</span>
          </div>
        </div>

        {/* Week Navigator Controls */}
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
          <span className="week-range-label"><Calendar size={13} /> {weekRangeText}</span>
        </div>

        {/* Action Button (Office Mode Only) */}
        {role === 'office' && (
          <div className="header-right-actions">
            <button type="button" className="btn-add-delivery" onClick={() => handleOpenAddModal()}>
              <Plus size={16} />
              <span>New Delivery Ticket</span>
            </button>
          </div>
        )}
      </div>

 

      {/* Main Content Area based on Role */}
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

      {/* Delivery Add / Edit Modal */}
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
