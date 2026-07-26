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

export const INITIAL_SAMPLE_DELIVERIES = [
  {
    id: 'del_101',
    truckId: 'trk_1',
    date: getFormattedDayOffset(1), // Mon/Tue
    time: '08:30 AM',
    customerName: 'Apex Marble & Granite',
    address: '1420 E Trent Ave, Spokane, WA',
    salesRepName: 'Krish Manager',
    status: 'scheduled',
    notes: 'Forklift on site. Deliver 14 Calacatta slabs.',
    location: 'Spokane'
  },
  {
    id: 'del_102',
    truckId: 'trk_1',
    date: getFormattedDayOffset(1),
    time: '11:00 AM',
    customerName: 'Cascade Home Builders',
    address: '920 E Sprague Ave, Spokane, WA',
    salesRepName: 'Alex Rep',
    status: 'completed',
    notes: 'Call 30 mins before arrival.',
    location: 'Spokane'
  },
  {
    id: 'del_103',
    truckId: 'trk_2',
    date: getFormattedDayOffset(2),
    time: '09:15 AM',
    customerName: 'Five Star Granite, Inc.',
    address: '8810 8th Ave S, Seattle, WA',
    salesRepName: 'Sam Rep',
    status: 'delayed',
    notes: 'Running late due to I-5 traffic.',
    location: 'Seattle'
  },
  {
    id: 'del_104',
    truckId: 'trk_3',
    date: getFormattedDayOffset(3),
    time: '01:30 PM',
    customerName: 'Pacific Stone Works',
    address: '405 1st Ave S, Seattle, WA',
    salesRepName: 'Krish Manager',
    status: 'scheduled',
    notes: 'Deliver Taj Mahal Quartzite bundle.',
    location: 'Seattle'
  }
];

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
  // Local Storage check first for instant performance
  try {
    const saved = localStorage.getItem('manifest_deliveries');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}

  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/deliveries`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        localStorage.setItem('manifest_deliveries', JSON.stringify(data));
        return data;
      }
    }
  } catch (err) {}

  return INITIAL_SAMPLE_DELIVERIES;
}

// ── SAVE / UPDATE DELIVERY ──
export async function saveDelivery(delivery) {
  let list = await getDeliveries();
  const existingIdx = list.findIndex(d => d.id === delivery.id);
  if (existingIdx >= 0) {
    list[existingIdx] = delivery;
  } else {
    list = [delivery, ...list];
  }

  // Always persist to localStorage first
  try {
    localStorage.setItem('manifest_deliveries', JSON.stringify(list));
  } catch (e) {}

  // Background API sync
  try {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/api/deliveries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(delivery)
    });
  } catch (err) {}

  return list;
}

// ── DELETE DELIVERY ──
export async function deleteDelivery(id) {
  let list = await getDeliveries();
  list = list.filter(d => d.id !== id);

  try {
    localStorage.setItem('manifest_deliveries', JSON.stringify(list));
  } catch (e) {}

  try {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/api/deliveries/${id}`, {
      method: 'DELETE',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
  } catch (err) {}

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
