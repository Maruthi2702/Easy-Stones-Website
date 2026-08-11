import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  MapPin, CheckCircle2, AlertTriangle, FileText, Package, Navigation, Copy, Check,
  User, Repeat, Clock, RefreshCw, WifiOff, ShieldCheck, RotateCcw, Undo2, Phone
} from 'lucide-react';
import { formatForDateInput } from '../../../utils/dateUtils';
import { openPdfInline } from '../../../utils/packingList';
import StatusPill from './StatusPill';
import './DriverView.css';

const DAYS_OF_WEEK = [
  { name: 'Monday',    short: 'Mon', index: 1 },
  { name: 'Tuesday',   short: 'Tue', index: 2 },
  { name: 'Wednesday', short: 'Wed', index: 3 },
  { name: 'Thursday',  short: 'Thu', index: 4 },
  { name: 'Friday',    short: 'Fri', index: 5 }
];

/**
 * "09:00 AM" → 540. Used only for ordering, so anything unparseable sorts last
 * rather than throwing a stop off the run.
 */
function timeToMinutes(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const meridiem = (m[3] || '').toUpperCase();
  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/**
 * A driver's phone is the one place these links have to open the native app
 * rather than a web map. Apple's universal link does that on iOS and falls back
 * to the browser everywhere else, which is exactly the behaviour wanted.
 */
function mapsHrefFor(address) {
  const query = encodeURIComponent(String(address || '').trim());
  if (!query) return null;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(ua);
  return isApple
    ? `https://maps.apple.com/?q=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/** Blank, whitespace and the string "undefined" all mean "not set" here. */
function cleanField(value) {
  const text = String(value ?? '').trim();
  return !text || text === 'undefined' || text === 'null' ? '' : text;
}

const CONNECTION_LABELS = {
  online: null,
  reconnecting: 'Reconnecting — showing the last synced stops',
  offline: 'Offline — showing the last synced stops'
};

const DriverView = ({
  trucks = [],
  deliveries = [],
  weekDates = [],
  currentUser = null,
  onUpdateStatus,
  onOpenPod,
  onViewPod,
  connection = 'online',
  onRefresh,
  loadError = null
}) => {
  const todayStr = formatForDateInput(new Date());

  // ── Which truck/driver column is this user? ──────────────────────────────
  // Matched exactly, never by substring. A "contains" match put Jose's stops on
  // Jose M's manifest, which is the one mistake a driver's day cannot absorb.
  const currentTruck = useMemo(() => {
    const candidates = [currentUser?.name, currentUser?.username]
      .map(v => cleanField(v).toLowerCase())
      .filter(Boolean);
    const userIds = [currentUser?.id, currentUser?._id].map(v => cleanField(v)).filter(Boolean);

    const match = (trucks || []).find(t => {
      if (userIds.includes(cleanField(t.id))) return true;
      const truckNames = [t.driver, t.name, t.username]
        .map(v => cleanField(v).toLowerCase())
        .filter(Boolean);
      return truckNames.some(n => candidates.includes(n));
    });
    if (match) return match;

    // No driver row on the board yet — stand one up from this user. The id has
    // to follow the board's own scheme (`drv_<username>`, which is what every
    // saved delivery's truckId holds), or the fallback resolves to a driver
    // with no stops. Not the user's _id: /api/salesreps does return one now,
    // and it matches nothing on the board.
    if (currentUser) {
      const username = cleanField(currentUser.username);
      return {
        id: username ? `drv_${username}` : (cleanField(currentUser._id) || cleanField(currentUser.id)),
        name: currentUser.name || currentUser.username,
        driver: currentUser.name || currentUser.username,
        color: '#D4AF37'
      };
    }
    return trucks[0] || { id: 'trk_1', name: 'Driver Truck', driver: 'Driver', color: '#D4AF37' };
  }, [trucks, currentUser]);

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [copiedId, setCopiedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Landing on the week that contains today should open on today; any other
  // week opens on its Monday.
  useEffect(() => {
    if (weekDates.length > 0 && !weekDates.includes(selectedDate)) {
      setSelectedDate(weekDates.includes(todayStr) ? todayStr : weekDates[0]);
    }
  }, [weekDates, selectedDate, todayStr]);

  // ── This driver's stops, grouped by day ─────────────────────────────────
  // Built once per data change instead of re-filtering the whole list inside
  // every day pill's render.
  const stopsByDate = useMemo(() => {
    // Every id this driver could have been filed under. Deliveries carry
    // `drv_<username>`, but a record written under an older scheme may hold the
    // user's _id — both are this driver and neither can collide with another.
    const username = cleanField(currentUser?.username);
    const truckIds = new Set(
      [currentTruck?.id, username && `drv_${username}`, currentUser?._id, currentUser?.id]
        .map(v => cleanField(v).toLowerCase())
        .filter(Boolean)
    );
    const truckDriver = [currentTruck?.driver, currentTruck?.name, currentTruck?.username]
      .map(v => cleanField(v).toLowerCase())
      .filter(Boolean);

    const isMine = (del) => {
      // The customer collects a will call themselves, so it is on nobody's run —
      // including older ones still carrying the truckId they were created under.
      if (del.deliveryType === 'will_call') return false;
      if (truckIds.has(cleanField(del.truckId).toLowerCase())) return true;
      // Names are compared whole. A "contains" match put Jose's stops on Jose
      // M's manifest, which is the one mistake a driver's day cannot absorb.
      const named = [del.driver, del.truckDriver, del.assignedDriver, del.driverName]
        .map(v => cleanField(v).toLowerCase())
        .filter(Boolean);
      return named.some(n => truckDriver.includes(n));
    };

    const grouped = new Map();
    for (const del of deliveries) {
      if (!del?.date || !isMine(del)) continue;
      const key = String(del.date).slice(0, 10);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(del);
    }

    // Route number first, then appointment time — a board where the office left
    // every stop on the default route number still comes out in time order
    // rather than whatever the database happened to return.
    for (const list of grouped.values()) {
      list.sort((a, b) =>
        (a.routeNumber || 1) - (b.routeNumber || 1) ||
        timeToMinutes(a.time) - timeToMinutes(b.time) ||
        String(a.customerName || '').localeCompare(String(b.customerName || ''))
      );
    }
    return grouped;
  }, [deliveries, currentTruck, currentUser]);

  const dayStops = useMemo(() => stopsByDate.get(selectedDate) || [], [stopsByDate, selectedDate]);
  const completedCount = dayStops.filter(d => d.status === 'completed').length;
  const otherDaysWithStops = weekDates.filter(d => d !== selectedDate && (stopsByDate.get(d) || []).length > 0);

  const driverDisplayName = currentUser?.name || currentTruck?.driver || currentTruck?.name || 'Driver';
  const accent = currentTruck?.color || '#D4AF37';

  const handleCopy = useCallback((id, value) => {
    if (!value || !navigator.clipboard) return;
    navigator.clipboard.writeText(value)
      .then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), 1800);
      })
      .catch(() => {});
  }, []);

  // A status tap that fails has to say so. It used to resolve silently, leaving
  // the driver looking at a button that had done nothing.
  const handleStatus = useCallback(async (del, nextStatus) => {
    if (!onUpdateStatus) return;
    setBusyId(del.id);
    setActionError(null);
    try {
      await onUpdateStatus(del.id, nextStatus);
    } catch (err) {
      setActionError(err?.message || "Couldn't reach the office — check your signal and try again.");
    } finally {
      setBusyId(prev => (prev === del.id ? null : prev));
    }
  }, [onUpdateStatus]);

  const handleRefresh = useCallback(async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    setActionError(null);
    try {
      await onRefresh();
    } catch (err) {
      setActionError(err?.message || "Couldn't refresh — check your signal.");
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh, isRefreshing]);

  const connectionNote = CONNECTION_LABELS[connection];

  return (
    <div className="dv-root" style={{ '--dv-accent': accent }}>

      {/* ── Week strip ─────────────────────────────────────────────────── */}
      <div className="dv-daybar" role="tablist" aria-label="Days this week">
        {DAYS_OF_WEEK.map((dayObj, idx) => {
          const dateStr = weekDates[idx] || '';
          const isSelected = selectedDate === dateStr;
          const isToday = dateStr === todayStr;
          const count = (stopsByDate.get(dateStr) || []).length;

          return (
            <button
              key={dayObj.short}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-label={`${dayObj.name}, ${count} ${count === 1 ? 'stop' : 'stops'}`}
              className={`dv-day ${isSelected ? 'is-active' : ''} ${isToday ? 'is-today' : ''}`}
              onClick={() => setSelectedDate(dateStr)}
            >
              <span className="dv-day-name">{dayObj.short.toUpperCase()}</span>
              <span className="dv-day-num">{dateStr ? dateStr.split('-')[2] : '—'}</span>
              <span className="dv-day-count">
                {isToday && isSelected ? 'Today' : count === 1 ? '1 stop' : `${count} stops`}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Day summary ────────────────────────────────────────────────── */}
      <div className="dv-summary">
        <div className="dv-summary-text">
          <span className="dv-summary-count">
            {dayStops.length === 0
              ? 'No stops scheduled'
              : `${dayStops.length} stop${dayStops.length !== 1 ? 's' : ''} · ${completedCount} delivered`}
          </span>
          {dayStops.length > 0 && (
            <span className="dv-progress" aria-hidden="true">
              <span
                className="dv-progress-fill"
                style={{ width: `${Math.round((completedCount / dayStops.length) * 100)}%` }}
              />
            </span>
          )}
        </div>
        {onRefresh && (
          <button
            type="button"
            className="dv-refresh"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh stops"
          >
            <RefreshCw size={15} className={isRefreshing ? 'dv-spin' : ''} />
            <span>{isRefreshing ? 'Refreshing' : 'Refresh'}</span>
          </button>
        )}
      </div>

      {connectionNote && (
        <div className="dv-banner dv-banner-warn" role="status">
          <WifiOff size={15} />
          <span>{connectionNote}</span>
        </div>
      )}

      {loadError && (
        <div className="dv-banner dv-banner-error" role="alert">
          <AlertTriangle size={15} />
          <span>{loadError}</span>
        </div>
      )}

      {actionError && (
        <div className="dv-banner dv-banner-error" role="alert">
          <AlertTriangle size={15} />
          <span>{actionError}</span>
        </div>
      )}

      {/* ── Manifest ───────────────────────────────────────────────────── */}
      <section className="dv-manifest">
        <header className="dv-manifest-header">
          <span className="dv-driver">
            <span className="dv-driver-dot" />
            <span className="dv-driver-name">{driverDisplayName}</span>
          </span>
          <span className="dv-tally">{completedCount}/{dayStops.length}</span>
        </header>

        {dayStops.length === 0 ? (
          <div className="dv-empty">
            <Package size={34} aria-hidden="true" />
            <p className="dv-empty-title">Nothing scheduled for this day</p>
            {otherDaysWithStops.length > 0 && (
              <div className="dv-empty-jump">
                <span>You have stops on:</span>
                <div className="dv-empty-jump-row">
                  {otherDaysWithStops.map(dStr => {
                    const n = (stopsByDate.get(dStr) || []).length;
                    return (
                      <button key={dStr} type="button" className="dv-jump-btn" onClick={() => setSelectedDate(dStr)}>
                        {dStr.slice(5)} · {n} stop{n !== 1 ? 's' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <ol className="dv-stops">
            {dayStops.map((del, idx) => {
              // Sequential position, not the raw routeNumber. The office leaves
              // that at its default of 1 more often than not, which rendered a
              // whole day of stops all numbered "Stop #1".
              const stopNum = idx + 1;
              const soVal = cleanField(del.soNumber) || cleanField(del.invoiceNumber);
              const isTransfer = del.deliveryType === 'transfer';
              const address = cleanField(del.address) || cleanField(del.city);
              const mapsHref = mapsHrefFor(address);
              const phone = cleanField(del.phone) || cleanField(del.customerPhone) || cleanField(del.contactPhone);
              const time = cleanField(del.time);
              const notes = cleanField(del.notes);
              const isDone = del.status === 'completed';
              const isLate = del.status === 'delayed';
              const isBusy = busyId === del.id;
              const hasProof = Boolean(del.pod?.verified);
              const awaitingResign = Boolean(del.pod?.clearedAt) && !hasProof;

              return (
                <li key={del.id} className={`dv-stop is-${del.status || 'scheduled'}`}>
                  <div className="dv-stop-top">
                    <span className="dv-stop-badge">
                      {isTransfer
                        ? <><Repeat size={12} aria-hidden="true" /> Transfer</>
                        : <><Navigation size={12} aria-hidden="true" /> Stop {stopNum}</>}
                    </span>
                    <StatusPill status={del.status} size="small" />
                  </div>

                  <h3 className="dv-stop-customer">
                    {isTransfer && cleanField(del.transferDestination)
                      ? `Transfer → ${cleanField(del.transferDestination)}`
                      : cleanField(del.customerName) || 'Unnamed stop'}
                  </h3>

                  <dl className="dv-stop-meta">
                    {address && (
                      <div className="dv-meta-row">
                        <dt><MapPin size={14} aria-hidden="true" /><span className="dv-sr">Address</span></dt>
                        <dd>{address}</dd>
                      </div>
                    )}
                    {time && (
                      <div className="dv-meta-row">
                        <dt><Clock size={14} aria-hidden="true" /><span className="dv-sr">Time</span></dt>
                        <dd>{time}</dd>
                      </div>
                    )}
                    {soVal && (
                      <div className="dv-meta-row">
                        <dt><FileText size={14} aria-hidden="true" /><span className="dv-sr">Reference</span></dt>
                        <dd>
                          <button
                            type="button"
                            className={`dv-copy ${copiedId === del.id ? 'is-copied' : ''}`}
                            onClick={() => handleCopy(del.id, soVal)}
                            title={copiedId === del.id ? 'Copied' : `Copy ${isTransfer ? 'transfer number' : 'SO number'}`}
                          >
                            {isTransfer ? 'Transfer' : 'SO'} #{soVal}
                            {copiedId === del.id ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </dd>
                      </div>
                    )}
                    {!isTransfer && cleanField(del.salesRepName) && (
                      <div className="dv-meta-row">
                        <dt><User size={14} aria-hidden="true" /><span className="dv-sr">Sales rep</span></dt>
                        <dd>{cleanField(del.salesRepName)}</dd>
                      </div>
                    )}
                  </dl>

                  {/* The office writes these for the driver and nothing was
                      showing them — gate codes, who to ask for, where to back in. */}
                  {notes && (
                    <p className="dv-stop-notes">
                      <FileText size={13} aria-hidden="true" />
                      <span>{notes}</span>
                    </p>
                  )}

                  {(hasProof || awaitingResign) && (
                    <p className={`dv-proof ${awaitingResign ? 'is-pending' : ''}`}>
                      {awaitingResign
                        ? <><RotateCcw size={12} aria-hidden="true" /> Signature was cleared — needs re-signing</>
                        : <><ShieldCheck size={12} aria-hidden="true" /> Signed ePOD on file</>}
                    </p>
                  )}

                  <div className="dv-stop-actions">
                    {mapsHref && (
                      <a
                        className="dv-btn dv-btn-nav"
                        href={mapsHref}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Navigation size={15} aria-hidden="true" /> Navigate
                      </a>
                    )}

                    {phone && (
                      <a className="dv-btn dv-btn-call" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
                        <Phone size={15} aria-hidden="true" /> Call
                      </a>
                    )}

                    {del.packingListUrl && (
                      <button
                        type="button"
                        className="dv-btn dv-btn-doc"
                        onClick={() => openPdfInline(del.packingListUrl)}
                      >
                        <FileText size={15} aria-hidden="true" /> Packing list
                      </button>
                    )}

                    {/* Toggles. A stop wrongly marked late had no way back, so
                        the board kept showing a delay that had been cleared. */}
                    {!isDone && (
                      <button
                        type="button"
                        className={`dv-btn dv-btn-late ${isLate ? 'is-on' : ''}`}
                        onClick={() => handleStatus(del, isLate ? 'scheduled' : 'delayed')}
                        disabled={isBusy}
                      >
                        {isLate
                          ? <><Undo2 size={15} aria-hidden="true" /> Back on time</>
                          : <><AlertTriangle size={15} aria-hidden="true" /> Running late</>}
                      </button>
                    )}

                    <button
                      type="button"
                      className={`dv-btn dv-btn-deliver ${isDone ? 'is-done' : ''}`}
                      onClick={() => {
                        if (isDone && onViewPod) onViewPod(del);
                        else if (onOpenPod) onOpenPod(del);
                      }}
                      disabled={isBusy}
                    >
                      <CheckCircle2 size={15} aria-hidden="true" />
                      {isDone ? 'View ePOD' : 'Delivered / Sign ePOD'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
};

export default DriverView;
