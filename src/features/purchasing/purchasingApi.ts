import { authFetch } from '../../api/authFetch';
import { API_URL } from '../../config/api';
import type { Metadata, Plan, Scope, Draft, InboundRow, Receipt } from '../../purchasing/types';
const base = `${API_URL}/api/purchasing`;
async function json<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await authFetch(base + path, options);
  const body = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(body.error || body.message || 'Could not load purchasing data'), {
      status: res.status,
    });
  return body as T;
}
const body = (data: unknown) => ({ method: 'POST', body: JSON.stringify(data) });
export const purchasingApi = {
  metadata: (signal?: AbortSignal) => json<Metadata>('/metadata', { signal }),
  plan: (id: string, signal?: AbortSignal) => json<Plan>(`/scopes/${id}/plan`, { signal }),
  drafts: (id: string, signal?: AbortSignal) => json<Draft[]>(`/scopes/${id}/drafts`, { signal }),
  inbound: (id: string, signal?: AbortSignal) =>
    json<{ rows: InboundRow[]; receipts: Receipt[] } | null>(`/scopes/${id}/inbound`, { signal }),
  saveScope: (value: unknown, id?: string) =>
    json<Scope>(id ? `/scopes/${id}` : '/scopes', { ...body(value), method: id ? 'PUT' : 'POST' }),
  importInbound: (id: string, rows: InboundRow[]) =>
    json(`/scopes/${id}/inbound`, body({ complete: true, rows })),
  createDraft: (id: string, value: unknown) => json<Draft>(`/scopes/${id}/drafts`, body(value)),
  checkedExport: (id: string) => json<Draft>(`/drafts/${id}/export`),
  action: (id: string, action: 'approve' | 'cancel' | 'link', value: unknown) =>
    json<Draft>(`/drafts/${id}/${action}`, body(value)),
};
export function download(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csv(rows: unknown[][]) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? '');
            if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}
export function exportPlan(plan: Plan) {
  download(
    'purchasing-review.csv',
    csv([
      [
        'Variant',
        'Scope',
        'UOM',
        'Sold',
        'Sold slabs',
        'Ready slabs',
        '60-day proposed slabs',
        '90-day proposed slabs',
        'Required receipt',
        'Order by',
        'Urgent subset',
        'Action',
        'Blockers',
        'Observed through',
        'Stock imported',
        'Inbound imported',
        'Input version',
      ],
      ...plan.rows.map((r) => [
        r.product,
        plan.scope.branches.join(' / '),
        r.uom,
        r.sold,
        r.soldSlabs,
        r.readySlabs,
        r.baseline?.proposedSlabs,
        r.protective?.proposedSlabs,
        r.protective?.bufferBreachOn,
        r.protective?.orderBy,
        r.protective?.urgentSlabs,
        r.action,
        r.blockers.join('; '),
        plan.scope.observedThrough,
        plan.stockImportedAt,
        plan.inboundImportedAt,
        plan.fingerprint,
      ]),
    ]),
  );
}
