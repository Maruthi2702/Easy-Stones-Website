import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { queryEntries, type ErrorBody, type Query } from '../../types/api';
import type { DecisionInput, Step } from '../../utils/supplierBlocks';
import type { Block, IncomingItem, Meta, Po, SpsLookup, SupplierLoginInfo, SupplierRow } from './types';

/**
 * Supplier POs' calls to /api/suppliers (src/routes/suppliers.ts). Each
 * resolves the JSON body or throws an Error whose message can be shown as is;
 * `status`, `problems` (field → message) and `existingId` ride along on it.
 */
async function call<T>(path: string, { method = 'GET', body, query }: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const qs = query ? `?${new URLSearchParams(queryEntries(query))}` : '';
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/suppliers${path}${qs}`, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
  } catch {
    throw Object.assign(new Error('Couldn’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data: ErrorBody & { problems?: unknown; existingId?: string } = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.message || data.error || `Something went wrong (${res.status}).`), {
      status: res.status, problems: data.problems || {}, existingId: data.existingId || ''
    });
  }
  return data as T;
}

export type PoBody = {
  poNumber: string; supplierId: string; shipTo: string; readyBy: string; buyerId: string;
  lines: { id?: string; material: string; thickness: string; finish: string; slabs: string | number }[]; note: string;
  source?: 'typed' | 'sps'; notify?: boolean;
};
export type SupplierBody = Omit<SupplierRow, 'id' | 'logins' | 'openPos' | 'score'>;
export type Notified = { emailed: number; logins: number } | null;

export const loadMeta = () => call<Meta>('/meta');
export const listPos = (status: string) => call<{ pos: Po[] }>('/pos', { query: { status } });
export const getPo = (id: string) => call<{ po: Po }>(`/pos/${id}`);
export const addPo = (id: string, body: PoBody) => call<{ po: Po; notified: Notified; alreadySaved?: boolean }>('/pos', { method: 'POST', body: { id, ...body } });
export const editPo = (id: string, body: PoBody) => call<{ po: Po; notified: Notified }>(`/pos/${id}`, { method: 'PUT', body });
export const setPoStatus = (id: string, status: Po['status'], reason: string) => call<{ po: Po }>(`/pos/${id}/status`, { method: 'POST', body: { status, reason } });
export const notifyPo = (id: string) => call<{ notified: NonNullable<Notified> }>(`/pos/${id}/notify`, { method: 'POST', body: {} });
export const spsLookup = (po: string) => call<SpsLookup>('/sps-lookup', { query: { po } });

export const listBlocks = (queue: 'review' | 'final') => call<{ blocks: Block[] }>('/blocks', { query: { queue } });
export const getBlock = (id: string) => call<{ block: Block }>(`/blocks/${id}`);
export const decide = (id: string, step: Step, decisions: DecisionInput[], note: string) =>
  call<{ block: Block; emailed: number }>(`/blocks/${id}/decide`, { method: 'POST', body: { step, decisions, note } });
export type EntryBody = {
  blockNumber: string; length: string; height: string; unit: 'in' | 'cm';
  bundles: { id: string; slabs: number | null; photoUrl?: string }[];
};
/** Purchasing entering a block for its supplier (photos they emailed / sent on WhatsApp). */
export const uploadBlockPhoto = (data: string) => call<{ url: string }>('/block-photos', { method: 'POST', body: { data } });
export const enterBlock = (poId: string, id: string, body: EntryBody & { lineId: string; note: string }) =>
  call<{ block: Block; alreadySaved?: boolean }>(`/pos/${poId}/blocks`, { method: 'POST', body: { id, ...body } });
export const enterChanges = (blockId: string, expectedUpdatedAt: string | null, body: EntryBody) =>
  call<{ block: Block }>(`/blocks/${blockId}/entry`, { method: 'PUT', body: { expectedUpdatedAt, ...body } });
export const unlock = (id: string, bundleIds: string[], reason: string) => call<{ block: Block }>(`/blocks/${id}/unlock`, { method: 'POST', body: { bundleIds, reason } });

export const listSuppliers = () => call<{ suppliers: SupplierRow[] }>('/suppliers');
export const addSupplier = (body: SupplierBody) => call<{ supplier: SupplierRow }>('/suppliers', { method: 'POST', body });
export const editSupplier = (id: string, body: Partial<SupplierBody>) => call<{ supplier: SupplierRow }>(`/suppliers/${id}`, { method: 'PUT', body });
type LoginAnswer = { login: SupplierLoginInfo; emailed?: boolean; link?: string };
export const addLogin = (supplierId: string, body: { name: string; email: string; language: string }) => call<LoginAnswer>(`/suppliers/${supplierId}/logins`, { method: 'POST', body });
export const editLogin = (supplierId: string, id: string, body: { name: string; email: string; language: string }) => call<LoginAnswer>(`/suppliers/${supplierId}/logins/${id}`, { method: 'PUT', body });
export const sendLoginLink = (supplierId: string, id: string) => call<LoginAnswer>(`/suppliers/${supplierId}/logins/${id}/invite`, { method: 'POST', body: {} });
export const setLoginActive = (supplierId: string, id: string, active: boolean) => call<LoginAnswer>(`/suppliers/${supplierId}/logins/${id}/active`, { method: 'POST', body: { active } });
export const unlockLogin = (supplierId: string, id: string) => call<LoginAnswer>(`/suppliers/${supplierId}/logins/${id}/unlock`, { method: 'POST', body: {} });

export const listIncoming = () => call<{ items: IncomingItem[] }>('/incoming');
