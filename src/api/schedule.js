import { API_URL } from '../config/api';
import { io } from 'socket.io-client';

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
  socket: null
};

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
// sit in, so it waits in the Pending list until one is chosen.
const isPendingDelivery = (d) => !d || !d.truckId;

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
    refreshActiveWeek().catch(() => {});
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
      // Re-sync the currently viewed week on connection / reconnection, in case
      // any updates were missed while offline.
      refreshActiveWeek();
    });

    scheduleCache.socket.on('disconnect', () => {
      startPolling();
    });

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
    } catch (e) {}
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
    const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
    const res = await fetch(`${API_URL}/api/trucks`, {
      credentials: 'include',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
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
const DRIVERS_CACHE_PREFIX = 'drivers_cache_v2:';
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
    const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
    const res = await fetch(`${API_URL}/api/salesreps`, {
      credentials: 'include',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
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
      id: u._id || `drv_${u.username}`,
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
    const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
    await fetch(`${API_URL}/api/trucks`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
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
  } catch (e) {}

  try {
    const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
    const params = new URLSearchParams({ startDate, endDate });
    const res = await fetch(`${API_URL}/api/deliveries?${params.toString()}`, {
      credentials: 'include',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
    } else {
      console.warn('[schedule] getDeliveriesForRange response not OK:', res.status);
    }
  } catch (err) {
    console.error('[schedule] getDeliveriesForRange API error:', err);
  }

  return [];
}

// ── GET PENDING DELIVERIES (no agreed date yet) ──
export async function getPendingDeliveries() {
  try {
    const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
    const res = await fetch(`${API_URL}/api/deliveries?pending=true`, {
      credentials: 'include',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
    } else {
      console.warn('[schedule] getPendingDeliveries response not OK:', res.status);
    }
  } catch (err) {
    console.error('[schedule] getPendingDeliveries API error:', err);
  }
  return [];
}

// ── SAVE / UPDATE DELIVERY (100% MONGODB DATABASE) ──
export async function saveDelivery(delivery) {
  try {
    const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
    const res = await fetch(`${API_URL}/api/deliveries`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(delivery)
    });
    if (res.ok) {
      const updated = await res.json();
      if (updated && updated.id) {
        upsertDeliveryIntoCache(updated);
        notifyScheduleListeners();
        return getActiveWeekDeliveries();
      }
    } else {
      console.error('[schedule] saveDelivery API failed with status:', res.status);
    }
  } catch (err) {
    console.error('[schedule] saveDelivery API error:', err);
  }

  await refreshActiveWeek();
  return getActiveWeekDeliveries();
}

// ── GET SINGLE DELIVERY WITH FULL POD DATA (signatures/photos excluded from list fetches) ──
export async function getDeliveryById(id) {
  try {
    const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
    const res = await fetch(`${API_URL}/api/deliveries/${id}`, {
      credentials: 'include',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
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
    const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
    const res = await fetch(`${API_URL}/api/deliveries/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
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

  await refreshActiveWeek();
  return getActiveWeekDeliveries();
}

// ── UPDATE DELIVERY STATUS (100% MONGODB DATABASE) ──
export async function updateDeliveryStatus(id, newStatus) {
  const currentList = getActiveWeekDeliveries();
  const item = currentList.find(d => d.id === id);
  if (item) {
    const updatedItem = { ...item, status: newStatus };
    return await saveDelivery(updatedItem);
  }
  return currentList;
}

