import { API_URL } from '../config/api';
import { authFetch } from './authFetch';

/**
 * The 3rd-Party Freight screen's calls to /api/accounting (src/accounting/
 * router.js). Each resolves the JSON body or throws an Error whose message
 * can be shown as is; `status` and `problems` ride along on it.
 */
async function call(path, { method = 'GET', body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''))}` : '';
  let res;
  try {
    res = await authFetch(`${API_URL}/api/accounting${path}${qs}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) })
    });
  } catch {
    throw Object.assign(new Error('Couldn’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || data.message || `Something went wrong (${res.status}).`), {
      status: res.status, problems: data.problems || []
    });
  }
  return data;
}

const item = (c) => ({ id: String(c._id), version: c.version ?? c.__v });

export const listCharges = (query) => call('/freight-charges', { query });
export const exportCharges = (query) => call('/freight-charges/export', { query });
export const getCharge = (id) => call(`/freight-charges/${id}`);
export const addCharge = (body) => call('/freight-charges', { method: 'POST', body });
export const editCharge = (charge, changes) => call(`/freight-charges/${charge._id}`, { method: 'PATCH', body: { version: charge.version, ...changes } });
export const approveCharges = (charges) => call('/freight-charges/approve', { method: 'POST', body: { items: charges.map(item) } });
export const sendBackCharges = (charges) => call('/freight-charges/unapprove', { method: 'POST', body: { items: charges.map(item) } });
export const payCharges = (charges, payment) => call('/freight-charges/pay', { method: 'POST', body: { items: charges.map(item), ...payment } });
export const voidCharge = (charge, reason) => call(`/freight-charges/${charge._id}/void`, { method: 'POST', body: { version: charge.version, reason } });
export const markReviewed = (charge) => call(`/freight-charges/${charge._id}/resolve-flags`, { method: 'POST', body: { version: charge.version } });

export const getPayment = (paymentId) => call(`/payments/${encodeURIComponent(paymentId)}`);

export const listCarriers = () => call('/carriers');
export const addCarrier = (body) => call('/carriers', { method: 'POST', body });
export const editCarrier = (carrier, changes) => call(`/carriers/${carrier._id}`, { method: 'PATCH', body: { version: carrier.version, ...changes } });
export const setCarrierActive = (carrier, active) => call(`/carriers/${carrier._id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST', body: { version: carrier.version } });

export const getInvoice = (id) => call(`/carrier-invoices/${id}`);
export const addInvoice = (body) => call('/carrier-invoices', { method: 'POST', body });
export const editInvoice = (invoice, changes) => call(`/carrier-invoices/${invoice._id}`, { method: 'PATCH', body: { version: invoice.version, ...changes } });
export const invoiceStep = (invoice, step, extra = {}) => call(`/carrier-invoices/${invoice._id}/${step}`, { method: 'POST', body: { version: invoice.version, ...extra } });
