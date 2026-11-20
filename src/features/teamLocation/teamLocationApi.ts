import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import type { ErrorBody } from '../../types/api';
import type { LocateRequest, TeamPerson, Trail } from './types';

/** Team Location's calls to /api/location-tracking (src/routes/locationTracking.ts). Each resolves the body or throws an Error to show as is. */
async function call<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/location-tracking${path}`);
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection and try again.');
  }
  const data: ErrorBody = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Something went wrong (${res.status}).`);
  return data as T;
}

export const loadTeam = () => call<{ people: TeamPerson[] }>('/team');
export const loadTrail = (userId: string, day: string) =>
  call<Trail>(`/team/${encodeURIComponent(userId)}${day ? `?date=${encodeURIComponent(day)}` : ''}`);

async function send<T>(path: string, body: object): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/location-tracking${path}`, { method: 'POST', body: JSON.stringify(body) });
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection and try again.');
  }
  const data: ErrorBody = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Something went wrong (${res.status}).`);
  return data as T;
}

/** "Locate now": asks one person's phone for one position, with a reason. */
export const askLocate = (userId: string, reason: string) => send<{ request: LocateRequest; pushed: boolean }>('/locate', { userId, reason });
export const loadLocate = (id: string) => call<{ request: LocateRequest }>(`/locate/${encodeURIComponent(id)}`);
export const loadLocateLog = (userId: string) => call<{ requests: LocateRequest[] }>(`/locate?userId=${encodeURIComponent(userId)}`);
