import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getScheduleDataCached,
  getLocationScopedScheduleData,
  peekLocationScopedWeek,
  getScheduleCacheSync,
  subscribeScheduleCache,
  subscribeScheduleChanges,
  isWeekCached,
  getCachedWeekDeliveries,
  subscribeScheduleConnection,
  getScheduleConnection,
  refreshScheduleNow
} from '../../api/deliverySchedule';
import type { ConnectionStatus } from '../../api/deliverySchedule';
import type { CurrentUser } from '../../types/records';
import type { BoardColumn, Ticket } from './types';

type Args = {
  currentUser: CurrentUser | null;
  /** The week on screen, Monday and Sunday ('YYYY-MM-DD'). */
  weekStart: string;
  weekEnd: string;
  /** '' = All Locations (the shared cache); a branch = its own fetch. */
  locationFilter: string;
};

/**
 * The Delivery Schedule's data: the week's tickets, Pending, Cancelled and the
 * driver columns, loading and its error, the live connection, and keeping all
 * of it current (the shared cache for All Locations, a refetch for one
 * branch). Stale responses never land: every load takes a number.
 */
export function useScheduleData({ currentUser, weekStart, weekEnd, locationFilter }: Args) {
  const [trucks, setTrucks] = useState<BoardColumn[]>(() => getScheduleCacheSync().trucks || []);
  const [deliveries, setDeliveries] = useState<Ticket[]>(() => getCachedWeekDeliveries(weekStart));
  const [pending, setPending] = useState<Ticket[]>(() => getScheduleCacheSync().pending || []);
  const [cancelled, setCancelled] = useState<Ticket[]>(() => getScheduleCacheSync().cancelled || []);
  const [loading, setLoading] = useState(() => !isWeekCached(weekStart));
  // A week that failed to load used to render as an empty board, which reads
  // exactly like a week with nothing scheduled on it.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>(() => getScheduleConnection().status);

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
  const trucksViewRef = useRef<string | null>(null);

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
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
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

  // Every save/move helper in deliverySchedule.ts hands back the shared
  // cache's week — every branch's tickets, or nothing if that cache was never
  // loaded. Right for the All Locations board; a board narrowed to one branch
  // refetches that branch instead.
  const applyUpdatedList = useCallback(async (updatedList: Ticket[] | undefined) => {
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

  return {
    trucks, setTrucks, deliveries, setDeliveries, pending, cancelled,
    loading, loadError, setLoadError, connection, loadData, applyUpdatedList, handleRefresh
  };
}
