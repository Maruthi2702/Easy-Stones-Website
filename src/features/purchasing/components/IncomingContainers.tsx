import { useMemo, useState } from 'react';
import type { Plan, ImportedTransitLine } from '../../../purchasing/types';
import Pagination from '../../../components/shared/Pagination';
import { pageCount, usePagination } from '../../../components/shared/paginationConfig';
import FormModal from '../../../components/shared/form/FormModal';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { todayPacific } from '../../../purchasing/planning';
import { purchasingApi } from '../purchasingApi';
import { num } from './BuyerQueue';
export default function IncomingContainers({ plan, canEdit, onImport, onChanged }: {
  plan: Plan; canEdit: boolean; onImport?: () => void; onChanged: () => void;
}) {
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<ImportedTransitLine | null>(null), [date, setDate] = useState(''),
    [saving, setSaving] = useState(false), [error, setError] = useState('');
  const pagination = usePagination();
  const lines = useMemo(() => [...new Map(plan.rows.flatMap(row => row.transit || []).map(line => [line.key, line])).values()], [plan]);
  const today = todayPacific(new Date());
  const rows = lines.filter(line => [line.product, line.poNumber, line.containerNumber, line.branch, line.supplier].join(' ').toLowerCase().includes(search.toLowerCase()) &&
    (filter === 'all' || (filter === 'overdue' && !!line.eta && line.eta < today) || (filter === 'unconfirmed' && !line.receiptConfirmed)));
  const visible = rows.slice((pagination.currentPage - 1) * pagination.rowsPerPage, pagination.currentPage * pagination.rowsPerPage);
  async function save() {
    if (!selected?.shipmentId || !selected.sourceSignature || !date) return;
    setSaving(true); setError('');
    try { await purchasingApi.confirmReceipt(plan.scope._id, selected.shipmentId, date, selected.sourceSignature); setSelected(null); onChanged(); }
    catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }
  return <div className="purchase-panel">
    <div className="purchase-heading"><div><h3>Incoming containers</h3><p className="purchase-muted">Reported ETA comes from SPS. Expected warehouse receipt is the buyer's receiving date, used for purchase planning.</p></div>
      {onImport && <button className="purchase-primary" onClick={onImport}>Upload SPS in-transit report</button>}</div>
    <div className="purchase-toolbar">
      <input aria-label="Search incoming containers" placeholder="Color, PO, container or supplier" value={search} onChange={e => { setSearch(e.target.value); pagination.resetPage(); }} />
      <select aria-label="Incoming container filter" value={filter} onChange={e => { setFilter(e.target.value); pagination.resetPage(); }}>
        <option value="all">All incoming</option><option value="overdue">Reported ETA passed</option><option value="unconfirmed">Receiving date not set</option>
      </select>
      <span className="purchase-muted">{new Set(lines.map(l => l.containerNumber).filter(Boolean)).size} known containers · {lines.length} product lines</span>
    </div>
    <div className="purchase-scroll purchase-responsive-table"><table><thead><tr>
      <th>Color & variant</th><th>PO / Container</th><th>Destination</th><th>Incoming slabs</th><th>Reported ETA</th><th>Expected warehouse receipt</th>
    </tr></thead><tbody>{visible.map(line => <tr key={line.key}>
      <td data-label="Color"><strong>{line.product}</strong><small>{line.supplier || 'Supplier unknown'}</small></td>
      <td data-label="PO / Container">PO #{line.poNumber || 'Unknown'}<small>{line.containerNumber || 'Container ID missing'}</small></td>
      <td data-label="Destination">{line.branch}</td><td data-label="Incoming">{line.slabs === null ? 'Unknown slabs' : `${num(line.slabs)} slabs`}<small>{num(line.quantity)} {line.units}</small></td>
      <td data-label="Reported ETA">{line.eta || 'Not reported'}{line.eta && line.eta < today && <small>Reported date passed</small>}</td>
      <td data-label="Warehouse receipt">{line.receiptConfirmed ? line.usableReceiptDate : 'Not set'}
        {canEdit && line.shipmentId && line.sourceSignature && <small><button className="purchase-link" onClick={() => { setSelected(line); setDate(line.usableReceiptDate || ''); setError(''); }}>Set receiving date</button></small>}</td>
    </tr>)}</tbody></table></div>
    {!rows.length && <p className="purchase-empty">{lines.length ? 'No incoming lines match these filters.' : 'Upload your SPS in-transit report to see incoming containers.'}</p>}
    <Pagination {...pagination} totalPages={pageCount(rows.length, pagination.rowsPerPage)} totalCount={rows.length} onPageChange={pagination.setCurrentPage} onRowsPerPageChange={pagination.setRowsPerPage} />
    {selected && <FormModal title="Expected warehouse receipt" onClose={() => setSelected(null)} onSubmit={e => { e.preventDefault(); void save(); }} saving={saving} submitLabel="Save receiving date" submitDisabled={!date || date < today} dirtyCount={date !== (selected.usableReceiptDate || '') ? 1 : 0}>
      <div className="purchase-form"><p>PO #{selected.poNumber || 'Unknown'} · {selected.containerNumber || 'Container ID missing'} · {selected.branch}</p>
        <p>This date applies to all product lines in this PO/container group. Confirm when the slabs are expected to be usable in the warehouse. It does not mark them received.</p>
        {error && <p role="alert" className="purchase-error">{error}</p>}
        <DatePicker min={today} value={date} onChange={setDate} ariaLabel="Expected warehouse receipt date" sheetTitle="Expected warehouse receipt date" />
      </div>
    </FormModal>}
  </div>;
}
