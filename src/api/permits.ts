import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import { queryEntries, type ErrorBody, type Query } from '../types/api';

/**
 * Calls to the Permits API (src/permits/router.ts). Each resolves the JSON
 * body or throws an Error whose message can be shown as is.
 */
async function call<T = unknown>(path: string, { method = 'GET', query }: { method?: string; query?: Query } = {}): Promise<T> {
  const qs = query ? `?${new URLSearchParams(queryEntries(query))}` : '';
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/permits${path}${qs}`, { method });
  } catch {
    throw Object.assign(new Error('Couldn’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data: ErrorBody = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || `Something went wrong (${res.status}).`), { status: res.status });
  return data as T;
}

export const permitsMeta = () => call('/meta');
export const listPermits = (query: Query) => call('', { query });
export const exportPermits = (query: Query) => call('/export', { query });
export const refreshPermits = () => call('/refresh', { method: 'POST' });
export const permitContractor = (license: string) => call(`/contractor/${encodeURIComponent(license)}`);
