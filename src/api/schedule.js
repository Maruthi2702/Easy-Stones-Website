import { API_URL } from '../config/api';
import { io } from 'socket.io-client';
import { authFetch } from './authFetch';

export const MAX_TRUCK_CAPACITY = 12;

export const DEFAULT_TRUCKS = [
  { id: 'trk_1', name: 'Truck 1', driver: '', color: '#D4AF37' },
  { id: 'trk_2', name: 'Truck 2', driver: '', color: '#2F8F73' },
  { id: 'trk_3', name: 'Truck 3', driver: '', color: '#E1602A' },
  { id: 'trk_4', name: 'Truck 4', driver: '', color: '#3B82F6' },
  { id: 'trk_5', name: 'Truck 5', driver: '', color: '#8B5CF6' },
  { id: 'trk_6', name: 'Truck 6', driver: '', color: '#64748B' },
  { id: 'trk_3rd_party', name: '3rd Party Freight', driver: '', color: '#a855f7', isContract: true }
];

export const INITIAL_SAMPLE_DELIVERIES = [];

// ── IN-MEMORY CACHE & REAL-TIME SOCKET LISTENER ──
// The board only ever displays one week at a time, so deliveries are cached
// per week (keyed by that week's Monday, 'YYYY-MM-DD') instead of as one flat,
// ever-growing list. Opening/refreshing loads just the current week; navigating
// to a week already visited this session serves straight from cache instead of
// re-fetching.
const scheduleCache = {
  weeks: new Map(),       // weekStart ('YYYY-MM-DD') -> deliveries[]
  pending: [],            // orders with no driver assigned — shown under every week
  pendingLoaded: false,
  activeWeekStart: null,  // week currently being viewed — real-time updates & the
  activeWeekEnd: null,    // 3s poll fallback are scoped to this range only
  trucks: null,
  listeners: new Set(),
  socket: null,
  // 'online' | 'reconnecting' | 'offline'. A driver works out of cell coverage,
  // so the board has to be able to say whether what it is showing is live —
  // silently going stale is the failure that gets a stop delivered twice.
  connection: 'reconnecting',
  connectionListeners: new Set(),
  lastSyncedAt: null
};

function setConnectionStatus(status) {
  if (scheduleCache.connection === status) return;
  scheduleCache.connection = status;
  scheduleCache.connectionListeners.forEach(cb => {
    try {
      cb({ status, lastSyncedAt: scheduleCache.lastSyncedAt });
    } catch {
      // a listener throwing must not stop the others being told
    }
  });
}

/**
 * Watch the live-connection state. Returns an unsubscribe function and fires
 * once immediately, so a component mounting mid-outage renders the truth rather
 * than waiting for the next transition.
 */
export function subscribeScheduleConnection(callback) {
  scheduleCache.connectionListeners.add(callback);
  try {
    callback({ status: scheduleCache.connection, lastSyncedAt: scheduleCache.lastSyncedAt });
  } catch {
    // as above
  }
  return () => {
    scheduleCache.connectionListeners.delete(callback);
  };
}

export function getScheduleConnection() {
  return { status: scheduleCache.connection, lastSyncedAt: scheduleCache.lastSyncedAt };
}

/**
 * Pull the viewed week again, now. The socket normally keeps the board current;
 * this is the manual override for when someone doesn't trust what they're
 * looking at — the one thing a driver reliably reaches for on a bad signal.
 */
export async function refreshScheduleNow() {
  await refreshActiveWeek();
  return getActiveWeekDeliveries();
}

function addDaysToDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function getActiveWeekDeliveries() {
  if (!scheduleCache.activeWeekStart) return [];
  return scheduleCache.weeks.get(scheduleCache.activeWeekStart) || [];
}

// Pending means no driver assigned yet — such an order has no truck column to
// sit in, so it waits in the Pending list until one is chosen. A will call is
// the exception: the customer collects it, so it never gets a driver and sits
// in the board's own Will Call column on its pickup date instead.
const isPendingDelivery = (d) => !d || (!d.truckId && d.deliveryType !== 'will_call');

// Merge a single created/updated delivery into whichever cached week(s) it
// belongs to (and remove it from any cached week it no longer belongs to,
// e.g. if its date was edited).
function upsertDeliveryIntoCache(delivery) {
  if (!delivery || !delivery.id) return;
  for (const [weekStart, list] of scheduleCache.weeks.entries()) {
    if (list.some(d => d.id === delivery.id)) {
      scheduleCache.weeks.set(weekStart, list.filter(d => d.id !== delivery.id));
    }
  }
  scheduleCache.pending = scheduleCache.pending.filter(d => d.id !== delivery.id);

  // Assigning a driver moves the order out of the list and onto that week;
  // unassigning moves it back.
  if (isPendingDelivery(delivery)) {
    scheduleCache.pending = [delivery, ...scheduleCache.pending];
    return;
  }
  for (const weekStart of scheduleCache.weeks.keys()) {
    const weekEnd = addDaysToDateStr(weekStart, 4);
    if (delivery.date >= weekStart && delivery.date <= weekEnd) {
      scheduleCache.weeks.set(weekStart, [...scheduleCache.weeks.get(weekStart), delivery]);
      break;
    }
  }
}

function removeDeliveryFromCache(id) {
  for (const [weekStart, list] of scheduleCache.weeks.entries()) {
    if (list.some(d => d.id === id)) {
      scheduleCache.weeks.set(weekStart, list.filter(d => d.id !== id));
    }
  }
  scheduleCache.pending = scheduleCache.pending.filter(d => d.id !== id);
}

async function refreshActiveWeek() {
  if (!scheduleCache.activeWeekStart || !scheduleCache.activeWeekEnd) return;
  const [list, pendingList] = await Promise.all([
    getDeliveriesForRange(scheduleCache.activeWeekStart, scheduleCache.activeWeekEnd),
    getPendingDeliveries()
  ]);
  const weekChanged = JSON.stringify(list) !== JSON.stringify(scheduleCache.weeks.get(scheduleCache.activeWeekStart) || []);
  const pendingChanged = JSON.stringify(pendingList) !== JSON.stringify(scheduleCache.pending);
  if (weekChanged) scheduleCache.weeks.set(scheduleCache.activeWeekStart, list);
  if (pendingChanged) scheduleCache.pending = pendingList;
  scheduleCache.lastSyncedAt = Date.now();
  if (weekChanged || pendingChanged) notifyScheduleListeners();
}

// Polling is only a fallback for when the socket connection is actually down —
// not a constant background drip. Real-time updates come from the socket; this
// just catches up once the connection is (re)established, or bridges the gap
// while it's disconnected/reconnecting.
let pollIntervalId = null;

function startPolling() {
  if (pollIntervalId) return;
  pollIntervalId = setInterval(() => {
    // A poll that lands is the board still being current, even with the socket
    // down — worth saying, because "reconnecting" and "not updating at all" are
    // very different things to be looking at a delivery list through.
    refreshActiveWeek()
      .then(() => setConnectionStatus('reconnecting'))
      .catch(() => setConnectionStatus('offline'));
  }, 3000);
}

function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

function initScheduleSocket() {
  if (scheduleCache.socket) return;
  try {
    const socketUrl = API_URL || (typeof window !== 'undefined' ? window.location.origin : undefined);

    scheduleCache.socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    // Assume disconnected until the socket proves otherwise — covers both an
    // initial connection that's slow/fails, and later drops.
    startPolling();

    scheduleCache.socket.on('connect', () => {
      stopPolling();
      setConnectionStatus('online');
      // Re-sync the currently viewed week on connection / reconnection, in case
      // any updates were missed while offline.
      refreshActiveWeek();
    });

    scheduleCache.socket.on('disconnect', () => {
      setConnectionStatus('reconnecting');
      startPolling();
    });

    scheduleCache.socket.on('connect_error', () => {
      setConnectionStatus('offline');
      startPolling();
    });

    // The socket can take its reconnect delay to notice a tunnel; the browser
    // knows at once. Trust it for the bad news, but never for the good — only
    // a completed round trip proves the server is actually reachable again.
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', () => setConnectionStatus('offline'));
      window.addEventListener('online', () => {
        setConnectionStatus('reconnecting');
        refreshActiveWeek().catch(() => setConnectionStatus('offline'));
      });
      if (window.navigator && window.navigator.onLine === false) {
        setConnectionStatus('offline');
      }
    }

    scheduleCache.socket.on('delivery_update', (payload) => {
      if (!payload) return;
      if (payload.type === 'delete' && payload.id) {
        removeDeliveryFromCache(payload.id);
        notifyScheduleListeners();
      } else if (payload.type === 'upsert' && payload.delivery) {
        upsertDeliveryIntoCache(payload.delivery);
        notifyScheduleListeners();
      }
    });

    scheduleCache.socket.on('truck_update', () => {
      getDriverUsers(null, [], { force: true }).then(drivers => {
        if (drivers && drivers.length > 0) {
          scheduleCache.trucks = drivers;
          notifyScheduleListeners();
        }
      });
    });
  } catch (err) {
    console.warn('[schedule] Socket init error:', err);
  }
}

function notifyScheduleListeners() {
  scheduleCache.listeners.forEach(cb => {
    try {
      cb({
        deliveries: getActiveWeekDeliveries(),
        pending: scheduleCache.pending,
        trucks: scheduleCache.trucks || []
      });
    } catch {
      // one listener throwing must not stop the others being told
    }
  });
}

export function subscribeScheduleCache(callback) {
  initScheduleSocket();
  scheduleCache.listeners.add(callback);
  return () => {
    scheduleCache.listeners.delete(callback);
  };
}

export function getScheduleCacheSync() {
  return {
    deliveries: getActiveWeekDeliveries(),
    pending: scheduleCache.pending,
    trucks: scheduleCache.trucks,
    isLoaded: Boolean(scheduleCache.activeWeekStart && scheduleCache.weeks.has(scheduleCache.activeWeekStart))
  };
}

// Sync helpers for a given week's initial React state, before it becomes "active"
// (i.e. before getScheduleDataCached has been called for it).
export function isWeekCached(weekStart) {
  return scheduleCache.weeks.has(weekStart);
}

export function getCachedWeekDeliveries(weekStart) {
  return scheduleCache.weeks.get(weekStart) || [];
}

export async function getScheduleDataCached(currentUser = null, weekStart, weekEnd, forceRefresh = false) {
  initScheduleSocket();

  scheduleCache.activeWeekStart = weekStart;
  scheduleCache.activeWeekEnd = weekEnd;

  // Trucks are small and shared across every week — load once, reuse.
  if (!scheduleCache.trucks || forceRefresh) {
    const userLocation = currentUser?.location || null;
    const userAssignedLocations = currentUser?.assignedLocations || [];
    scheduleCache.trucks = (await getDriverUsers(userLocation, userAssignedLocations, { force: forceRefresh })) || [];
  }

  if (scheduleCache.weeks.has(weekStart) && !forceRefresh) {
    notifyScheduleListeners();
    return { deliveries: scheduleCache.weeks.get(weekStart), pending: scheduleCache.pending, trucks: scheduleCache.trucks };
  }

  const [list, pendingList] = await Promise.all([
    getDeliveriesForRange(weekStart, weekEnd),
    // Pending belongs to no week, so it is only fetched when there is nothing
    // cached yet or the caller explicitly asked for fresh data.
    (scheduleCache.pendingLoaded && !forceRefresh) ? Promise.resolve(scheduleCache.pending) : getPendingDeliveries()
  ]);
  scheduleCache.weeks.set(weekStart, list || []);
  scheduleCache.pending = pendingList || [];
  scheduleCache.pendingLoaded = true;
  scheduleCache.lastSyncedAt = Date.now();
  // A completed round trip is the only proof the server is reachable — the
  // socket may still be mid-handshake at this point.
  if (scheduleCache.connection === 'offline') setConnectionStatus('reconnecting');

  notifyScheduleListeners();

  return {
    deliveries: scheduleCache.weeks.get(weekStart),
    pending: scheduleCache.pending,
    trucks: scheduleCache.trucks
  };
}

// ── GET TRUCKS ──
export async function getTrucks() {
  try {
    const res = await authFetch(`${API_URL}/api/trucks`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (err) {
    console.warn('[schedule] getTrucks error:', err);
  }
  return DEFAULT_TRUCKS;
}

// ── GET DRIVERS FROM USERS TAB (filtered by location) ──
const TRUCK_COLORS = ['#D4AF37', '#2F8F73', '#E1602A', '#3B82F6', '#8B5CF6', '#64748B', '#10B981', '#F59E0B'];

// Drivers change rarely but cost a full round trip on every page load, which is
// pure latency against a remote database. Persist the resolved list so a reload
// paints immediately; truck_update and an explicit refresh both bypass this.
// Bumped to v2 when driver names started coming from Display Name: entries
// written by an older build hold the previous names, and a version bump drops
// them everywhere at once instead of waiting out each browser's TTL.
// Bumped to v3 after a build briefly keyed columns by user _id instead of
// `drv_<username>`: those entries match no delivery's truckId, so a board
// painting from one shows every column empty. They have to be retired on sight
// rather than left to expire.
const DRIVERS_CACHE_PREFIX = 'drivers_cache_v3:';
const DRIVERS_CACHE_TTL = 10 * 60 * 1000;

/**
 * Drop every cached driver list. Renaming or adding a user changes what the
 * board shows, and a 10-minute TTL is far too long to wait to see your own
 * edit — Users & Roles calls this on save, and the server emits `truck_update`
 * so other people's open boards refetch too.
 */
export function clearDriversCache() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(DRIVERS_CACHE_PREFIX))
      .forEach(k => localStorage.removeItem(k));
  } catch {
    // storage unavailable — nothing cached to clear
  }
}

const readDriversCache = (key) => {
  try {
    const raw = localStorage.getItem(DRIVERS_CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (!Array.isArray(data) || Date.now() - ts > DRIVERS_CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
};

const writeDriversCache = (key, data) => {
  try {
    localStorage.setItem(DRIVERS_CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // storage full or unavailable — the list is only ever a cache
  }
};

export async function getDriverUsers(userLocation = null, userAssignedLocations = [], { force = false } = {}) {
  const cacheKey = [userLocation || '', ...(userAssignedLocations || [])].join('|');
  if (!force) {
    const cached = readDriversCache(cacheKey);
    if (cached) {
      // Stale-while-revalidate. The board paints instantly from cache, but a
      // driver's name is not the kind of thing that should be allowed to sit
      // wrong for the rest of the TTL — refetch in the background and correct
      // the columns in place if anything actually changed.
      fetchDriverUsers(cacheKey, userLocation, userAssignedLocations)
        .then(fresh => {
          if (!fresh || JSON.stringify(fresh) === JSON.stringify(cached)) return;
          scheduleCache.trucks = fresh;
          notifyScheduleListeners();
        })
        .catch(() => {});
      return cached;
    }
  }

  return fetchDriverUsers(cacheKey, userLocation, userAssignedLocations);
}

async function fetchDriverUsers(cacheKey, userLocation = null, userAssignedLocations = []) {
  try {
    const res = await authFetch(`${API_URL}/api/salesreps`);
    if (!res.ok) throw new Error('Failed to fetch users');
    const payload = await res.json();
    const allUsers = payload.data || payload || [];

    // Filter to driver/logistics role users only
    let drivers = allUsers.filter(u =>
      u.role === 'driver' || u.role === 'logistics'
    );

    // Filter to users assigned to the current user's location
    if (userLocation || userAssignedLocations.length > 0) {
      const filterLocs = userAssignedLocations.length > 0
        ? userAssignedLocations
        : [userLocation];

      if (!filterLocs.includes('*')) {
        drivers = drivers.filter(u => {
          const driverLocs = u.assignedLocations || (u.location ? [u.location] : []);
          if (driverLocs.includes('*')) return true;
          return driverLocs.some(loc => filterLocs.includes(loc));
        });
      }
    }

    if (drivers.length === 0) return null;

    const mapped = drivers.map((u, idx) => ({
      // `drv_<username>`, always — never the user's _id. Every delivery ever
      // saved carries a truckId in this form, and BoardGrid matches stops to
      // columns on it exactly, so an id from any other scheme empties the whole
      // board. This used to read `u._id || ...`, which was safe only for as long
      // as /api/salesreps happened not to return _id; the day it did, every
      // column stopped matching its own stops. The username is used verbatim,
      // spaces and all ('3rd party - delivery'), because that is what is stored.
      id: `drv_${u.username}`,
      name: u.name || u.username,
      driver: u.name || u.username,
      color: TRUCK_COLORS[idx % TRUCK_COLORS.length],
      username: u.username,
      location: u.location || (u.assignedLocations?.[0] || '')
    }));
    writeDriversCache(cacheKey, mapped);
    return mapped;
  } catch (err) {
    console.warn('[schedule] getDriverUsers error:', err);
    return null;
  }
}

// ── SAVE TRUCKS ──
export async function saveTrucks(trucks) {
  try {
    await authFetch(`${API_URL}/api/trucks`, {
      method: 'POST',
      body: JSON.stringify({ trucks })
    });
  } catch (err) {
    console.warn('[schedule] saveTrucks error:', err);
  }
  return trucks;
}

// ── GET DELIVERIES FOR A DATE RANGE (100% MONGODB DATABASE) ──
// startDate/endDate are 'YYYY-MM-DD'. Used to fetch exactly one displayed week
// instead of the entire delivery history.
export async function getDeliveriesForRange(startDate, endDate) {
  try {
    localStorage.removeItem('manifest_deliveries');
    localStorage.removeItem('manifest_trucks');
  } catch {
    // leftovers from the pre-database build; storage may be unavailable
  }

  try {
    const params = new URLSearchParams({ startDate, endDate });
    const res = await authFetch(`${API_URL}/api/deliveries?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
      throw new Error('Malformed delivery list response');
    }
    throw new Error(`Delivery list request failed (${res.status})`);
  } catch (err) {
    // Deliberately rethrown rather than answered with []. An empty array is
    // indistinguishable from a day with nothing on it, and a driver shown "no
    // stops" because of one dropped request is how a delivery gets missed.
    console.error('[schedule] getDeliveriesForRange API error:', err);
    throw err;
  }
}

// ── GET PENDING DELIVERIES (no agreed date yet) ──
export async function getPendingDeliveries() {
  try {
    const res = await authFetch(`${API_URL}/api/deliveries?pending=true`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
      throw new Error('Malformed pending list response');
    }
    throw new Error(`Pending list request failed (${res.status})`);
  } catch (err) {
    console.error('[schedule] getPendingDeliveries API error:', err);
    throw err;
  }
}

// ── SAVE / UPDATE DELIVERY (100% MONGODB DATABASE) ──
// Deliberately rethrown rather than swallowed to stale cache — the delivery
// modal awaits this and only closes once it resolves, so a save that fails
// silently here used to look like a success and discard what was typed.
export async function saveDelivery(delivery) {
  const res = await authFetch(`${API_URL}/api/deliveries`, {
    method: 'POST',
    body: JSON.stringify(delivery)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Could not save the delivery (${res.status}).`);
  }
  const updated = await res.json();
  if (!updated || !updated.id) throw new Error('Malformed delivery save response');
  upsertDeliveryIntoCache(updated);
  notifyScheduleListeners();
  return getActiveWeekDeliveries();
}

// ── GET SINGLE DELIVERY WITH FULL POD DATA (signatures/photos excluded from list fetches) ──
export async function getDeliveryById(id) {
  try {
    const res = await authFetch(`${API_URL}/api/deliveries/${id}`);
    if (res.ok) {
      return await res.json();
    }
    console.warn('[schedule] getDeliveryById response not OK:', res.status);
  } catch (err) {
    console.error('[schedule] getDeliveryById API error:', err);
  }
  return null;
}

// ── DELETE DELIVERY (100% MONGODB DATABASE) ──
export async function deleteDelivery(id) {
  try {
    const res = await authFetch(`${API_URL}/api/deliveries/${id}`, { method: 'DELETE' });
    if (res.ok) {
      removeDeliveryFromCache(id);
      notifyScheduleListeners();
      return getActiveWeekDeliveries();
    }
    if (res.status === 403) {
      // Reachable if the role's delete permission was revoked mid-session — without
      // this the click would just appear to do nothing.
      alert("You don't have permission to delete deliveries. Ask an administrator to grant Delivery Schedule → Delete for your role.");
      return getActiveWeekDeliveries();
    }
    console.error('[schedule] deleteDelivery API failed with status:', res.status);
  } catch (err) {
    console.error('[schedule] deleteDelivery API error:', err);
  }

  await refreshActiveWeek().catch(() => {});
  return getActiveWeekDeliveries();
}

// ── UPDATE DELIVERY STATUS ──
// Sends the status alone, not the whole record. Echoing a cached delivery back
// through POST /api/deliveries meant a driver tapping "Running Late" wrote every
// other field as their browser last saw it — quietly reverting an address or a
// time the office had changed in the meantime. It also can't be done offline in
// any honest way, so a failure is raised rather than swallowed.
export async function updateDeliveryStatus(id, newStatus) {
  const res = await authFetch(`${API_URL}/api/deliveries/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: newStatus })
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Couldn't update the stop (${res.status}).`);
  }

  const updated = await res.json();
  if (updated && updated.id) {
    upsertDeliveryIntoCache(updated);
    notifyScheduleListeners();
  }
  return getActiveWeekDeliveries();
}

