import { API_URL } from '../config/api';
import { authFetch } from './authFetch';

/**
 * Calls to the Permits API (src/permits/router.js). Each resolves the JSON
 * body or throws an Error whose message can be shown as is.
 */
async function call(path, { method = 'GET', query } = {}) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''))}` : '';
  let res;
  try {
    res = await authFetch(`${API_URL}/api/permits${path}${qs}`, { method });
  } catch {
    throw Object.assign(new Error('Couldn’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || `Something went wrong (${res.status}).`), { status: res.status });
  return data;
}

export const permitsMeta = () => call('/meta');
export const listPermits = (query) => call('', { query });
export const exportPermits = (query) => call('/export', { query });
export const refreshPermits = () => call('/refresh', { method: 'POST' });
export const permitContractor = (license) => call(`/contractor/${encodeURIComponent(license)}`);
