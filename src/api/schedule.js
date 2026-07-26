import { API_URL } from '../config/api';

export const MAX_TRUCK_CAPACITY = 8;

export const DEFAULT_TRUCKS = [
  { id: 'trk_1', name: 'Titan Alpha', driver: 'Dave Miller', color: '#D4AF37' },
  { id: 'trk_2', name: 'Glacier Express', driver: 'Mark Stevens', color: '#2F8F73' },
  { id: 'trk_3', name: 'Granite Hauler', driver: 'Alex Rivera', color: '#E1602A' },
  { id: 'trk_4', name: 'Cascade Transport', driver: 'John Carter', color: '#3B82F6' },
  { id: 'trk_5', name: 'Moda Dispatch', driver: 'Sam Taylor', color: '#8B5CF6' },
  { id: 'trk_6', name: 'Olympic Cargo', driver: 'Chris Evans', color: '#64748B' }
];

export const INITIAL_SAMPLE_DELIVERIES = [];

function getFormattedDayOffset(offset = 0) {
  const d = new Date();
  const currentDay = d.getDay();
  const distance = offset - currentDay;
  const target = new Date(d);
  target.setDate(d.getDate() + distance);
  return target.toISOString().split('T')[0];
}

// ── GET TRUCKS ──
export async function getTrucks() {
  try {
    const res = await fetch(`${API_URL}/api/trucks`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (err) {}

  // Local Storage fallback
  try {
    const saved = localStorage.getItem('manifest_trucks');
    if (saved) return JSON.parse(saved);
  } catch (e) {}

  return DEFAULT_TRUCKS;
}

// ── GET DRIVERS FROM USERS TAB (filtered by location) ──
// Fetches all users from /api/salesreps, filters to role='driver' or 'logistics'
// and intersects with the given location. Returns them as truck-shaped objects.
const TRUCK_COLORS = ['#D4AF37', '#2F8F73', '#E1602A', '#3B82F6', '#8B5CF6', '#64748B', '#10B981', '#F59E0B'];

export async function getDriverUsers(userLocation = null, userAssignedLocations = []) {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/salesreps`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error('Failed to fetch users');
    const payload = await res.json();
    const allUsers = payload.data || payload || [];

    // Filter to driver/logistics role users only
    let drivers = allUsers.filter(u =>
      u.role === 'driver' || u.role === 'logistics'
    );

    // Filter to users assigned to the current user's location (if a location filter is given)
    if (userLocation || userAssignedLocations.length > 0) {
      const filterLocs = userAssignedLocations.length > 0
        ? userAssignedLocations
        : [userLocation];

      // Wildcard '*' means all locations — don't filter
      if (!filterLocs.includes('*')) {
        drivers = drivers.filter(u => {
          const driverLocs = u.assignedLocations || (u.location ? [u.location] : []);
          // Driver assigned '*' means all locations
          if (driverLocs.includes('*')) return true;
          return driverLocs.some(loc => filterLocs.includes(loc));
        });
      }
    }

    if (drivers.length === 0) return null; // Signal caller to fall back to truck data

    // Convert driver user records → truck-shaped objects for BoardGrid / DriverView
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
  // Always update localStorage immediately
  try {
    localStorage.setItem('manifest_trucks', JSON.stringify(trucks));
  } catch (e) {}

  // Sync to API in background if available
  try {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/api/trucks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ trucks })
    });
  } catch (err) {}

  return trucks;
}

// ── GET DELIVERIES ──
export async function getDeliveries() {
  // Always query database API first for sync across all users/drivers/incognito sessions
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/deliveries`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        try {
          localStorage.setItem('manifest_deliveries', JSON.stringify(data));
        } catch (e) {}
        return data;
      }
    }
  } catch (err) {
    console.warn('[schedule] getDeliveries API error:', err);
  }

  // Local Storage fallback when offline
  try {
    const saved = localStorage.getItem('manifest_deliveries');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}

  return INITIAL_SAMPLE_DELIVERIES;
}

// ── SAVE / UPDATE DELIVERY ──
export async function saveDelivery(delivery) {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/deliveries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(delivery)
    });
    if (res.ok) {
      const updatedList = await res.json();
      if (Array.isArray(updatedList) && updatedList.length > 0) {
        try {
          localStorage.setItem('manifest_deliveries', JSON.stringify(updatedList));
        } catch (e) {}
        return updatedList;
      }
    }
  } catch (err) {
    console.warn('[schedule] saveDelivery API error:', err);
  }

  // Fallback to local mutation if offline
  let list = await getDeliveries();
  const existingIdx = list.findIndex(d => d.id === delivery.id);
  if (existingIdx >= 0) {
    list[existingIdx] = delivery;
  } else {
    list = [delivery, ...list];
  }
  try {
    localStorage.setItem('manifest_deliveries', JSON.stringify(list));
  } catch (e) {}
  return list;
}

// ── DELETE DELIVERY ──
export async function deleteDelivery(id) {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/deliveries/${id}`, {
      method: 'DELETE',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (res.ok) {
      const payload = await res.json();
      const list = payload.deliveries || payload;
      if (Array.isArray(list)) {
        try {
          localStorage.setItem('manifest_deliveries', JSON.stringify(list));
        } catch (e) {}
        return list;
      }
    }
  } catch (err) {
    console.warn('[schedule] deleteDelivery API error:', err);
  }

  let list = await getDeliveries();
  list = list.filter(d => d.id !== id);
  try {
    localStorage.setItem('manifest_deliveries', JSON.stringify(list));
  } catch (e) {}
  return list;
}

// ── UPDATE DELIVERY STATUS ──
export async function updateDeliveryStatus(id, newStatus) {
  let list = await getDeliveries();
  const item = list.find(d => d.id === id);
  if (item) {
    item.status = newStatus;
    return await saveDelivery(item);
  }
  return list;
}
