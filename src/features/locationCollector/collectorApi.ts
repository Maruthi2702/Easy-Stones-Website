import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import type { RawPoint } from '../../utils/locationTracking';
import type { TrackingStatus } from './collectorRules';

/** The phone's calls to /api/location-tracking (src/routes/locationTracking.ts). */
export async function loadStatus(): Promise<TrackingStatus> {
  const res = await authFetch(`${API_URL}/api/location-tracking/status`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

/** 'sent' · 'off' (the server says this role isn't tracked: stop) · 'retry' (no signal or a server error: keep the points). */
export async function sendPoints(points: RawPoint[]): Promise<'sent' | 'off' | 'retry'> {
  try {
    const res = await authFetch(`${API_URL}/api/location-tracking/points`, { method: 'POST', body: JSON.stringify({ points }) });
    if (res.ok) return 'sent';
    return res.status === 403 ? 'off' : 'retry';
  } catch { return 'retry'; }
}
