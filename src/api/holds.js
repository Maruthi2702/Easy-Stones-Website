import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import { hideParam } from '../holds/holdLetter';

/**
 * Calls to the Cart & Holds API (src/holds/router.js). Each resolves the JSON
 * body or throws an Error whose message can be shown as is; `status` rides
 * along on it.
 */
async function call(path, { method = 'GET', body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''))}` : '';
  let res;
  try {
    res = await authFetch(`${API_URL}/api/holds${path}${qs}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) })
    });
  } catch {
    throw Object.assign(new Error('Couldn’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || `Something went wrong (${res.status}).`), { status: res.status });
  return data;
}

const enc = encodeURIComponent;

// Cart
export const getCart = () => call('/cart');
export const addToCart = (slabKeys) => call('/cart/slabs', { method: 'POST', body: { slabKeys } });
export const scanIntoCart = (code) => call('/cart/scan', { method: 'POST', body: { code } });
export const setCartCustomer = (customerId) => call('/cart/customer', { method: 'PATCH', body: { customerId } });
export const setCartNote = (slabKey, note) => call(`/cart/slabs/${enc(slabKey)}`, { method: 'PATCH', body: { note } });
export const removeFromCart = (slabKey) => call(`/cart/slabs/${enc(slabKey)}`, { method: 'DELETE' });
export const clearCart = () => call('/cart', { method: 'DELETE' });
export const slabStatuses = (slabKeys) => call('/slabs/status', { method: 'POST', body: { slabKeys } });

// Holds
export const holdsMeta = () => call('/meta');
export const listHolds = (query) => call('', { query });
export const getHold = (id) => call(`/${id}`);
export const createHold = (body) => call('', { method: 'POST', body });
export const editHoldDetails = (hold, changes) => call(`/${hold._id}/details`, { method: 'PATCH', body: { version: hold.version, ...changes } });
export const changeHoldSlabs = (hold, { add = [], remove = [] }) => call(`/${hold._id}/slabs`, { method: 'POST', body: { version: hold.version, add, remove } });
export const swapHoldSlab = (hold, from, to) => call(`/${hold._id}/swap`, { method: 'POST', body: { version: hold.version, from, to } });
export const setHoldPrices = (hold, lines) => call(`/${hold._id}/prices`, { method: 'PATCH', body: { version: hold.version, lines } });
export const extendHold = (hold, expiresOn) => call(`/${hold._id}/extend`, { method: 'POST', body: { version: hold.version, expiresOn } });
export const releaseHold = (hold, reason) => call(`/${hold._id}/release`, { method: 'POST', body: { version: hold.version, reason } });
/** `hide`: the print preview's boxes ({ unitPrice: true, … }, see src/holds/holdLetter.js). */
export const holdPdfUrl = (hold, { hide = {} } = {}) => {
  const h = hideParam(hide);
  return `${API_URL}/api/holds/${hold._id}/pdf${h ? `?hide=${enc(h)}` : ''}`;
};

/** The hold's PDF as a Blob. The route needs the sign-in token, so a plain link can't open it. */
export async function fetchHoldPdf(hold, { hide = {} } = {}) {
  let res;
  try {
    res = await authFetch(holdPdfUrl(hold, { hide }));
  } catch {
    throw new Error('Couldn’t reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Couldn’t make the PDF (${res.status}).`);
  }
  return new Blob([await res.blob()], { type: 'application/pdf' });
}
