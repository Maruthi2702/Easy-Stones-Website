import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { queryEntries, type ErrorBody, type Query } from '../../types/api';
import type { Payment, PaymentDay, PaymentSummary } from './types';

/**
 * The Payments page's calls to /api/payments-received
 * (src/routes/paymentsReceived.ts). Each resolves the JSON body or throws an
 * Error whose message can be shown as is; `status` and `problems` (field →
 * message) ride along on it.
 */
async function call<T>(path: string, { method = 'GET', body, query }: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const qs = query ? `?${new URLSearchParams(queryEntries(query))}` : '';
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/payments-received${path}${qs}`, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) })
    });
  } catch {
    throw Object.assign(new Error('Couldn’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data: ErrorBody & { problems?: unknown } = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.message || data.error || `Something went wrong (${res.status}).`), {
      status: res.status, problems: data.problems || {}
    });
  }
  return data as T;
}

export type PaymentBody = {
  date: string; customerId: string; customerName: string; method: string; amount: string;
  invoice: string; reference: string; note: string;
};

export const paymentLocations = () => call<{ locations: string[] }>('/locations');
export const listPayments = (location: string, date: string) =>
  call<{ payments: Payment[]; day: PaymentDay; today: string }>('', { query: { location: location || '*', date } });
export const paymentSummary = (location: string, date: string) => call<PaymentSummary>('/summary', { query: { location, date } });
export const addPayment = (id: string, location: string, body: PaymentBody) =>
  call<{ payment: Payment; alreadySaved?: boolean }>('', { method: 'POST', body: { id, location, ...body } });
export const editPayment = (id: string, body: PaymentBody) => call<{ payment: Payment }>(`/${id}`, { method: 'PUT', body });
export const voidPayment = (id: string, reason: string) => call<{ payment: Payment }>(`/${id}/void`, { method: 'POST', body: { reason } });
