import { useCallback, useState } from 'react';
import type { ExpenseLine, ReportDetail } from '../../../fuelman/types';
import Pagination from '../../../components/shared/Pagination';
import { pageCount, usePagination } from '../../../components/shared/paginationConfig';
import { fuelApi } from '../api';
import { categoryLabels, money } from '../format';
import { useFuelQuery } from '../useFuelQuery';
export default function Transactions({ report, externalId, canEdit, onClassify, reload }: {
  report: ReportDetail; externalId: string; canEdit: boolean; onClassify: (line: ExpenseLine) => void; reload: number;
}) {
  const pager = usePagination(), [onlyUnknown, setUnknown] = useState(false);
  const { currentPage, rowsPerPage } = pager;
  const read = useCallback((signal: AbortSignal) => fuelApi.lines(report.id, externalId, onlyUnknown, currentPage, rowsPerPage, signal), [report.id, externalId, onlyUnknown, currentPage, rowsPerPage]);
  const { data, error, loading } = useFuelQuery(JSON.stringify([report.id, externalId, onlyUnknown, currentPage, rowsPerPage, reload]), read);
  const rows = data?.items || [], total = data?.total || 0;
  return <><div className="fuel-toolbar"><strong>{externalId || 'All reported identities'}</strong><label className="fuel-check"><input type="checkbox" checked={onlyUnknown} onChange={e => { setUnknown(e.target.checked); pager.resetPage(); }} />Unclassified only</label><span className="fuel-muted">Expense line items · subtotals are never counted twice</span></div>
    {error && <p className="fuel-error" role="alert">{error}</p>}{loading && <p role="status">Loading expenses…</p>}
    <div className="fuel-table-wrap"><table className="fuel-table"><thead><tr><th>Date / driver</th><th>Vehicle / site</th><th>Category</th><th>Quantity</th><th>Amount</th><th>Source</th></tr></thead>
      <tbody>{rows.map(line => <tr key={line.index}>
        <td data-label="Date / driver">{line.date} · {line.time}<small>{line.externalId}</small>{line.date < report.start && <small>Predates this statement</small>}</td>
        <td data-label="Vehicle / site">{line.vehicle}<small>Site {line.site}</small></td>
        <td data-label="Category">{categoryLabels[line.category]}<small>{line.fuelCode}</small>{canEdit && <button className="fuel-small" onClick={() => onClassify(line)}>Classify</button>}</td>
        <td data-label="Quantity">{line.quantity || '—'}{line.netPrice && <small>Net unit price {line.netPrice}</small>}</td>
        <td data-label="Amount"><strong>{money(line.amountCents)}</strong>{!!line.exceptionCodes.length && <small>Source exceptions: {line.exceptionCodes.join(', ')}</small>}</td>
        <td data-label="Source">PDF page {line.page}<small>Line {line.index + 1}</small><details><summary>Reported detail</summary><p className="fuel-source-text">{line.description}</p></details></td>
      </tr>)}</tbody></table></div>
    {!loading && !rows.length && !error && <p className="fuel-empty">No expenses match this view.</p>}
    <Pagination {...pager} totalPages={pageCount(total, pager.rowsPerPage)} totalCount={total} onPageChange={pager.setCurrentPage} onRowsPerPageChange={pager.setRowsPerPage} />
  </>;
}
