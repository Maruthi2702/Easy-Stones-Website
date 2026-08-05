import { API_URL } from '../config/api';
import { io } from 'socket.io-client';

export const MAX_TRUCK_CAPACITY = 8;

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
const scheduleCache = {
  deliveries: null,
  trucks: null,
  isLoaded: false,
  listeners: new Set(),
  socket: null
};

function initScheduleSocket() {
  if (scheduleCache.socket) return;
  try {
    const socketUrl = API_URL || (typeof window !== 'undefined' ? window.location.origin : undefined);

    scheduleCache.socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    scheduleCache.socket.on('connect', () => {
      // Re-fetch latest deliveries on connection / reconnection
      getDeliveries().then(list => {
        if (Array.isArray(list)) {
          scheduleCache.deliveries = list;
          notifyScheduleListeners();
        }
      });
    });

    scheduleCache.socket.on('delivery_update', (updatedList) => {
      if (Array.isArray(updatedList)) {
        scheduleCache.deliveries = updatedList;
        notifyScheduleListeners();
      } else {
        getDeliveries().then(list => {
          scheduleCache.deliveries = list;
          notifyScheduleListeners();
        });
      }
    });

    scheduleCache.socket.on('truck_update', () => {
      getDriverUsers().then(drivers => {
        if (drivers && drivers.length > 0) {
          scheduleCache.trucks = drivers;
          notifyScheduleListeners();
        }
      });
    });

    // Background periodic poll every 3 seconds as a fallback safety net
    if (typeof window !== 'undefined' && !window.__deliveryPollInterval) {
      window.__deliveryPollInterval = setInterval(async () => {
        try {
          const list = await getDeliveries();
          if (Array.isArray(list) && JSON.stringify(list) !== JSON.stringify(scheduleCache.deliveries)) {
            scheduleCache.deliveries = list;
            notifyScheduleListeners();
          }
        } catch (e) {}
      }, 3000);
    }
  } catch (err) {
    console.warn('[schedule] Socket init error:', err);
  }
}

function notifyScheduleListeners() {
  scheduleCache.listeners.forEach(cb => {
    try {
      cb({
        deliveries: scheduleCache.deliveries || [],
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
    deliveries: scheduleCache.deliveries,
    trucks: scheduleCache.trucks,
    isLoaded: scheduleCache.isLoaded
  };
}

export async function getScheduleDataCached(currentUser = null, forceRefresh = false) {
  initScheduleSocket();

  if (scheduleCache.isLoaded && !forceRefresh) {
    return {
      deliveries: scheduleCache.deliveries || [],
      trucks: scheduleCache.trucks || []
    };
  }

  const userLocation = currentUser?.location || null;
  const userAssignedLocations = currentUser?.assignedLocations || [];

  const [driverUsers, dList] = await Promise.all([
    getDriverUsers(userLocation, userAssignedLocations),
    getDeliveries()
  ]);

  scheduleCache.trucks = driverUsers || [];
  scheduleCache.deliveries = dList || [];
  scheduleCache.isLoaded = true;

  notifyScheduleListeners();

  return {
    deliveries: scheduleCache.deliveries,
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

export async function getDriverUsers(userLocation = null, userAssignedLocations = []) {
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

    return drivers.map((u, idx) => ({
      id: u._id || `drv_${u.username}`,
      name: u.name || u.username,
      driver: u.name || u.username,
      color: TRUCK_COLORS[idx % TRUCK_COLORS.length],
      username: u.username,
      location: u.location || (u.assignedLocations?.[0] || '')
    }));
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

// ── GET DELIVERIES (100% MONGODB DATABASE) ──
export async function getDeliveries() {
  try {
    localStorage.removeItem('manifest_deliveries');
    localStorage.removeItem('manifest_trucks');
  } catch (e) {}

  try {
    const token = localStorage.getItem('token') || localStorage.getItem('adminToken');
    const res = await fetch(`${API_URL}/api/deliveries`, {
      credentials: 'include',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        scheduleCache.deliveries = data;
        return data;
      }
    } else {
      console.warn('[schedule] getDeliveries response not OK:', res.status);
    }
  } catch (err) {
    console.error('[schedule] getDeliveries API error:', err);
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
      const updatedList = await res.json();
      if (Array.isArray(updatedList)) {
        scheduleCache.deliveries = updatedList;
        notifyScheduleListeners();
        return updatedList;
      }
    } else {
      console.error('[schedule] saveDelivery API failed with status:', res.status);
    }
  } catch (err) {
    console.error('[schedule] saveDelivery API error:', err);
  }

  const fallbackList = await getDeliveries();
  scheduleCache.deliveries = fallbackList;
  notifyScheduleListeners();
  return fallbackList;
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
      const payload = await res.json();
      const list = payload.deliveries || payload;
      if (Array.isArray(list)) {
        scheduleCache.deliveries = list;
        notifyScheduleListeners();
        return list;
      }
    } else {
      console.error('[schedule] deleteDelivery API failed with status:', res.status);
    }
  } catch (err) {
    console.error('[schedule] deleteDelivery API error:', err);
  }

  const fallbackList = await getDeliveries();
  scheduleCache.deliveries = fallbackList;
  notifyScheduleListeners();
  return fallbackList;
}

// ── UPDATE DELIVERY STATUS (100% MONGODB DATABASE) ──
export async function updateDeliveryStatus(id, newStatus) {
  const currentList = scheduleCache.deliveries || await getDeliveries();
  const item = currentList.find(d => d.id === id);
  if (item) {
    const updatedItem = { ...item, status: newStatus };
    return await saveDelivery(updatedItem);
  }
  return currentList;
}

