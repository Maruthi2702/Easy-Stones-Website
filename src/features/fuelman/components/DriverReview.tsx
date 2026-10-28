import { useMemo, useState } from 'react';
import type { ReportDetail, ReviewDriver } from '../../../fuelman/types';
import Pagination from '../../../components/shared/Pagination';
import { pageCount, usePagination } from '../../../components/shared/paginationConfig';
import { money } from '../format';
type SortKey = 'driver' | 'location' | 'total' | 'status';
export default function DriverReview({ report, canEdit, onAssign, onInspect }: {
  report: ReportDetail; canEdit: boolean; onAssign: (driver: ReviewDriver) => void; onInspect: (id: string) => void;
}) {
  const needsAttention = (d: ReviewDriver) => d.issues.length > 0;
  const [search, setSearch] = useState(''), [attention, setAttention] = useState(() => report.status === 'draft' && report.review.drivers.some(needsAttention)),
    [breakdown, setBreakdown] = useState(false), [sort, setSort] = useState<{ by: SortKey; down: boolean }>({ by: 'status', down: false }), pager = usePagination();
  const rows = useMemo(() => {
    const found = report.review.drivers.filter(d => `${d.externalId} ${d.name} ${d.driverName} ${d.locations.join(' ')}`.toLowerCase().includes(search.toLowerCase()) && (!attention || needsAttention(d)));
    const key: Record<SortKey, (d: ReviewDriver) => string | number> = { driver: d => (d.driverName || d.name).toLowerCase(), location: d => d.locations.join(' / ').toLowerCase(),
      total: d => d.totalCents, status: d => (needsAttention(d) ? 0 : 1) };
    const by = key[sort.by];
    return [...found].sort((a, b) => (by(a) < by(b) ? -1 : by(a) > by(b) ? 1 : (a.driverName || a.name).localeCompare(b.driverName || b.name)) * (sort.down ? -1 : 1));
  }, [report, search, attention, sort]);
  const visible = rows.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
  const head = (by: SortKey, label: string) => <th aria-sort={sort.by === by ? (sort.down ? 'descending' : 'ascending') : 'none'}>
    <button type="button" className="fuel-sort" onClick={() => { setSort(old => ({ by, down: old.by === by ? !old.down : by === 'total' })); pager.resetPage(); }}>{label}{sort.by === by ? (sort.down ? ' ↓' : ' ↑') : ''}</button></th>;
  return <>
    <div className="fuel-toolbar"><input aria-label="Search drivers" placeholder="Search driver or reported ID" value={search} onChange={e => { setSearch(e.target.value); pager.resetPage(); }} />
      <label className="fuel-check"><input type="checkbox" checked={attention} onChange={e => { setAttention(e.target.checked); pager.resetPage(); }} />Needs attention only</label>
      <label className="fuel-check"><input type="checkbox" checked={breakdown} onChange={e => setBreakdown(e.target.checked)} />Show cost breakdown</label>
      <span className="fuel-muted">{rows.length} drivers · {report.status === 'draft' ? 'Saved driver matches carry forward each month' : 'Approved allocation snapshot'}</span></div>
    <div className="fuel-table-wrap"><table className="fuel-table"><thead><tr>{head('driver', 'Driver / reported ID')}{head('location', 'Cost location')}{breakdown && <><th>Fuel</th><th>DEF</th><th>Supplies</th><th>Taxes / credits</th></>}{head('total', 'Total expense')}{head('status', 'Review')}</tr></thead>
      <tbody>{visible.map(d => <tr key={d.externalId}>
        <td data-label="Driver"><button className="fuel-link" onClick={() => onInspect(d.externalId)}>{d.driverName || d.name}</button><small>{d.externalId}</small></td>
        <td data-label="Cost location">{d.locations.join(' / ') || 'Not assigned'}</td>
        {breakdown && <><td data-label="Fuel">{money(d.amounts.fuel)}</td><td data-label="DEF">{money(d.amounts.def)}</td><td data-label="Supplies">{money(d.amounts.supplies)}</td>
          <td data-label="Taxes / credits">{money(d.amounts.tax)}<small>Adjustments {money(d.amounts.adjustment)}</small>{d.amounts.other !== 0 && <small>Unknown charges {money(d.amounts.other)}</small>}</td></>}
        <td data-label="Total expense"><strong>{money(d.totalCents)}</strong><small>{d.lineCount} expense lines{!breakdown && d.amounts.other !== 0 ? ` · ${money(d.amounts.other)} unknown charges` : ''}</small></td>
        <td data-label="Review">{d.issues.length ? <><span className="fuel-status draft">Needs attention</span><small>{d.issues[0]}{d.issues.length > 1 ? ` (+${d.issues.length - 1} more)` : ''}</small></> : <span className="fuel-status posted">Saved match</span>}
          {canEdit && <button className="fuel-small" onClick={() => onAssign(d)}>{d.driverKey ? 'Edit assignment' : 'Assign driver'}</button>}</td>
      </tr>)}</tbody></table></div>
    {!rows.length && <p className="fuel-empty">{attention && !search ? 'Every driver in this report has a location. ' : 'No drivers match this view. '}{attention && <button type="button" className="fuel-link" onClick={() => setAttention(false)}>Show all drivers</button>}</p>}
    <Pagination {...pager} totalPages={pageCount(rows.length, pager.rowsPerPage)} totalCount={rows.length} onPageChange={pager.setCurrentPage} onRowsPerPageChange={pager.setRowsPerPage} />
  </>;
}
