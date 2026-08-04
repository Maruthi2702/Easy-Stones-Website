import React, { useState, useEffect, useCallback } from 'react';
import { Truck, ChevronLeft, ChevronRight, Plus, RefreshCw, Search } from 'lucide-react';
import BoardGrid from './delivery/BoardGrid';
import DriverView from './delivery/DriverView';
import DeliveryModal from './delivery/DeliveryModal';
import PodModal from './delivery/PodModal';
import PodViewer from './delivery/PodViewer';
import {
  saveDelivery,
  deleteDelivery,
  updateDeliveryStatus,
  getScheduleDataCached,
  getScheduleCacheSync,
  subscribeScheduleCache
} from '../../api/schedule';
import { formatForDateInput, formatDate } from '../../utils/dateUtils';
import './DeliveryScheduleTab.css';

function getWeekMonday(date = new Date()) {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? 1 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday;
}

function getWeekDates(mondayDate) {
  const dates = [];
  const base = new Date(mondayDate);
  for (let i = 0; i < 5; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    dates.push(formatForDateInput(d));
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

  const initialCache = getScheduleCacheSync();
  const [trucks, setTrucks] = useState(() => initialCache.trucks || []);
  const [deliveries, setDeliveries] = useState(() => initialCache.deliveries || []);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(() => !initialCache.isLoaded);

  const [currentMonday, setCurrentMonday] = useState(() => getWeekMonday(new Date()));
  const weekDates = getWeekDates(currentMonday);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState(null);

  // Proof of Delivery (ePOD) Modal state — capture new ePOD
  const [isPodOpen, setIsPodOpen] = useState(false);
  const [selectedPodDelivery, setSelectedPodDelivery] = useState(null);

  // ePOD Viewer state — read-only view of signed ePOD
  const [isPodViewerOpen, setIsPodViewerOpen] = useState(false);
  const [viewerDelivery, setViewerDelivery] = useState(null);

  const handleOpenPod = (delivery) => {
    setSelectedPodDelivery(delivery);
    setIsPodOpen(true);
  };

  const handleOpenPodViewer = (delivery) => {
    setViewerDelivery(delivery);
    setIsPodViewerOpen(true);
  };

  const handleSavePod = async (podData) => {
    if (!selectedPodDelivery) return;
    const updated = {
      ...selectedPodDelivery,
      status: 'completed',
      pod: podData,
      packingListUrl: podData?.signedPdfUrl || selectedPodDelivery.packingListUrl,
      packingListFilename: podData?.signedPdfFilename || selectedPodDelivery.packingListFilename
    };
    await handleSaveDelivery(updated);
    setIsPodOpen(false);
  };

  const loadData = useCallback(async (forceRefresh = false) => {
    if (!getScheduleCacheSync().isLoaded || forceRefresh) {
      setLoading(true);
    }
    try {
      const data = await getScheduleDataCached(currentUser, forceRefresh);
      setTrucks(data.trucks || []);
      setDeliveries(data.deliveries || []);
    } catch (err) {
      console.error('Error loading schedule data:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadData();

    const unsubscribe = subscribeScheduleCache(({ deliveries: newDeliveries, trucks: newTrucks }) => {
      setDeliveries(newDeliveries);
      if (newTrucks && newTrucks.length > 0) {
        setTrucks(newTrucks);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [loadData]);

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
      salesRepName: currentUser?.name || 'Admin',
      status: 'pending'
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (delivery) => {
    setEditingDelivery(delivery);
    setIsModalOpen(true);
  };

  const handleSaveDelivery = async (payload) => {
    const updatedList = await saveDelivery(payload);
    if (updatedList && Array.isArray(updatedList)) {
      setDeliveries(updatedList);
    }
    // Don't null editingDelivery here — modal awaits this and calls onClose itself
    return updatedList;
  };

  const handleDeleteDelivery = async (id) => {
    const updatedList = await deleteDelivery(id);
    setDeliveries(updatedList);
    setEditingDelivery(null);
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

      {/* ── OPTION 1: 1-ROW COMPACT LUXURY TOOLBAR ── */}
      <div className="manifest-top-header header-option-1">
        {/* Left: Title + Sidebar Menu Button */}
        <div className="manifest-title-block">
          {sidebarToggle}
          <div>
            <h2 className="manifest-title">Delivery Schedule</h2>
            <span className="manifest-subtitle">{ROLE_SUBTITLES[role]}</span>
          </div>
        </div>

        {/* Center: Integrated Glass Pill Nav */}
        <div className="header-glass-pill-nav">
          <div className="week-nav-btn-group">
            <button type="button" className="btn-week-arrow" onClick={handlePrevWeek} title="Previous Week">
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="btn-week-today" onClick={handleTodayWeek} title="Current Week">
              Today
            </button>
            <button type="button" className="btn-week-arrow" onClick={handleNextWeek} title="Next Week">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="pill-divider-line" />
          <span className="week-range-label-text">{weekRangeText}</span>
        </div>

        {/* Right: Search / New Ticket Action */}
        <div className="manifest-header-actions">
          {role === 'sales' && (
            <div className="search-box-wrap-header">
              <Search size={15} className="search-icon" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customer..."
                className="board-search-input-header"
              />
            </div>
          )}

          {role === 'office' && (
            <button type="button" className="btn-add-delivery gold-glow-btn" onClick={() => handleOpenAddModal()}>
              <Plus size={16} />
              <span>Add Delivery</span>
            </button>
          )}
        </div>
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
              userLocation={currentUser?.location || null}
              onAddDelivery={handleOpenAddModal}
              onEditDelivery={handleOpenEditModal}
              onUpdateTruck={handleUpdateTruck}
              onViewPod={handleOpenPodViewer}
            />
          )}

          {role === 'sales' && (
            <BoardGrid
              trucks={trucks}
              deliveries={deliveries}
              weekDates={weekDates}
              searchQuery={searchQuery}
              editable={false}
              userLocation={currentUser?.location || null}
              onEditDelivery={null}
              onViewPod={handleOpenPodViewer}
            />
          )}

          {role === 'driver' && (
            <DriverView
              trucks={trucks}
              deliveries={deliveries}
              weekDates={weekDates}
              currentUser={currentUser}
              onUpdateStatus={handleUpdateStatus}
              onOpenPod={handleOpenPod}
              onViewPod={handleOpenPodViewer}
              onPrevWeek={handlePrevWeek}
              onNextWeek={handleNextWeek}
              onTodayWeek={handleTodayWeek}
              weekRangeText={weekRangeText}
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
        deliveries={deliveries}
        customerOptions={customerOptions}
        currentUser={currentUser}
      />

      <PodModal
        isOpen={isPodOpen}
        onClose={() => setIsPodOpen(false)}
        delivery={selectedPodDelivery}
        trucks={trucks}
        currentUser={currentUser}
        onSavePod={handleSavePod}
      />

      <PodViewer
        isOpen={isPodViewerOpen}
        onClose={() => setIsPodViewerOpen(false)}
        delivery={viewerDelivery}
        trucks={trucks}
        currentUser={currentUser}
      />
    </div>
  );
};

export default DeliveryScheduleTab;
