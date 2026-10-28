import type { ReportDetail } from '../../../fuelman/types';
import Pagination from '../../../components/shared/Pagination';
import { pageCount, usePagination } from '../../../components/shared/paginationConfig';
import { money } from '../format';
export default function AllocationPreview({ report }: { report: ReportDetail }) {
  const pager = usePagination(), rows = report.review.locations;
  const start = (pager.currentPage - 1) * pager.rowsPerPage;
  return <>
    <p className="fuel-muted">{report.status === 'draft' ? 'Preview only. These allocations enter location totals after approval. Unmatched transactions are excluded from this preview.' : 'Saved allocations for this revision. Only the currently published revision contributes to location totals.'}</p>
    <div className="fuel-table-wrap"><table className="fuel-table"><thead><tr><th>Location</th><th>Fuel</th><th>DEF</th><th>Supplies</th><th>Non-fuel tax</th><th>Adjustments</th><th>Unclassified</th><th>Total</th></tr></thead>
      <tbody>{rows.slice(start, start + pager.rowsPerPage).map(row => <tr key={row.location}>
        <td data-label="Location"><strong>{row.location}</strong><small>{row.driverCount} drivers · {row.lineCount} lines</small></td>
        <td data-label="Fuel">{money(row.amounts.fuel)}</td><td data-label="DEF">{money(row.amounts.def)}</td><td data-label="Supplies">{money(row.amounts.supplies)}</td>
        <td data-label="Non-fuel tax">{money(row.amounts.tax)}</td><td data-label="Adjustments">{money(row.amounts.adjustment)}</td><td data-label="Unclassified">{money(row.amounts.other)}</td>
        <td data-label="Total"><strong>{money(row.totalCents)}</strong></td>
      </tr>)}</tbody></table></div>
    {!rows.length && <p className="fuel-empty">Assign drivers to see the location allocation preview.</p>}
    <p>Allocated: <strong>{money(report.review.allocatedCents)}</strong> · Unallocated: <strong>{money(report.review.unallocatedCents)}</strong></p>
    <Pagination {...pager} totalPages={pageCount(rows.length, pager.rowsPerPage)} totalCount={rows.length} onPageChange={pager.setCurrentPage} onRowsPerPageChange={pager.setRowsPerPage} />
  </>;
}
