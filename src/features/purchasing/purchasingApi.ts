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
  revision: (signal?: AbortSignal) => json<{ revision: number }>('/revision', { signal }),
  confirmReceipt: (id: string, shipment: string, date: string, signature: string) => json(`/scopes/${id}/incoming/${shipment}/receipt`, body({ date, signature })),
  metadata: (signal?: AbortSignal) => json<Metadata>('/metadata', { signal }),
  plan: (id: string, signal?: AbortSignal) => json<Plan>(`/scopes/${id}/plan`, { signal }),
  drafts: (id: string, signal?: AbortSignal, cursor?: string) => json<{ items: Draft[]; nextCursor: string | null }>(`/scopes/${id}/drafts?paginated=true&limit=50${cursor ? `&cursor=${cursor}` : ''}`, { signal }),
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
export function exportPlan(plan: Plan, days = 10) {
  download('purchasing-review.csv', csv([
    ['Color & variant', 'Branches', 'UOM', 'Reported sold', 'Sold slabs', 'Total SPS slabs', 'Allocated', 'Other unavailable', 'Available slabs', 'Available quantity',
      'Stock lasts (days)', 'Coverage state', 'Planning days', 'Projected balance (UOM)', 'In-transit slabs (known)', 'Unknown slab lines', 'Known containers', 'Missing container IDs',
      'Next reported ETA', '60-day suggested buy', '90-day suggested buy', 'Replenishment needed by', 'Purchase action', 'Purchase requirements', 'Coverage notes', 'Sales start', 'Sales through', 'Stock imported', 'Transit imported', 'Calculated at', 'Input fingerprint'],
    ...plan.rows.map(r => {
      const c = r.coverage, lines = r.transit || [];
      return [r.product, plan.scope.branches.join(' / '), r.uom, r.sold, r.soldSlabs, r.stockBreakdown?.total, r.stockBreakdown?.allocated, r.stockBreakdown?.otherUnavailable,
        r.stockBreakdown?.available, r.stockBreakdown?.availableQuantity, c?.days, c?.state, days,
        c && ['known', 'estimated', 'no-sales'].includes(c.state) ? c.availableQuantity! - c.dailyQuantity! * days : null,
        lines.filter(l => l.slabs !== null).reduce((sum, l) => sum + l.slabs!, 0), lines.filter(l => l.slabs === null).length,
        new Set(lines.map(l => l.containerNumber).filter(Boolean)).size, lines.filter(l => !l.containerNumber).length,
        lines.map(l => l.eta).filter(Boolean).sort()[0], r.baseline?.proposedSlabs, r.protective?.proposedSlabs, r.protective?.bufferBreachOn,
        r.action, r.blockers.join('; '), [...(c?.reasons || []), ...(c?.warnings || [])].join('; '), c?.salesPeriod?.start, c?.salesPeriod?.through,
        plan.stockImportedAt, plan.transitImportedAt, plan.generatedAt, plan.fingerprint];
    }),
  ]));
}
