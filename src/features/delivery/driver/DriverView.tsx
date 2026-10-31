// The mobile-first view a driver sees instead of BoardGrid.tsx — just their
// own stops, no truck-column layout. Its only two writes are updating a
// stop's status and opening PodModal to capture a signature (which saves
// through the same general upsert as everything else) — a driver's account
// never holds edit_delivery_schedule, so those two routes are the only ones
// in src/routes/deliveries.ts that deliberately accept view_delivery_schedule
// as well. See that file's permission-model comment before adding a new
// driver-facing action, and src/features/delivery/README.md for how
// this fits with the rest of the feature.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, Package, RefreshCw, WifiOff } from 'lucide-react';
import { formatForDateInput } from '../../../utils/dateUtils';
// Day names derive from the dates themselves, so the strip follows whichever
// days the week is showing rather than a fixed Mon-Fri list.
import { dayLabel } from '../../../utils/deliveryWeek';
import { isCounterReturn } from '../../../utils/deliveryTypes';
import DriverStop from './DriverStop';
import { cleanField, timeToMinutes, CONNECTION_LABELS } from './driverFormat';
import type { CurrentUser } from '../../../types/records';
import type { ConnectionStatus } from '../../../api/deliverySchedule';
import type { BoardColumn, Ticket } from '../types';
import './DriverView.css';

export type DriverViewProps = {
  trucks?: BoardColumn[];
  deliveries?: Ticket[];
  weekDates?: string[];
  currentUser?: CurrentUser | null;
  /** Rethrows on failure, so the stop can say it didn't work. */
  onUpdateStatus?: (id: string, status: string) => Promise<unknown>;
  onOpenPod?: (delivery: Ticket) => void;
  onViewPod?: (delivery: Ticket) => void;
  connection?: ConnectionStatus;
  onRefresh?: () => Promise<unknown>;
  loadError?: string | null;
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
}: DriverViewProps) => {
  const todayStr = formatForDateInput(new Date());

  // ── Which truck/driver column is this user? ──────────────────────────────
  // Matched exactly, never by substring. A "contains" match put Jose's stops on
  // Jose M's manifest, which is the one mistake a driver's day cannot absorb.
  const currentTruck = useMemo((): Partial<BoardColumn> => {
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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

    const isMine = (del: Ticket) => {
      // The customer collects a will call themselves, so it is on nobody's run —
      // including older ones still carrying the truckId they were created under.
      if (del.deliveryType === 'will_call') return false;
      // A customer drop-off is the same story: they bring it back to us, so no
      // driver goes anywhere. A return WITH a driver is the opposite — that is
      // a real stop on this run and falls through to the checks below, because
      // somebody has to actually drive out and collect it.
      if (isCounterReturn(del)) return false;
      if (truckIds.has(cleanField(del.truckId).toLowerCase())) return true;
      // Names are compared whole. A "contains" match put Jose's stops on Jose
      // M's manifest, which is the one mistake a driver's day cannot absorb.
      const named = [del.driver, del.truckDriver, del.assignedDriver, del.driverName]
        .map(v => cleanField(v).toLowerCase())
        .filter(Boolean);
      return named.some(n => truckDriver.includes(n));
    };

    const grouped = new Map<string, Ticket[]>();
    for (const del of deliveries) {
      if (!del?.date || !isMine(del)) continue;
      const key = String(del.date).slice(0, 10);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(del);
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

  const handleCopy = useCallback((id: string, value: string) => {
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
  const handleStatus = useCallback(async (del: Ticket, nextStatus: string) => {
    if (!onUpdateStatus) return;
    setBusyId(del.id);
    setActionError(null);
    try {
      await onUpdateStatus(del.id, nextStatus);
    } catch (err) {
      setActionError((err as Error)?.message || "Couldn't reach the office — check your signal and try again.");
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
      setActionError((err as Error)?.message || "Couldn't refresh — check your signal.");
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh, isRefreshing]);

  const connectionNote = CONNECTION_LABELS[connection];

  return (
    <div className="dv-root" style={{ '--dv-accent': accent } as React.CSSProperties}>

      {/* ── Week strip ─────────────────────────────────────────────────── */}
      <div className="dv-daybar" role="tablist" aria-label="Days this week">
        {weekDates.map((dateStr) => {
          const isSelected = selectedDate === dateStr;
          const isToday = dateStr === todayStr;
          const count = (stopsByDate.get(dateStr) || []).length;
          const label = dayLabel(dateStr);

          return (
            <button
              key={dateStr}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-label={`${label.name}, ${count} ${count === 1 ? 'stop' : 'stops'}`}
              className={`dv-day ${isSelected ? 'is-active' : ''} ${isToday ? 'is-today' : ''}`}
              onClick={() => setSelectedDate(dateStr)}
            >
              <span className="dv-day-name">{label.short.toUpperCase()}</span>
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
            {dayStops.map((del) => (
              <DriverStop
                key={del.id}
                del={del}
                copiedId={copiedId}
                busyId={busyId}
                onCopy={handleCopy}
                onStatus={handleStatus}
                onOpenPod={onOpenPod}
                onViewPod={onViewPod}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
};

export default DriverView;
