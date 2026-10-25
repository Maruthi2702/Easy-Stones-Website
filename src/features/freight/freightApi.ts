import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { queryEntries, type ErrorBody, type Id, type Query } from '../../types/api';
import type { Loose } from '../../types/records';

/**
 * The 3rd-Party Freight screen's calls to /api/accounting (src/accounting/
 * router.js). Each resolves the JSON body or throws an Error whose message
 * can be shown as is; `status` and `problems` ride along on it. The bodies
 * are records not typed yet (Loose).
 */
async function call<T = Loose>(path: string, { method = 'GET', body, query }: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const qs = query ? `?${new URLSearchParams(queryEntries(query))}` : '';
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/accounting${path}${qs}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) })
    });
  } catch {
    throw Object.assign(new Error('Couldn’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data: ErrorBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || data.message || `Something went wrong (${res.status}).`), {
      status: res.status, problems: data.problems || []
    });
  }
  return data as T;
}

/** A charge, carrier or invoice as the screen holds it: `_id` and `version` (the optimistic lock) are what a write sends. */
type Versioned = Loose;

const item = (c: Versioned) => ({ id: String(c._id), version: c.version ?? c.__v });

export const listCharges = (query: Query) => call('/freight-charges', { query });
export const exportCharges = (query: Query) => call('/freight-charges/export', { query });
export const getCharge = (id: Id) => call(`/freight-charges/${id}`);
export const addCharge = (body: object) => call('/freight-charges', { method: 'POST', body });
export const editCharge = (charge: Versioned, changes: object) => call(`/freight-charges/${charge._id}`, { method: 'PATCH', body: { version: charge.version, ...changes } });
export const approveCharges = (charges: Versioned[]) => call('/freight-charges/approve', { method: 'POST', body: { items: charges.map(item) } });
export const sendBackCharges = (charges: Versioned[]) => call('/freight-charges/unapprove', { method: 'POST', body: { items: charges.map(item) } });
export const payCharges = (charges: Versioned[], payment: object) => call('/freight-charges/pay', { method: 'POST', body: { items: charges.map(item), ...payment } });
export const voidCharge = (charge: Versioned, reason: string) => call(`/freight-charges/${charge._id}/void`, { method: 'POST', body: { version: charge.version, reason } });
export const markReviewed = (charge: Versioned) => call(`/freight-charges/${charge._id}/resolve-flags`, { method: 'POST', body: { version: charge.version } });

export const getPayment = (paymentId: string) => call(`/payments/${encodeURIComponent(paymentId)}`);

export const listCarriers = () => call<Loose[]>('/carriers');
export const addCarrier = (body: object) => call('/carriers', { method: 'POST', body });
export const editCarrier = (carrier: Versioned, changes: object) => call(`/carriers/${carrier._id}`, { method: 'PATCH', body: { version: carrier.version, ...changes } });
export const setCarrierActive = (carrier: Versioned, active: boolean) => call(`/carriers/${carrier._id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST', body: { version: carrier.version } });

export const getInvoice = (id: Id) => call(`/carrier-invoices/${id}`);
export const addInvoice = (body: object) => call('/carrier-invoices', { method: 'POST', body });
export const editInvoice = (invoice: Versioned, changes: object) => call(`/carrier-invoices/${invoice._id}`, { method: 'PATCH', body: { version: invoice.version, ...changes } });
export const invoiceStep = (invoice: Versioned, step: string, extra: object = {}) => call(`/carrier-invoices/${invoice._id}/${step}`, { method: 'POST', body: { version: invoice.version, ...extra } });
