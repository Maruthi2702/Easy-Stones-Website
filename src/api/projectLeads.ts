import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import { queryEntries, type ErrorBody, type Query } from '../types/api';
import type { LeadCompany, LeadStatus, LeadProject } from '../utils/projectLeads';

/** A project as the screen gets it: the export's fields, what staff added, and its companies (best contacts first). */
export type Lead = Omit<LeadProject, 'companies'> & {
  status: LeadStatus;
  assignedTo: string;
  assignedToId: string;
  /** What the caller may do with the lead's assignment (the server decides: src/utils/projectLeadAccess.ts). */
  canTake?: boolean;
  canRelease?: boolean;
  note: string;
  statusBy: string;
  statusAt: string;
  history: { at: string; by: string; status: LeadStatus; note: string; event?: string }[];
  companies: LeadCompany[];
};
export type LeadsPage = { items: Lead[]; total: number; counts: Record<string, number> };
export type LeadsMeta = {
  total: number;
  states: { name: string; count: number }[];
  stages: string[];
  subcategories: { name: string; count: number }[];
  cities: Record<string, string[]>;
  assignees: string[];
  lastImport: { id: string; canUndo: boolean; undone: boolean; fileName: string; projects: number; added: number; updated: number; importedBy: string; importedAt: string } | null;
  canEdit: boolean;
  canImport: boolean;
  canExport: boolean;
};
export type ImportPreview = {
  projects: number; companies: number; added: number; refreshed: number; unchanged: number;
  contactsAdded: number; contactsRemoved: number; older: number; notInFile: number; skippedRows: number;
  samples: { id: string; title: string; changes: { label: string; from: string; to: string }[] }[];
};
export type UndoResult = { restored: number; removed: number; kept: number };
export type ImportResult = { importId: string; projects: number; companies: number; added: number; updated: number; skippedRows: number };

/**
 * Calls to the Multifamily Leads API (src/routes/projectLeads.ts). Each resolves the JSON body or
 * throws an Error whose message can be shown as is.
 */
async function call<T = unknown>(path: string, init: { method?: string; query?: Query; body?: BodyInit; json?: unknown } = {}): Promise<T> {
  const qs = init.query ? `?${new URLSearchParams(queryEntries(init.query))}` : '';
  let res: Response;
  try {
    res = await authFetch(`${API_URL}/api/project-leads${path}${qs}`, {
      method: init.method || 'GET',
      ...(init.json !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.json) } : init.body ? { body: init.body } : {})
    });
  } catch {
    throw Object.assign(new Error('Couldn’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const data: ErrorBody = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || `Something went wrong (${res.status}).`), { status: res.status });
  return data as T;
}

export const leadsMeta = () => call<LeadsMeta>('/meta');
export const listLeads = (query: Query) => call<LeadsPage>('', { query });
export const exportLeads = (query: Query) => call<LeadsPage>('/export', { query });
export const updateLead = (id: string, change: { status?: LeadStatus; note?: string; assignedTo?: string }) =>
  call<Lead>(`/${encodeURIComponent(id)}`, { method: 'PATCH', json: change });
export const importLeadsFile = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return call<ImportResult>('/import', { method: 'POST', body: form });
};
export const previewLeadsFile = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return call<ImportPreview>('/import/preview', { method: 'POST', body: form });
};
export const undoLeadsImport = (importId: string) => call<UndoResult>(`/import/${encodeURIComponent(importId)}/undo`, { method: 'POST' });
