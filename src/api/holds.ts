import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import { queryEntries, type ErrorBody, type Id, type Query, type Versioned } from '../types/api';
import { hideParam } from '../holds/holdLetter';

/**
 * Calls to the Cart & Holds API (src/holds/router.js). Each resolves the JSON
 * body or throws an Error whose message can be shown as is; `status` rides
 * along on it.
 */
async function call<T = unknown>(path: string, { method = 'GET', body, query }: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const qs = query ? `?${new URLSearchParams(queryEntries(query))}` : '';
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/holds${path}${qs}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) })
    });
  } catch {
    throw Object.assign(new Error('Couldn’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data: ErrorBody = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || `Something went wrong (${res.status}).`), { status: res.status });
  return data as T;
}

const enc = encodeURIComponent;

// Cart
export const getCart = () => call('/cart');
export const addToCart = (slabKeys: string[]) => call('/cart/slabs', { method: 'POST', body: { slabKeys } });
export const scanIntoCart = (code: string) => call('/cart/scan', { method: 'POST', body: { code } });
export const setCartCustomer = (customerId: Id | null) => call('/cart/customer', { method: 'PATCH', body: { customerId } });
export const setCartNote = (slabKey: string, note: string) => call(`/cart/slabs/${enc(slabKey)}`, { method: 'PATCH', body: { note } });
export const removeManyFromCart = (slabKeys: string[]) => call('/cart/slabs/remove', { method: 'POST', body: { slabKeys } });
export const removeFromCart = (slabKey: string) => call(`/cart/slabs/${enc(slabKey)}`, { method: 'DELETE' });
export const clearCart = () => call('/cart', { method: 'DELETE' });
export const slabStatuses = (slabKeys: string[]) => call('/slabs/status', { method: 'POST', body: { slabKeys } });

// Holds
export const holdsMeta = () => call('/meta');
export const listHolds = (query: Query) => call('', { query });
export const getHold = (id: Id) => call(`/${id}`);
export const createHold = (body: object) => call('', { method: 'POST', body });
export const editHoldDetails = (hold: Versioned, changes: object) => call(`/${hold._id}/details`, { method: 'PATCH', body: { version: hold.version, ...changes } });
export const changeHoldSlabs = (hold: Versioned, { add = [], remove = [] }: { add?: { slabKey: string; price: string | null; note: string }[]; remove?: string[] }) => call(`/${hold._id}/slabs`, { method: 'POST', body: { version: hold.version, add, remove } });
export const swapHoldSlab = (hold: Versioned, from: string, to: string) => call(`/${hold._id}/swap`, { method: 'POST', body: { version: hold.version, from, to } });
export const setHoldPrices = (hold: Versioned, lines: object[]) => call(`/${hold._id}/prices`, { method: 'PATCH', body: { version: hold.version, lines } });
export const extendHold = (hold: Versioned, expiresOn: string) => call(`/${hold._id}/extend`, { method: 'POST', body: { version: hold.version, expiresOn } });
export const releaseHold = (hold: Versioned, reason: string) => call(`/${hold._id}/release`, { method: 'POST', body: { version: hold.version, reason } });
/** `hide`: the print preview's boxes ({ unitPrice: true, … }, see src/holds/holdLetter.js). */
export const holdPdfUrl = (hold: Versioned, { hide = {} }: { hide?: Record<string, boolean> } = {}): string => {
  const h = hideParam(hide);
  return `${API_URL}/api/holds/${hold._id}/pdf${h ? `?hide=${enc(h)}` : ''}`;
};

/** The hold's PDF as a Blob. The route needs the sign-in token, so a plain link can't open it. */
export async function fetchHoldPdf(hold: Versioned, { hide = {} }: { hide?: Record<string, boolean> } = {}): Promise<Blob> {
  let res: Response;
  try {
    res = await authFetch(holdPdfUrl(hold, { hide }));
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    const data: ErrorBody = await res.json().catch(() => ({}));
    throw new Error(data.error || `Couldn’t make the PDF (${res.status}).`);
  }
  return new Blob([await res.blob()], { type: 'application/pdf' });
}
