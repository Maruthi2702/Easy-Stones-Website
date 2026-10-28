import { useCallback } from 'react';
import { fuelApi } from '../api';
import { useFuelQuery } from '../useFuelQuery';
import Pagination from '../../../components/shared/Pagination';
import { pageCount, usePagination } from '../../../components/shared/paginationConfig';
export default function History({ id, reload }: { id: string; reload: number }) {
  const pager = usePagination(), { currentPage, rowsPerPage } = pager;
  const read = useCallback((signal: AbortSignal) => fuelApi.history(id, currentPage, rowsPerPage, signal), [id, currentPage, rowsPerPage]);
  const { data, error, loading } = useFuelQuery(JSON.stringify([id, currentPage, rowsPerPage, reload]), read);
  const rows = data?.items || [], total = data?.total || 0;
  return <>{loading && <p role="status">Loading history…</p>}{error && <p className="fuel-error" role="alert">{error}</p>}<div className="fuel-history">{rows.map(row => <article key={row._id}><strong>{row.action.replaceAll('-', ' ')}</strong><span>{row.actor.name} · {new Date(row.at).toLocaleString()}</span><p>{row.note}</p></article>)}</div>
    <Pagination {...pager} totalPages={pageCount(total, pager.rowsPerPage)} totalCount={total} onPageChange={pager.setCurrentPage} onRowsPerPageChange={pager.setRowsPerPage} /></>;
}
