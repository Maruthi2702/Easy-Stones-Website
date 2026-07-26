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

// ── GET TRUCKS ──
export async function getTrucks() {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/trucks`, {
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
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/api/trucks`, {
      method: 'POST',
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
  // Clear any legacy client-side cached data permanently
  try {
    localStorage.removeItem('manifest_deliveries');
    localStorage.removeItem('manifest_trucks');
  } catch (e) {}

  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/deliveries`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
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
      if (Array.isArray(updatedList)) return updatedList;
    } else {
      console.error('[schedule] saveDelivery API failed with status:', res.status);
    }
  } catch (err) {
    console.error('[schedule] saveDelivery API error:', err);
  }

  // Fallback re-query MongoDB database
  return await getDeliveries();
}

// ── DELETE DELIVERY (100% MONGODB DATABASE) ──
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
      if (Array.isArray(list)) return list;
    } else {
      console.error('[schedule] deleteDelivery API failed with status:', res.status);
    }
  } catch (err) {
    console.error('[schedule] deleteDelivery API error:', err);
  }

  return await getDeliveries();
}

// ── UPDATE DELIVERY STATUS (100% MONGODB DATABASE) ──
export async function updateDeliveryStatus(id, newStatus) {
  let list = await getDeliveries();
  const item = list.find(d => d.id === id);
  if (item) {
    item.status = newStatus;
    return await saveDelivery(item);
  }
  return list;
}
