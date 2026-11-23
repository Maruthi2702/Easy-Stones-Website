import { SERVER_URL } from '../config';
import type { RawPoint } from '../../../src/utils/locationTracking';
import type { TrackingStatus } from '../../../src/features/locationCollector/collectorRules';
import type { SendResult, StatusAnswer } from './core';

/**
 * The phone's calls to /api/location-tracking (the same ones as src/features/locationCollector/collectorApi.ts). They carry the shared
 * session cookies, so they work with the website closed. A 401 means the session is gone.
 */
const call = (path: string, init: RequestInit = {}) => fetch(`${SERVER_URL}${path}`, {
  ...init, credentials: 'include', headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) }
});

/** Is a staff member signed in (the cookies still work)? Gives their id, or null. */
export async function whoAmI(): Promise<string | null> {
  try {
    const res = await call('/api/user/me');
    if (res.status !== 200) return null;
    const body = (await res.json()) as { id?: string; _id?: string };
    return String(body.id || body._id || '') || null;
  } catch { return null; }
}

export async function loadStatus(): Promise<StatusAnswer> {
  const res = await call('/api/location-tracking/status');
  if (res.status === 401) return { kind: 'signed-out' };
  if (!res.ok) throw new Error(`status ${res.status}`);
  return { kind: 'status', status: (await res.json()) as TrackingStatus };
}

export async function sendPoints(points: RawPoint[]): Promise<SendResult> {
  try {
    const res = await call('/api/location-tracking/points', { method: 'POST', body: JSON.stringify({ points }) });
    if (res.ok) return 'sent';
    if (res.status === 403) return ((await res.json().catch(() => ({}))) as { code?: string }).code === 'consent' ? 'consent' : 'off';
    return 'retry';
  } catch { return 'retry'; }
}

export async function sendHeartbeat(body: object): Promise<boolean> {
  try { return (await call('/api/location-tracking/heartbeat', { method: 'POST', body: JSON.stringify(body) })).ok; } catch { return false; }
}
