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

/** "Locate now" asks still open for me (who asked and when — never why). */
export async function loadOpenRequests(): Promise<{ id: string; requestedByName: string }[]> {
  const res = await authFetch(`${API_URL}/api/location-tracking/locate/pending`);
  if (!res.ok) return [];
  return ((await res.json()).requests ?? []) as { id: string; requestedByName: string }[];
}

/** Sends the one position an ask wants; true when the server took it. */
export async function sendRequestAnswer(id: string, at: { lat: number; lng: number; accuracy?: number | null }): Promise<boolean> {
  const res = await authFetch(`${API_URL}/api/location-tracking/locate/${encodeURIComponent(id)}/answer`, {
    method: 'POST', body: JSON.stringify({ lat: at.lat, lng: at.lng, accuracy: at.accuracy ?? undefined })
  });
  return res.ok;
}
