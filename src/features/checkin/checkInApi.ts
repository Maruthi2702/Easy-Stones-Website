import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';

/** The Check-In Log tab's calls (src/routes/checkIn.ts). Raw Responses, read by the hook as before. */

export type CheckInFilters = {
  page: number;
  limit: number;
  search: string;
  month: number | string | null;
  year: number | string | null;
  location: string | null;
};

export const fetchCheckInStatsFor = (location: string | null) => {
  const params = new URLSearchParams({ ...(location && { location }) });
  return authFetch(`${API_URL}/api/checkin/stats?${params}`);
};

export const fetchCheckInPage = (f: CheckInFilters) => {
  const params = new URLSearchParams({
    page: String(f.page),
    limit: String(f.limit),
    ...(f.search && { search: f.search }),
    ...(f.month && { month: String(f.month) }),
    ...(f.year && { year: String(f.year) }),
    ...(f.location && { location: f.location }),
  });
  return authFetch(`${API_URL}/api/checkin?${params}`);
};

export const deleteCheckIn = (id: string) => authFetch(`${API_URL}/api/checkin/${id}`, { method: 'DELETE' });

export const saveCheckInDetails = (id: string, form: object) =>
  authFetch(`${API_URL}/api/checkin/${id}`, { method: 'PUT', body: JSON.stringify(form) });
