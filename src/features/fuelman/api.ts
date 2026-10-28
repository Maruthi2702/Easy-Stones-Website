import { authFetch } from '../../api/authFetch';
import { API_URL } from '../../config/api';
import type { ExpenseLine, FuelMetadata, LocationTotal, ReportDetail, ReportListItem } from '../../fuelman/types';
const base = `${API_URL}/api/accounting/fuel-man`;
export interface Page<T> { items: T[]; total: number; page: number; limit: number }
export interface Pnl {
  month: string; source: string; accountingBasis: string; totalCents: number; reportCount: number;
  locations: LocationTotal[]; drivers: { driverKey: string; driverName: string; totalCents: number; locations: string[] }[];
  previousMonth: string; previousTotalCents: number; changePercent: number | null;
}
export interface Audit { _id: string; at: string; action: string; actor: { name: string }; note: string }
async function json<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await authFetch(base + path, options);
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'Fuel Man could not load this data'), { status: response.status });
  return body;
}
export const fuelApi = {
  metadata: (signal?: AbortSignal) => json<FuelMetadata>('/metadata', { signal }),
  revision: (signal?: AbortSignal) => json<{ revision: number }>('/revision', { signal }),
  reports: (page: number, limit: number, signal?: AbortSignal) => json<Page<ReportListItem>>(`/reports?page=${page}&limit=${limit}`, { signal }),
  detail: (id: string, signal?: AbortSignal) => json<ReportDetail>(`/reports/${id}`, { signal }),
  lines: (id: string, externalId: string, unknown: boolean, page: number, limit: number, signal?: AbortSignal) =>
    json<Page<ExpenseLine>>(`/reports/${id}/lines?externalId=${encodeURIComponent(externalId)}&unknown=${unknown}&page=${page}&limit=${limit}`, { signal }),
  history: (id: string, page: number, limit: number, signal?: AbortSignal) => json<Page<Audit>>(`/reports/${id}/history?page=${page}&limit=${limit}`, { signal }),
  pnl: (month: string, location: string, signal?: AbortSignal) => json<Pnl>(`/pnl?month=${month}&location=${encodeURIComponent(location)}`, { signal }),
  command: (id: string, action: string, data: unknown) => json(`/reports/${id}/${action}`, { method: 'POST', body: JSON.stringify(data) }),
  upload: (file: File) => { const body = new FormData(); body.append('file', file); return json<{ id: string; month: string; duplicate: boolean }>('/reports', { method: 'POST', body }); },
};
export async function downloadFuel(path: string, name: string) {
  const response = await authFetch(base + path);
  if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'Download failed'); }
  const url = URL.createObjectURL(await response.blob()), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
