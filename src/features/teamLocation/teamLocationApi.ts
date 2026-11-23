import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import type { ErrorBody } from '../../types/api';
import type { AccessEntry, LocateRequest, TeamPerson, Trail } from './types';

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
export const loadAccessLog = (q: { subjectId?: string; viewerId?: string; limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (q.subjectId) params.set('subjectId', q.subjectId);
  if (q.viewerId) params.set('viewerId', q.viewerId);
  if (q.limit) params.set('limit', String(q.limit));
  const qs = params.toString();
  return call<{ entries: AccessEntry[] }>(`/access-log${qs ? `?${qs}` : ''}`);
};
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

/**
 * A short reminder to one person's iPhone through the Send Notification route (needs `send_notifications`; the server
 * drops anyone outside the sender's team). The message comes from `reminderFor` (src/utils/locationHealth.ts).
 */
export const sendReminder = async (userId: string, message: string) => {
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/push-send`, { method: 'POST', body: JSON.stringify({ userIds: [userId], message }) });
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection and try again.');
  }
  const data: ErrorBody & { line?: string; reached?: number } = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Something went wrong (${res.status}).`);
  return { line: data.line || 'Sent.', reached: data.reached ?? 0 };
};
