import React, { useState, useMemo } from 'react';
// The board, driver view and lists, first: the stylesheets load in the order
// the page's imports used to reach them (DriverView's, then the form's…).
import ScheduleStage from './ScheduleStage';
import { WILL_CALL_COLUMN_ID, defaultStatusFor } from '../../utils/deliveryTypes';
import { WILL_CALL_COLUMN } from '../../utils/deliveryColumns';
// The Add / Edit delivery form (shared form template). It replaced the old
// DeliveryModal.jsx, deleted 2026-10-24.
import DeliveryForm from './form/DeliveryForm';
import ColumnOrderForm from './board/ColumnOrderForm';
import PodModal from './pod/PodModal';
import PodViewer from './pod/PodViewer';
import ScheduleHeader from './ScheduleHeader';
import { useLocationFilter } from '../../components/shared/useLocationFilter';
import { accessibleLocations } from '../../utils/locationFilter';
import { getDeliveryById } from '../../api/deliverySchedule';
import {
  getWeekMonday,
  getWeekDates,
  visibleWeekDates,
  formatWeekRangeText
} from '../../utils/deliveryWeek';
import { deliveryViewMode } from '../../utils/deliveryAccess';
import { useScheduleData } from './useScheduleData';
import { usePodDialogs } from './usePodDialogs';
import { useColumnOrders } from './useColumnOrders';
import { useScheduleActions } from './useScheduleActions';
import type { CurrentUser, Loose } from '../../types/records';
import type { CustomerOption } from '../../utils/customerOptions';
import type { SearchResultInfo } from './search/DeliveryOrderSearch';
import type { BoardColumn, ScheduleRole, Ticket } from './types';
import './DeliveryScheduleTab.css';

// getWeekMonday / getWeekDates / formatWeekRangeText now live in
// utils/deliveryWeek.ts, alongside the rules about which days a week shows.

// Which screen this person gets — driver, office board or read-only board —
// comes from their role's Delivery Schedule permissions in Users & Roles
// (deliveryViewMode in src/utils/deliveryAccess.js), not the role's name.

export type DeliveryScheduleTabProps = {
  currentUser?: CurrentUser | null;
  theme?: string;
  customerOptions?: CustomerOption[];
  locationsList?: string[];
  sidebarToggle?: React.ReactNode;
};

const DeliveryScheduleTab = ({
  currentUser = null,
  theme = 'dark',
  customerOptions = [],
  locationsList = ['Seattle', 'Spokane', 'Salt Lake City'],
  sidebarToggle = null
}: DeliveryScheduleTabProps) => {
  const role = deliveryViewMode(currentUser) as ScheduleRole;

  // '' means "All Locations" — the shared, cached board. Only offered as a
  // real choice to someone who can already reach more than one branch, and
  // opens on their home location (Users & Roles), so a manager sees their own
  // branch's drivers rather than every branch mashed together on one board.
  // Not for drivers: their view is their own stops, wherever those are.
  const filterableLocations = useMemo(() => (
    role === 'driver'
      ? []
      : accessibleLocations(currentUser, locationsList).sort((a, b) => a.localeCompare(b))
  ), [locationsList, currentUser, role]);
  const [locationFilter, setLocationFilter] = useLocationFilter('deliverySchedule', currentUser, filterableLocations);

  const [currentMonday, setCurrentMonday] = useState(() => getWeekMonday(new Date()));
  // Seven dates, Monday to Sunday. The fetch spans all of them so a weekend
  // delivery is actually retrieved; which of them get drawn is decided below,
  // once we know what the week contains.
  const weekDates = getWeekDates(currentMonday);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[weekDates.length - 1];

  const [searchQuery, setSearchQuery] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState<Loose | null>(null);

  const { trucks, setTrucks, deliveries, pending, cancelled, loading, loadError, setLoadError, connection, loadData, applyUpdatedList, handleRefresh }
    = useScheduleData({ currentUser, weekStart, weekEnd, locationFilter });
  const { isPodOpen, setIsPodOpen, selectedPodDelivery, isPodViewerOpen, setIsPodViewerOpen, viewerDelivery,
    handleOpenPod, handleOpenPodViewer, handleSavePod, handleClearPod } = usePodDialogs({ applyUpdatedList });
  const { columnOrders, setColumnOrders, arrangeOpen, setArrangeOpen, canArrangeColumns, columnOrder }
    = useColumnOrders({ role, currentUser, locationFilter });

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

  // A day picked in the calendar shows the week it falls in.
  const handlePickWeek = (iso: string) => {
    if (iso) setCurrentMonday(getWeekMonday(iso));
  };

  // Today: this week, and the board brings today's day into view (BoardGrid).
  const [todayRequest, setTodayRequest] = useState(0);
  const handleTodayWeek = () => {
    setCurrentMonday(getWeekMonday(new Date()));
    setTodayRequest((n) => n + 1);
  };

  // Opens the same modal with no driver, so the order is saved straight to Pending.
  const handleOpenAddPending = () => {
    setEditingDelivery({
      truckId: '',
      date: '',
      time: '09:00 AM',
      salesRepName: currentUser?.name || 'Admin',
      status: 'pending'
    });
    setIsModalOpen(true);
  };

  const handleOpenAddModal = (truckId: string | null = null, dateStr: string | null = null) => {
    // Will Call is not a truck — adding from it opens a ticket with no driver,
    // which is what a customer collecting material actually is. A slab the
    // customer is bringing back shares that column, but it is created by
    // choosing Return Pickup in the modal rather than by which column the Add
    // button sat in, since the common case by far is a driver going out for it.
    const isWillCallColumn = truckId === WILL_CALL_COLUMN_ID;
    const draft = {
      // The first driver still working — a deactivated one (Users & Roles) is
      // in the list for their history, but takes no new orders.
      truckId: isWillCallColumn ? '' : (truckId || trucks.find(t => !t.inactive)?.id || 'trk_1'),
      deliveryType: isWillCallColumn ? 'will_call' : 'jobsite',
      date: dateStr || weekDates[0],
      time: '09:00 AM',
      salesRepName: currentUser?.name || 'Admin'
    };
    // Adding from a truck column prefills that driver, so the ticket is already
    // scheduled — this used to open as Pending regardless, which is why tickets
    // sat on a driver's run labelled as waiting for one.
    setEditingDelivery({ ...draft, status: defaultStatusFor(draft) });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (delivery: Ticket) => {
    setEditingDelivery(delivery);
    setIsModalOpen(true);
  };

  // A pick from the header's order search (any date, not just this week).
  // Shows the week the order sits in — widening a one-branch board if the
  // order is another of the user's branches — then opens the ticket for the
  // office, or brings the Pending/Cancelled list into view for read-only
  // sales users, whose board has no ticket editor.
  const handleOrderSearchSelect = async (result: Ticket, info: SearchResultInfo) => {
    if (locationFilter && ![result.location, result.transferDestination].includes(locationFilter)) {
      setLocationFilter('');
    }
    if (info.boardDate) setCurrentMonday(getWeekMonday(info.boardDate));

    if (role === 'office') {
      const full = await getDeliveryById(result.id);
      if (full) handleOpenEditModal(full);
      return;
    }
    const section = info.place === 'pending' ? '.pending-deliveries-section'
      : info.place === 'cancelled' ? '.cancelled-orders-section' : null;
    if (section) document.querySelector(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const {
    submittedDayNotice, setSubmittedDayNotice,
    handleSaveDelivery, handleDeleteDelivery, handleUpdateStatus, handleMoveDelivery, handleReorderDeliveries,
    handleMoveToPending, handleMoveToCancelled, handleUpdateTruck
  } = useScheduleActions({ deliveries, pending, cancelled, applyUpdatedList, setEditingDelivery, setLoadError, setTrucks });

  // Mon–Fri always; Saturday or Sunday only once something is scheduled on
  // it, so a normal week looks exactly as it always has. Pending orders are
  // excluded on purpose — they have no agreed date yet and live in their own
  // list, so one shouldn't conjure a weekend column onto the board.
  const datesWithDeliveries = new Set(deliveries.map(d => d.date).filter(Boolean) as string[]);
  const visibleDates = visibleWeekDates(weekDates, datesWithDeliveries);
  const weekRangeText = formatWeekRangeText(visibleDates);

  return (
    <div className={`delivery-schedule-container high-density ${theme}-theme-active`}>

      <ScheduleHeader
        sidebarToggle={sidebarToggle}
        role={role}
        currentUser={currentUser}
        currentMonday={currentMonday}
        weekRangeText={weekRangeText}
        handlePrevWeek={handlePrevWeek}
        handleTodayWeek={handleTodayWeek}
        handleNextWeek={handleNextWeek}
        handlePickWeek={handlePickWeek}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filterableLocations={filterableLocations}
        locationFilter={locationFilter}
        setLocationFilter={setLocationFilter}
        canArrangeColumns={canArrangeColumns}
        setArrangeOpen={setArrangeOpen}
        handleOrderSearchSelect={handleOrderSearchSelect}
        handleOpenPodViewer={handleOpenPodViewer}
        trucks={trucks}
        handleOpenAddModal={() => handleOpenAddModal()}
      />

      <ScheduleStage
        role={role}
        currentUser={currentUser}
        loading={loading}
        loadError={loadError}
        loadData={loadData}
        submittedDayNotice={submittedDayNotice}
        setSubmittedDayNotice={setSubmittedDayNotice}
        trucks={trucks}
        deliveries={deliveries}
        pending={pending}
        cancelled={cancelled}
        visibleDates={visibleDates}
        todayRequest={todayRequest}
        searchQuery={searchQuery}
        columnOrder={columnOrder}
        connection={connection}
        handleOpenAddModal={handleOpenAddModal}
        handleOpenAddPending={handleOpenAddPending}
        handleOpenEditModal={handleOpenEditModal}
        handleUpdateTruck={handleUpdateTruck}
        handleMoveDelivery={handleMoveDelivery}
        handleReorderDeliveries={handleReorderDeliveries}
        handleMoveToPending={handleMoveToPending}
        handleMoveToCancelled={handleMoveToCancelled}
        handleUpdateStatus={handleUpdateStatus}
        handleOpenPod={handleOpenPod}
        handleOpenPodViewer={handleOpenPodViewer}
        handleRefresh={handleRefresh}
      />

      {/* ── READ-ONLY FOOTER (sales) ── */}
      {role === 'sales' && (
        <div className="manifest-readonly-footer">
          Read-only · contact office to schedule
        </div>
      )}

      {arrangeOpen && locationFilter && (
        <ColumnOrderForm
          location={locationFilter}
          // This branch's current drivers and Will Call. A former driver
          // (shown only on weeks with their orders) isn't offered; on those
          // weeks their column goes where the default rule puts it.
          columns={[...trucks.filter((t) => !t.inactive), WILL_CALL_COLUMN]}
          savedOrder={columnOrders[locationFilter] || null}
          onClose={() => setArrangeOpen(false)}
          onSaved={(saved) => setColumnOrders((orders) => ({ ...orders, [locationFilter]: saved }))}
        />
      )}

      <DeliveryForm
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveDelivery}
        onDelete={handleDeleteDelivery}
        initialData={editingDelivery}
        trucks={trucks}
        deliveries={deliveries}
        customerOptions={customerOptions}
        locationsList={locationsList}
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
        canClearPod={Boolean(currentUser?.permissions?.includes('clear_pod_signatures'))}
        onClearPod={handleClearPod}
      />
    </div>
  );
};

export default DeliveryScheduleTab;
