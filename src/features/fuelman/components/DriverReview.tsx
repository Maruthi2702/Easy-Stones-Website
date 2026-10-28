import { useMemo, useState } from 'react';
import type { ReportDetail, ReviewDriver } from '../../../fuelman/types';
import Pagination from '../../../components/shared/Pagination';
import { pageCount, usePagination } from '../../../components/shared/paginationConfig';
import { money } from '../format';
export default function DriverReview({ report, canEdit, onAssign, onInspect }: {
  report: ReportDetail; canEdit: boolean; onAssign: (driver: ReviewDriver) => void; onInspect: (id: string) => void;
}) {
  const [search, setSearch] = useState(''), [attention, setAttention] = useState(false), pager = usePagination();
  const rows = useMemo(() => report.review.drivers.filter(d => `${d.externalId} ${d.name} ${d.driverName} ${d.locations.join(' ')}`.toLowerCase().includes(search.toLowerCase()) && (!attention || d.issues.length)), [report, search, attention]);
  const visible = rows.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
  return <>
    <div className="fuel-toolbar"><input aria-label="Search drivers" placeholder="Search driver or reported ID" value={search} onChange={e => { setSearch(e.target.value); pager.resetPage(); }} />
      <label className="fuel-check"><input type="checkbox" checked={attention} onChange={e => { setAttention(e.target.checked); pager.resetPage(); }} />Needs attention only</label>
      <span className="fuel-muted">{rows.length} reported identities · {report.status === 'draft' ? 'Saved driver matches carry forward each month' : 'Approved allocation snapshot'}</span></div>
    <div className="fuel-table-wrap"><table className="fuel-table"><thead><tr><th>Driver / reported ID</th><th>Cost location</th><th>Fuel</th><th>DEF</th><th>Supplies</th><th>Taxes / credits</th><th>Total expense</th><th>Review</th></tr></thead>
      <tbody>{visible.map(d => <tr key={d.externalId}>
        <td data-label="Driver"><button className="fuel-link" onClick={() => onInspect(d.externalId)}>{d.driverName || d.name}</button><small>{d.externalId}</small></td>
        <td data-label="Cost location">{d.locations.join(' / ') || 'Not assigned'}</td>
        <td data-label="Fuel">{money(d.amounts.fuel)}</td><td data-label="DEF">{money(d.amounts.def)}</td><td data-label="Supplies">{money(d.amounts.supplies)}</td>
        <td data-label="Taxes / credits">{money(d.amounts.tax)}<small>Adjustments {money(d.amounts.adjustment)}</small>{d.amounts.other !== 0 && <small>Unclassified {money(d.amounts.other)}</small>}</td>
        <td data-label="Total expense"><strong>{money(d.totalCents)}</strong><small>{d.lineCount} expense lines</small></td>
        <td data-label="Review">{d.issues.length ? <><span className="fuel-status draft">Needs attention</span><small>{d.issues.join('. ')}</small></> : <span className="fuel-status posted">Saved match</span>}
          {canEdit && <button className="fuel-small" onClick={() => onAssign(d)}>{d.driverKey ? 'Edit assignment' : 'Assign driver'}</button>}</td>
      </tr>)}</tbody></table></div>
    {!rows.length && <p className="fuel-empty">No drivers match this view.</p>}
    <Pagination {...pager} totalPages={pageCount(rows.length, pager.rowsPerPage)} totalCount={rows.length} onPageChange={pager.setCurrentPage} onRowsPerPageChange={pager.setRowsPerPage} />
  </>;
}
