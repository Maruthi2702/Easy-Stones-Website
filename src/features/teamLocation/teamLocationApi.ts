import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import type { ErrorBody } from '../../types/api';
import type { TeamPerson, Trail } from './types';

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
