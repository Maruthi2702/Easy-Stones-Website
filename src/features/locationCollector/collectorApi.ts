import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import type { RawPoint } from '../../utils/locationTracking';
import { CONSENT_VERSION, type TrackingStatus } from './collectorRules';

/** The phone's calls to /api/location-tracking (src/routes/locationTracking.ts). */
export async function loadStatus(): Promise<TrackingStatus> {
  const res = await authFetch(`${API_URL}/api/location-tracking/status`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

/** 'sent' · 'consent' (no agreement on the server yet: keep the points) · 'off' (this role isn't tracked: stop) · 'retry' (no signal or a server error: keep them). */
export async function sendPoints(points: RawPoint[]): Promise<'sent' | 'consent' | 'off' | 'retry'> {
  try {
    const res = await authFetch(`${API_URL}/api/location-tracking/points`, { method: 'POST', body: JSON.stringify({ points }) });
    if (res.ok) return 'sent';
    if (res.status === 403) return (await res.json().catch(() => ({}))).code === 'consent' ? 'consent' : 'off';
    return 'retry';
  } catch { return 'retry'; }
}

/** Saves the person's agreement to the current wording on the server; throws a message to show if it can't. */
export async function recordConsent(): Promise<void> {
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/location-tracking/consent`, { method: 'POST', body: JSON.stringify({ version: CONSENT_VERSION }) });
  } catch { throw new Error('Couldn’t reach the server. Check your connection and try again.'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `Something went wrong (${res.status}).`);
}
