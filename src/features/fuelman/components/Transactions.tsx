import { useCallback, useEffect, useState } from 'react';
import type { ExpenseLine, ReportDetail } from '../../../fuelman/types';
import Pagination from '../../../components/shared/Pagination';
import { pageCount, usePagination } from '../../../components/shared/paginationConfig';
import CustomSelect from '../../../components/shared/CustomSelect';
import { fuelApi } from '../api';
import { CATEGORIES } from '../../../fuelman/types';
import { categoryLabels, money } from '../format';
import { useFuelQuery } from '../useFuelQuery';
export default function Transactions({ report, initialUnknown, externalId, canEdit, onClassify, reload }: {
  report: ReportDetail; initialUnknown: boolean; externalId: string; canEdit: boolean; onClassify: (lines: ExpenseLine[]) => void; reload: number;
}) {
  const pager = usePagination(), [onlyUnknown, setUnknown] = useState(initialUnknown), [text, setText] = useState(''), [search, setSearch] = useState(''),
    [category, setCategory] = useState(''), [priorOnly, setPrior] = useState(false), [picked, setPicked] = useState<Map<number, ExpenseLine>>(new Map());
  const { currentPage, rowsPerPage, resetPage } = pager;
  // Typing waits a moment so every keystroke is not a request.
  useEffect(() => { const t = setTimeout(() => { setSearch(text.trim()); resetPage(); }, 300); return () => clearTimeout(t); }, [text, resetPage]);
  const read = useCallback((signal: AbortSignal) => fuelApi.lines(report.id, { externalId, unknownOnly: onlyUnknown, search, category, priorOnly }, currentPage, rowsPerPage, signal),
    [report.id, externalId, onlyUnknown, search, category, priorOnly, currentPage, rowsPerPage]);
  const { data, error, loading } = useFuelQuery(JSON.stringify([report.id, externalId, onlyUnknown, search, category, priorOnly, currentPage, rowsPerPage, reload]), read);
  const rows = data?.items || [], total = data?.total || 0, hasPrior = report.priorDateLineCount > 0;
  const fixable = rows.filter(l => l.category === 'other'), allFixablePicked = fixable.length > 0 && fixable.every(l => picked.has(l.index));
  const toggle = (line: ExpenseLine) => setPicked(old => { const next = new Map(old); if (next.has(line.index)) next.delete(line.index); else next.set(line.index, line); return next; });
  const togglePage = () => setPicked(old => { const next = new Map(old); fixable.forEach(l => allFixablePicked ? next.delete(l.index) : next.set(l.index, l)); return next; });
  const filtered = !!(search || category || priorOnly || onlyUnknown);
  return <><div className="fuel-toolbar"><strong>{externalId || 'All drivers'}</strong>
      <input aria-label="Search transactions" placeholder="Search vehicle, site, date or amount" value={text} onChange={e => setText(e.target.value)} />
      <CustomSelect value={category} triggerAriaLabel="Category" onChange={e => { setCategory(String(e.target.value)); resetPage(); }} placeholder="All categories"
        options={[{ value: '', label: 'All categories' }, ...CATEGORIES.map(value => ({ value, label: categoryLabels[value] }))]} />
      <label className="fuel-check"><input type="checkbox" checked={onlyUnknown} onChange={e => { setUnknown(e.target.checked); resetPage(); }} />Unknown charges only</label>
      {hasPrior && <label className="fuel-check"><input type="checkbox" checked={priorOnly} onChange={e => { setPrior(e.target.checked); resetPage(); }} />Dated before this statement ({report.priorDateLineCount})</label>}
      {filtered && <button type="button" className="fuel-small" onClick={() => { setText(''); setSearch(''); setCategory(''); setUnknown(false); setPrior(false); resetPage(); }}>Clear filters</button>}
    </div>
    <p className="fuel-muted" role="status">{loading ? 'Loading expenses…' : `${total} ${total === 1 ? 'expense' : 'expenses'}${filtered ? ' match' : ''} · subtotals are never counted twice`}</p>
    {canEdit && !!picked.size && <div className="fuel-bulk" role="region" aria-label="Selected transactions"><strong>{picked.size} selected</strong>
      <button type="button" className="fuel-primary" onClick={() => onClassify([...picked.values()])}>Choose a category for {picked.size}</button>
      <button type="button" onClick={() => setPicked(new Map())}>Clear selection</button></div>}
    {error && <p className="fuel-error" role="alert">{error}</p>}
    <div className="fuel-table-wrap"><table className="fuel-table"><thead><tr>{canEdit && <th><input type="checkbox" aria-label="Select all unknown charges on this page" disabled={!fixable.length} checked={allFixablePicked} onChange={togglePage} /></th>}
      <th>Date / driver</th><th>Vehicle / site</th><th>Category</th><th>Quantity</th><th>Amount</th><th>Source</th></tr></thead>
      <tbody>{rows.map(line => <tr key={line.index}>
        {canEdit && <td data-label="Select">{line.category === 'other' && <input type="checkbox" aria-label={`Select ${line.date} ${money(line.amountCents)}`} checked={picked.has(line.index)} onChange={() => toggle(line)} />}</td>}
        <td data-label="Date / driver">{line.date} · {line.time}<small>{line.externalId}</small>{line.date < report.start && <small>Predates this statement</small>}</td>
        <td data-label="Vehicle / site">{line.vehicle}<small>Site {line.site}</small></td>
        <td data-label="Category">{categoryLabels[line.category]}<small>{line.fuelCode}</small>{canEdit && <button className="fuel-small" onClick={() => onClassify([line])}>{line.category === 'other' ? 'Choose category' : 'Change category'}</button>}</td>
        <td data-label="Quantity">{line.quantity || '—'}{line.netPrice && <small>Net unit price {line.netPrice}</small>}</td>
        <td data-label="Amount"><strong>{money(line.amountCents)}</strong>{!!line.exceptionCodes.length && <small>Source exceptions: {line.exceptionCodes.join(', ')}</small>}</td>
        <td data-label="Source">PDF page {line.page}<small>Line {line.index + 1}</small><details><summary>Reported detail</summary><p className="fuel-source-text">{line.description}</p></details></td>
      </tr>)}</tbody></table></div>
    {!loading && !rows.length && !error && <p className="fuel-empty">No expenses match this view.</p>}
    <Pagination {...pager} totalPages={pageCount(total, pager.rowsPerPage)} totalCount={total} onPageChange={pager.setCurrentPage} onRowsPerPageChange={pager.setRowsPerPage} />
  </>;
}
