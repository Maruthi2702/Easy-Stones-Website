import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { getAuthToken } from '../../api/authToken';

/**
 * Calendar sync's calls (server.js: /api/auth/google/calendar/*,
 * /api/auth/icloud/*). Each returns the raw Response, as the screen read them
 * before the move, so every message and fallback stays the same.
 */

export type GoogleSyncStatus = { connected: boolean; email: string };
export type ICloudSyncStatus = { connected: boolean; email: string; calendarName: string };
export type ICloudCalendar = { url: string; name: string };

export const fetchGoogleStatus = () => authFetch(`${API_URL}/api/auth/google/calendar/status`);
export const fetchICloudStatus = () => authFetch(`${API_URL}/api/auth/icloud/status`);

/**
 * Starts Google's sign-in. The token still travels as a URL parameter (the
 * backend's OAuth `state` round-trip needs it — see server.js's
 * /api/auth/google/calendar), just no longer from a localStorage copy.
 */
export const googleLinkUrl = (): string =>
  `${API_URL || window.location.origin}/api/auth/google/calendar?token=${getAuthToken()}`;

// tz: the server builds each outbound event's UTC instant from it —
// schedule.startTime is a naive wall-clock string with no zone of its own, so
// without it the server would read "9:00" as 9:00 in ITS OWN zone (UTC)
// rather than the rep's, landing the event hours off on their phone.
export const syncGoogle = (tz: string) =>
  authFetch(`${API_URL}/api/auth/google/calendar/sync?tz=${encodeURIComponent(tz)}`, { method: 'POST' });

export const disconnectGoogle = () =>
  authFetch(`${API_URL}/api/auth/google/calendar/disconnect`, { method: 'POST' });

export const connectICloud = (body: {
  appleId: string;
  appSpecificPassword: string;
  calendarUrl?: string;
  calendarName?: string;
  tz?: string;
}) => authFetch(`${API_URL}/api/auth/icloud/connect`, { method: 'POST', body: JSON.stringify(body) });

export const syncICloud = (tz: string) =>
  authFetch(`${API_URL}/api/auth/icloud/sync?tz=${encodeURIComponent(tz)}`, { method: 'POST' });

export const disconnectICloud = () =>
  authFetch(`${API_URL}/api/auth/icloud/disconnect`, { method: 'POST' });

/** The JSON body, or `{ message }` from the text when the server didn't send JSON. */
export async function readBody(res: Response): Promise<{ message?: string; calendars?: ICloudCalendar[]; calendarName?: string }> {
  try {
    return await res.json();
  } catch {
    const txt = await res.text().catch(() => '');
    return { message: txt || `Server returned status ${res.status}` };
  }
}
