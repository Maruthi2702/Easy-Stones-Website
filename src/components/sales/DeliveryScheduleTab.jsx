import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus, RefreshCw, AlertTriangle, ArrowUpToLine, Link2, Search, X } from 'lucide-react';
import BoardGrid from './delivery/BoardGrid';
import { WILL_CALL_COLUMN_ID, defaultStatusFor } from '../../utils/deliveryTypes';
import DriverView from './delivery/DriverView';
// The Add / Edit delivery form (shared form template). The old DeliveryModal.jsx
// is no longer mounted anywhere.
import DeliveryForm from './delivery/DeliveryForm';
import PodModal from './delivery/PodModal';
import PodViewer from './delivery/PodViewer';
import PendingDeliveries from './delivery/PendingDeliveries';
import CancelledOrders from './delivery/CancelledOrders';
import DeliveryOrderSearch from './delivery/DeliveryOrderSearch';
import LocationFilter from '../shared/LocationFilter';
import { useLocationFilter } from '../shared/useLocationFilter';
import { accessibleLocations } from '../../utils/locationFilter';
import {
  saveDelivery,
  deleteDelivery,
  updateDeliveryStatus,
  updateDeliveryAssignment,
  reorderDeliveries,
  getScheduleDataCached,
  getLocationScopedScheduleData,
  peekLocationScopedWeek,
  getScheduleCacheSync,
  subscribeScheduleCache,
  subscribeScheduleChanges,
  getDeliveryById,
  isWeekCached,
  getCachedWeekDeliveries,
  subscribeScheduleConnection,
  getScheduleConnection,
  refreshScheduleNow
} from '../../api/deliverySchedule';
import {
  getWeekMonday,
  getWeekDates,
  visibleWeekDates,
  formatWeekRangeText
} from '../../utils/deliveryWeek';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { deliveryViewMode } from '../../utils/deliveryAccess';
import { reportDaysForMove, submittedDayLabel } from '../../utils/deliveryForm';
import './DeliveryScheduleTab.css';

// getWeekMonday / getWeekDates / formatWeekRangeText now live in
// utils/deliveryWeek.js, alongside the rules about which days a week shows.

// Which screen this person gets — driver, office board or read-only board —
// comes from their role's Delivery Schedule permissions in Users & Roles
// (deliveryViewMode in src/utils/deliveryAccess.js), not the role's name.

const DeliveryScheduleTab = ({
  currentUser = null,
  theme = 'dark',
  customerOptions = [],
  locationsList = ['Seattle', 'Spokane', 'Salt Lake City'],
  sidebarToggle = null
}) => {
  const role = deliveryViewMode(currentUser);

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

  const [trucks, setTrucks] = useState(() => getScheduleCacheSync().trucks || []);
  const [deliveries, setDeliveries] = useState(() => getCachedWeekDeliveries(weekStart));
  const [pending, setPending] = useState(() => getScheduleCacheSync().pending || []);
  const [cancelled, setCancelled] = useState(() => getScheduleCacheSync().cancelled || []);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(() => !isWeekCached(weekStart));
  // A week that failed to load used to render as an empty board, which reads
  // exactly like a week with nothing scheduled on it.
  const [loadError, setLoadError] = useState(null);
  const [connection, setConnection] = useState(() => getScheduleConnection().status);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState(null);

  // Proof of Delivery (ePOD) Modal state — capture new ePOD
  const [isPodOpen, setIsPodOpen] = useState(false);
  const [selectedPodDelivery, setSelectedPodDelivery] = useState(null);

  // ePOD Viewer state — read-only view of signed ePOD
  const [isPodViewerOpen, setIsPodViewerOpen] = useState(false);
  const [viewerDelivery, setViewerDelivery] = useState(null);

  const handleOpenPod = async (delivery) => {
    setSelectedPodDelivery(delivery);
    setIsPodOpen(true);
    // List fetches omit the raw signature/photo data for speed — pull the full
    // record now that a specific delivery's POD is actually being opened.
    if (delivery?.id) {
      const full = await getDeliveryById(delivery.id);
      if (full) setSelectedPodDelivery(full);
    }
  };

  const handleOpenPodViewer = async (delivery) => {
    setViewerDelivery(delivery);
    setIsPodViewerOpen(true);
    if (delivery?.id) {
      const full = await getDeliveryById(delivery.id);
      if (full) setViewerDelivery(full);
    }
  };

  const handleSavePod = async (podData) => {
    if (!selectedPodDelivery) return;
    // packingListUrl deliberately untouched. It used to be overwritten with the
    // signed copy, which destroyed the only clean source — re-signing then
    // stamped a second certificate onto an already-signed page. The signed
    // version lives at pod.signedPdfUrl instead.
    const updated = {
      ...selectedPodDelivery,
      status: 'completed',
      pod: podData
    };
    await handleSaveDelivery(updated);
    setIsPodOpen(false);
  };

  // Voiding a proof keeps the delivery completed — the material arrived; only
  // the signature is withdrawn. The board updates from the socket broadcast.
  const handleClearPod = async (delivery, reason) => {
    const res = await authFetch(`${API_URL}/api/deliveries/${delivery.id}/pod`, {
      method: 'DELETE',
      body: JSON.stringify({ reason })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to clear the ePOD.');
    }
    const { delivery: updated } = await res.json();
    setViewerDelivery(updated);
    return updated;
  };

  // Every load and background refresh takes a number; only the latest one may
  // write to the board, so switching location or week mid-fetch can't have the
  // slower, older response land on top of the view now on screen.
  const dataReqRef = useRef(0);
  // Which view the driver columns on screen were fetched for ('' = All). A
  // background refresh skips the driver list to stay cheap — but when one
  // lands first and supersedes the opening load (the socket connects while
  // that load is still waiting on the users list), the load's drivers are
  // discarded with it, and the board said "No drivers assigned" until reload.
  // So a refresh fetches drivers too until this view's have actually landed.
  const trucksViewRef = useRef(null);

  const loadData = useCallback(async (forceRefresh = false) => {
    const reqId = ++dataReqRef.current;

    // A branch-week already loaded this session paints straight away — no
    // spinner, and no request at all if nothing has changed since (live
    // updates mark it otherwise; see peekLocationScopedWeek). A changed one
    // is shown as it was and refreshed quietly behind.
    const remembered = locationFilter && !forceRefresh ? peekLocationScopedWeek(weekStart, locationFilter) : null;
    if (remembered) {
      if (remembered.trucks) {
        setTrucks(remembered.trucks);
        trucksViewRef.current = locationFilter;
      }
      setDeliveries(remembered.deliveries);
      setPending(remembered.pending);
      setCancelled(remembered.cancelled);
      setLoadError(null);
      setLoading(false);
      if (remembered.fresh) return;
    } else if (!isWeekCached(weekStart) || forceRefresh || locationFilter) {
      setLoading(true);
    }
    try {
      // A location filter bypasses the shared "All Locations" cache entirely
      // — see getLocationScopedScheduleData's own comment for why (so
      // switching it on/off can't corrupt the live cache every other
      // consumer of this data relies on). It's kept live by refetching
      // (refreshScoped below) rather than by the cache subscription, which
      // would overwrite it with the unfiltered set.
      const data = locationFilter
        ? await getLocationScopedScheduleData(weekStart, weekEnd, locationFilter, { includeTrucks: !remembered?.trucks })
        : await getScheduleDataCached(currentUser, weekStart, weekEnd, forceRefresh);
      if (reqId !== dataReqRef.current) return;
      if (data.trucks) {
        setTrucks(data.trucks);
        trucksViewRef.current = locationFilter;
      }
      setDeliveries(data.deliveries || []);
      setPending(data.pending || []);
      setCancelled(data.cancelled || []);
      setLoadError(null);
    } catch (err) {
      if (reqId !== dataReqRef.current) return;
      console.error('Error loading schedule data:', err);
      // A quiet refresh behind a remembered week failing leaves that week on
      // screen; the connection badge already says when updates aren't landing.
      if (!remembered) setLoadError("Couldn't load this week's schedule. Check your connection and refresh.");
    } finally {
      if (reqId === dataReqRef.current) setLoading(false);
    }
  }, [currentUser, weekStart, weekEnd, locationFilter]);

  // The narrowed board's live update: refetch the branch, quietly (no
  // spinner). Drivers only when the driver list itself changed, or this
  // branch's drivers haven't landed yet (see trucksViewRef).
  const refreshScoped = useCallback(async ({ includeTrucks = false } = {}) => {
    if (!locationFilter) return;
    const reqId = ++dataReqRef.current;
    const withTrucks = includeTrucks || trucksViewRef.current !== locationFilter;
    try {
      const data = await getLocationScopedScheduleData(weekStart, weekEnd, locationFilter, { includeTrucks: withTrucks });
      if (reqId !== dataReqRef.current) return;
      if (data.trucks) {
        setTrucks(data.trucks);
        trucksViewRef.current = locationFilter;
      }
      setDeliveries(data.deliveries);
      setPending(data.pending);
      setCancelled(data.cancelled);
      setLoadError(null);
    } catch (err) {
      // What's on screen is still the last good fetch; the connection badge
      // already says when updates aren't getting through.
      console.warn('[schedule] location refresh failed:', err);
    } finally {
      if (reqId === dataReqRef.current) setLoading(false);
    }
  }, [weekStart, weekEnd, locationFilter]);

  useEffect(() => {
    loadData();

    // The shared cache only ever holds the unfiltered "All Locations" view —
    // while a location filter is active, this board is showing its own
    // fetch of one branch instead (see loadData above), so it must not take
    // the cache's data. It still hears that something changed, and refetches
    // its branch — batched, since one drag can fire several updates.
    // Connection status is unrelated to which data is on screen, so that
    // subscription stays active either way.
    let refreshTimer = null;
    let trucksChanged = false;
    const unsubscribe = locationFilter
      ? subscribeScheduleChanges(({ trucks: truckChange } = {}) => {
        trucksChanged = trucksChanged || Boolean(truckChange);
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          const includeTrucks = trucksChanged;
          trucksChanged = false;
          refreshScoped({ includeTrucks });
        }, 400);
      })
      : subscribeScheduleCache(({ deliveries: newDeliveries, pending: newPending, cancelled: newCancelled, trucks: newTrucks }) => {
        setDeliveries(newDeliveries);
        setPending(newPending || []);
        setCancelled(newCancelled || []);
        if (newTrucks && newTrucks.length > 0) {
          setTrucks(newTrucks);
        }
        // Data arriving means the connection recovered — clear the stale warning.
        setLoadError(null);
      });

    const unsubscribeConnection = subscribeScheduleConnection(({ status }) => setConnection(status));

    return () => {
      unsubscribe();
      clearTimeout(refreshTimer);
      unsubscribeConnection();
    };
  }, [loadData, refreshScoped, locationFilter]);

  // Every save/move helper in deliverySchedule.js hands back the shared
  // cache's week — every branch's tickets, or nothing if that cache was never
  // loaded. Right for the All Locations board; a board narrowed to one branch
  // refetches that branch instead.
  const applyUpdatedList = useCallback(async (updatedList) => {
    if (locationFilter) {
      await refreshScoped();
    } else if (Array.isArray(updatedList)) {
      setDeliveries(updatedList);
    }
  }, [locationFilter, refreshScoped]);

  const handleRefresh = useCallback(async () => {
    const list = await refreshScheduleNow();
    setDeliveries(list);
    setLoadError(null);
    return list;
  }, []);

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

  const handleOpenAddModal = (truckId = null, dateStr = null) => {
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

  const handleOpenEditModal = (delivery) => {
    setEditingDelivery(delivery);
    setIsModalOpen(true);
  };

  // A pick from the header's order search (any date, not just this week).
  // Shows the week the order sits in — widening a one-branch board if the
  // order is another of the user's branches — then opens the ticket for the
  // office, or brings the Pending/Cancelled list into view for read-only
  // sales users, whose board has no ticket editor.
  const handleOrderSearchSelect = async (result, info) => {
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

  const handleSaveDelivery = async (payload) => {
    const updatedList = await saveDelivery(payload);
    await applyUpdatedList(updatedList);
    // Don't null editingDelivery here — modal awaits this and calls onClose itself
    return updatedList;
  };

  const handleDeleteDelivery = async (id) => {
    const updatedList = await deleteDelivery(id);
    await applyUpdatedList(updatedList);
    setEditingDelivery(null);
  };

  // Deliberately rethrows. The driver view puts the failure on screen — a tap
  // that silently does nothing is worse than one that says it didn't work.
  const handleUpdateStatus = async (id, newStatus) => {
    const updatedList = await updateDeliveryStatus(id, newStatus);
    await applyUpdatedList(updatedList);
    return updatedList;
  };

  // A rejected move used to fail completely silently: nothing awaits or
  // catches the drop handlers below, so a 4xx from the server became an
  // unhandled rejection and the card simply snapped back with no explanation.
  // That is indistinguishable from "drag and drop is broken" — which is how
  // it was reported. Put the reason on screen instead.
  const reportMoveFailure = (err) => {
    console.error('[schedule] move failed:', err);
    setLoadError(err?.message || "Couldn't move that delivery.");
  };

  // After a drag lands: if the day the ticket left, or the day it landed on,
  // already has a submitted Daily Report (its branch's day, and a transfer's
  // arrival day at the destination), say so — that report is frozen, so the
  // board and it now disagree until someone reopens the day. The same check
  // the delivery form makes (reportDaysForMove / submitted-days). Never blocks
  // the move; a failed check just shows nothing.
  const [submittedDayNotice, setSubmittedDayNotice] = useState('');
  const findTicket = (id) => [...deliveries, ...pending, ...cancelled].find(d => d.id === id);
  const warnIfSubmittedDays = async (before, after) => {
    if (!before) return;
    const days = reportDaysForMove(before, after);
    if (!days.length) return;
    try {
      const key = days.map(d => `${d.location}|${d.date}`).join(',');
      const res = await authFetch(`${API_URL}/api/daily-reports/submitted-days?days=${encodeURIComponent(key)}`);
      if (!res.ok) return;
      const found = (await res.json()).days || [];
      if (!found.length) return;
      const one = found.length === 1;
      setSubmittedDayNotice(`${found.map(submittedDayLabel).join(' and ')} ${one ? 'is' : 'are'} already submitted, so ${one ? "it doesn't" : "they don't"} include this move. Reopen ${one ? 'that day' : 'those days'} in the Daily Report to bring the figures up to date.`);
    } catch {
      // Advice only.
    }
  };

  // Drag-and-drop move on the dispatch board: which driver/column/day a
  // ticket belongs to, nothing else (stop numbers are left as-is).
  const handleMoveDelivery = async (id, assignment) => {
    const before = findTicket(id);
    try {
      const updatedList = await updateDeliveryAssignment(id, assignment);
      await applyUpdatedList(updatedList);
      warnIfSubmittedDays(before, { ...before, ...assignment });
      return updatedList;
    } catch (err) {
      reportMoveFailure(err);
    }
  };

  // Drag-to-reorder inside a cell. Takes the whole cell's new order, not just
  // the card that moved, because a stop number only means anything as part of a
  // complete running order.
  const handleReorderDeliveries = async (updates) => {
    try {
      const updatedList = await reorderDeliveries(updates);
      await applyUpdatedList(updatedList);
      return updatedList;
    } catch (err) {
      reportMoveFailure(err);
    }
  };

  // The reverse of the move above: dragging a ticket off the board and onto
  // the Pending list gives its driver back. Pending is defined in
  // src/utils/deliveryTypes.js, so clearing truckId is (almost) the whole
  // change — the week query and the pending query are complements, and the
  // ticket swaps sides on its own.
  //
  // A return also has customerDropOff cleared here: dragging it to Pending is
  // an explicit "nobody's assigned to this yet", which has to win over
  // whatever that flag was previously set to — otherwise a return someone had
  // marked a customer drop-off would just bounce straight back to the Will
  // Call column instead of actually landing in Pending.
  const handleMoveToPending = async (id) => {
    // Also checks `cancelled` — a cancelled ticket can be dragged straight
    // onto Pending, not just onto a truck cell, so it isn't in `deliveries`.
    const delivery = [...deliveries, ...cancelled].find(d => d.id === id);
    if (!delivery) return;

    try {
      const updatedList = await updateDeliveryAssignment(id, {
        truckId: '',
        // A will call has no driver by definition, so it can never be pending —
        // it has to become an ordinary stop on the way out. Same conversion the
        // board already makes in the other direction, when a will call is
        // dragged from its column onto a truck.
        deliveryType: delivery.deliveryType === 'will_call' ? 'jobsite' : (delivery.deliveryType || 'jobsite'),
        customerDropOff: false,
        // Kept, not cleared: it's the last date that was agreed, and re-assigning
        // a driver shouldn't have to rediscover it. Empty is fine too — Pending
        // itself has no date requirement, only a real truck column does.
        date: delivery.date
      });
      await applyUpdatedList(updatedList);
      warnIfSubmittedDays(delivery, { ...delivery, truckId: '', customerDropOff: false, deliveryType: delivery.deliveryType === 'will_call' ? 'jobsite' : delivery.deliveryType });
      return updatedList;
    } catch (err) {
      reportMoveFailure(err);
    }
  };

  // The other reverse move: dragging a ticket onto Cancelled Orders. Goes
  // through the status endpoint, not the assignment one — cancelling doesn't
  // touch truckId/date, it's the one thing that's kept as a record of what to
  // restore the ticket to (see handleMoveDelivery/handleMoveToPending above,
  // and PATCH /deliveries/:id/assignment server-side for the restore itself).
  const handleMoveToCancelled = async (id) => {
    const before = findTicket(id);
    try {
      const updatedList = await updateDeliveryStatus(id, 'cancelled');
      await applyUpdatedList(updatedList);
      warnIfSubmittedDays(before, { ...before, status: 'cancelled' });
      return updatedList;
    } catch (err) {
      reportMoveFailure(err);
    }
  };

  const handleUpdateTruck = (id, newName, newDriver) => {
    // Only update local state — drivers are sourced from the Users tab.
    // Permanent driver edits should be done via Users & Roles → edit user.
    setTrucks(prev => prev.map(t =>
      t.id === id ? { ...t, name: newName, driver: newDriver } : t
    ));
  };

  // Mon–Fri always; Saturday or Sunday only once something is scheduled on
  // it, so a normal week looks exactly as it always has. Pending orders are
  // excluded on purpose — they have no agreed date yet and live in their own
  // list, so one shouldn't conjure a weekend column onto the board.
  const datesWithDeliveries = new Set(deliveries.map(d => d.date).filter(Boolean));
  const visibleDates = visibleWeekDates(weekDates, datesWithDeliveries);
  const weekRangeText = formatWeekRangeText(visibleDates);

  return (
    <div className={`delivery-schedule-container high-density ${theme}-theme-active`}>

      {/* ── OPTION 1: 1-ROW COMPACT LUXURY TOOLBAR ── */}
      <div className="manifest-top-header header-option-1">
        {/* Left: Title + Sidebar Menu Button */}
        <div className="manifest-title-block">
          {sidebarToggle}
          <div>
            <h2 className="manifest-title">Delivery Schedule</h2>
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

        {/* Right: Filters (order search + location) / New Ticket Action */}
        <div className="manifest-header-actions">
          {/* While the panel is shut, a search still filtering the board says
              so here — otherwise rows would vanish with no visible reason. */}
          {role !== 'driver' && searchQuery.trim() && (
            <button
              type="button"
              className="delivery-search-chip"
              onClick={() => setSearchQuery('')}
              title="Clear search"
              aria-label={`Clear search "${searchQuery.trim()}"`}
            >
              <Search size={13} aria-hidden="true" />
              <span className="delivery-search-chip-text">{searchQuery.trim()}</span>
              <X size={13} aria-hidden="true" />
            </button>
          )}

          {/* Order search lives in the Filters panel, above Location — every
              date, the user's own branches only, and it still filters the week
              on screen. Drivers don't get it (the server refuses them too), so
              theirs is the plain location filter. Picking a result shuts the
              panel before jumping to the order. */}
          {role !== 'driver' ? (
            <LocationFilter
              options={filterableLocations}
              value={locationFilter}
              onChange={setLocationFilter}
              user={currentUser}
              label="Search & filters"
              wide
              active={Boolean(searchQuery.trim())}
              onClear={() => setSearchQuery('')}
            >
              {({ close }) => (
                <div className="lf-group">
                  <span className="lf-group-label">Search orders</span>
                  <DeliveryOrderSearch
                    inline
                    autoFocus
                    value={searchQuery}
                    onChange={setSearchQuery}
                    onSelect={(result, info) => { close(); handleOrderSearchSelect(result, info); }}
                    onViewPod={(delivery) => { close(); handleOpenPodViewer(delivery); }}
                    trucks={trucks}
                    viewerLocations={currentUser?.assignedLocations || []}
                  />
                </div>
              )}
            </LocationFilter>
          ) : (
            <LocationFilter
              options={filterableLocations}
              value={locationFilter}
              onChange={setLocationFilter}
              user={currentUser}
            />
          )}

          {role === 'office' && (
            <button
              type="button"
              className="btn-add-delivery gold-glow-btn"
              onClick={() => handleOpenAddModal()}
              aria-label="Add delivery"
              title="Add delivery"
            >
              <Plus size={16} />
              {/* "Delivery" drops on small phones so the header row fits
                  beside the title (DeliveryScheduleTab.css). */}
              <span>Add<span className="btn-add-delivery-word"> Delivery</span></span>
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
          {/* The driver view renders its own, alongside the connection state. */}
          {loadError && role !== 'driver' && (
            <div className="manifest-load-error" role="alert">
              <AlertTriangle size={16} />
              <span>{loadError}</span>
              <button type="button" onClick={() => loadData(true)}>Retry</button>
            </div>
          )}

          {submittedDayNotice && role === 'office' && (
            <div className="manifest-submitted-day" role="status">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{submittedDayNotice}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setSubmittedDayNotice('')}><X size={14} /></button>
            </div>
          )}

          {role === 'office' && (
            <BoardGrid
              trucks={trucks}
              deliveries={deliveries}
              pending={pending}
              cancelled={cancelled}
              weekDates={visibleDates}
              todayRequest={todayRequest}
              searchQuery={searchQuery}
              editable={true}
              onAddDelivery={handleOpenAddModal}
              onEditDelivery={handleOpenEditModal}
              onUpdateTruck={handleUpdateTruck}
              onMoveDelivery={handleMoveDelivery}
              onReorderDeliveries={handleReorderDeliveries}
              onViewPod={handleOpenPodViewer}
              // Pickups are signed for at the counter rather than at a jobsite,
              // so the office captures their ePOD. The board only offers it on
              // the columns nobody drives.
              onOpenPod={handleOpenPod}
            />
          )}

          {role === 'sales' && (
            <BoardGrid
              trucks={trucks}
              deliveries={deliveries}
              weekDates={visibleDates}
              todayRequest={todayRequest}
              searchQuery={searchQuery}
              editable={false}
              onEditDelivery={null}
              onViewPod={handleOpenPodViewer}
            />
          )}

          {(role === 'office' || role === 'sales') && (
            <PendingDeliveries
              pending={pending}
              searchQuery={searchQuery}
              editable={role === 'office'}
              onAddPending={handleOpenAddPending}
              onEditDelivery={handleOpenEditModal}
              onViewPod={handleOpenPodViewer}
              onMoveToPending={role === 'office' ? handleMoveToPending : undefined}
            />
          )}

          {(role === 'office' || role === 'sales') && (
            <CancelledOrders
              cancelled={cancelled}
              searchQuery={searchQuery}
              editable={role === 'office'}
              onEditDelivery={handleOpenEditModal}
              onViewPod={handleOpenPodViewer}
              onMoveToCancelled={role === 'office' ? handleMoveToCancelled : undefined}
            />
          )}

          {/* Below Pending Deliveries and Cancelled Orders rather than above
              the board, so it reads as a footnote for whoever is already
              dragging rather than a banner that eats into the space above the
              content. Only the office role can actually reorder/combine
              stops (BoardGrid's onReorderDeliveries is office-only), so the
              hint is too. */}
          {role === 'office' && (
            <p className="reorder-hint">
              <ArrowUpToLine size={12} /> Drop above or below a stop to reorder it &nbsp;·&nbsp;
              <Link2 size={12} /> drop onto a stop to combine it as the same delivery
            </p>
          )}

          {role === 'driver' && (
            <DriverView
              trucks={trucks}
              deliveries={deliveries}
              weekDates={visibleDates}
              currentUser={currentUser}
              onUpdateStatus={handleUpdateStatus}
              onOpenPod={handleOpenPod}
              onViewPod={handleOpenPodViewer}
              connection={connection}
              onRefresh={handleRefresh}
              loadError={loadError}
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
