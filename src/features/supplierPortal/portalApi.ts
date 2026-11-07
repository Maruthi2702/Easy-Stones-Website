import { API_URL } from '../../config/api';
import type { StringKey } from '../../utils/supplierI18n';
import type { PortalBlock, PortalMe, PortalPo } from './types';

/**
 * The supplier portal's calls to /api/supplier-portal (src/routes/supplierPortal.ts).
 * Its own cookie (scoped to that path), never the staff session: plain fetch,
 * not authFetch, so a supplier's 401 never trips the staff "session expired"
 * handling. Errors carry `code` — a key of the portal's words (supplierI18n)
 * — so the screen says it in the supplier's language.
 */
export type PortalError = Error & { status: number; code: StringKey | 'signin'; problems?: unknown };

async function call<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/supplier-portal${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      ...(body !== undefined && { body: JSON.stringify(body) })
    });
  } catch {
    throw Object.assign(new Error('offline'), { status: 0, code: 'offline' }) as PortalError;
  }
  const data = await res.json().catch(() => ({})) as { message?: string; code?: string; problems?: unknown };
  if (!res.ok) {
    const code = (data.code || (res.status === 401 ? 'signin' : 'serverError')) as PortalError['code'];
    throw Object.assign(new Error(data.message || `Error ${res.status}`), { status: res.status, code, problems: data.problems }) as PortalError;
  }
  return data as T;
}

export const getMe = () => call<{ me: PortalMe }>('/me');
export const setLanguage = (language: string) => call<{ me: PortalMe }>('/me', { method: 'PATCH', body: { language } });
export const signIn = (email: string, password: string) => call<{ me: PortalMe }>('/sign-in', { method: 'POST', body: { email, password } });
export const signOut = () => call<{ ok: boolean }>('/sign-out', { method: 'POST', body: {} });
export const checkLink = (token: string) => call<{ name: string; email: string; language: string; reset: boolean }>(`/link/${encodeURIComponent(token)}`);
export const acceptLink = (token: string, password: string) => call<{ me: PortalMe }>('/link', { method: 'POST', body: { token, password } });
export const forgot = (email: string) => call<{ ok: boolean }>('/forgot', { method: 'POST', body: { email } });

export const listPos = () => call<{ pos: PortalPo[] }>('/pos');
export const getPo = (id: string) => call<{ po: PortalPo }>(`/pos/${id}`);
export const startBlock = (poId: string, id: string, lineId: string) => call<{ block: PortalBlock }>(`/pos/${poId}/blocks`, { method: 'POST', body: { id, lineId } });
export const getBlock = (id: string) => call<{ block: PortalBlock }>(`/blocks/${id}`);
export const editBlock = (id: string, body: { blockNumber?: string; length?: string; height?: string; unit?: string; note?: string }) =>
  call<{ block: PortalBlock }>(`/blocks/${id}`, { method: 'PUT', body });
export const addBundle = (id: string, bundleId: string) => call<{ block: PortalBlock }>(`/blocks/${id}/bundles`, { method: 'POST', body: { id: bundleId } });
export const setSlabs = (id: string, bundleId: string, slabs: number | null) => call<{ block: PortalBlock }>(`/blocks/${id}/bundles/${bundleId}`, { method: 'PUT', body: { slabs } });
export const removeBundle = (id: string, bundleId: string) => call<{ block: PortalBlock }>(`/blocks/${id}/bundles/${bundleId}`, { method: 'DELETE' });
export const uploadPhoto = (id: string, bundleId: string, data: string) => call<{ block: PortalBlock }>(`/blocks/${id}/bundles/${bundleId}/photo`, { method: 'POST', body: { data } });
export const sendBlock = (id: string) => call<{ block: PortalBlock }>(`/blocks/${id}/send`, { method: 'POST', body: {} });
export const deleteBlock = (id: string) => call<{ deleted: boolean }>(`/blocks/${id}`, { method: 'DELETE' });
