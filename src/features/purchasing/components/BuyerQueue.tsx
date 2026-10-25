import { useState, useMemo, useEffect, useRef } from 'react';
import Pagination from '../../../components/shared/Pagination';
import { usePagination, pageCount } from '../../../components/shared/paginationConfig';
import IncomingSupply from './IncomingSupply';
import { StockCover, StockForecast, StockReview } from './StockCoverageCells';
import { exportPlan } from '../purchasingApi';
import type { Plan, PlanRow } from '../../../purchasing/types';
export const num = (value: number | null | undefined) =>
  value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
export default function BuyerQueue({
  plan,
  onInspect,
  onDraft,
  canEdit,
  onReviewCoverage,
}: {
  plan: Plan;
  onInspect: (row: PlanRow, days?: number) => void;
  onDraft: (rows: PlanRow[]) => void;
  canEdit: boolean;
  onReviewCoverage?: () => void;
}) {
  const [search, setSearch] = useState(''),
    [state, setState] = useState('all'),
    [sort, setSort] = useState('cover'),
    [selected, setSelected] = useState<string[]>([]);
  const [forecastDays, setForecastDays] = useState('10');
  const horizon = /^\d+$/.test(forecastDays) && Number(forecastDays) >= 1 && Number(forecastDays) <= 365 ? Number(forecastDays) : null;
  const pagination = usePagination();
  const rows = useMemo(
    () =>
      [...plan.rows]
        .filter(
          (r) =>
            r.product.toLowerCase().includes(search.toLowerCase()) &&
            (state === 'all' ||
              (state === 'blocked' && r.blockers.length > 0) ||
              (state === 'short' && r.coverage?.days != null && horizon != null && r.coverage.days < horizon) ||
              (state === 'unknown' && r.coverage?.state === 'unknown') ||
              (state === 'buy' && !!r.protective?.proposedSlabs) ||
              (state === 'urgent' && !!r.protective?.bridgeShortfall) ||
              (state === 'zero' && r.sold === 0)),
        )
        .sort((a, b) => {
          if (sort === 'sales') return (b.sold || 0) - (a.sold || 0);
          if (sort === 'name') return a.product.localeCompare(b.product);
          return (a.coverage?.days ?? Number.MAX_VALUE) - (b.coverage?.days ?? Number.MAX_VALUE) || a.product.localeCompare(b.product);
        }),
    [plan, search, state, sort, horizon],
  );
  const selectionContext = JSON.stringify([plan.fingerprint, search, state, sort]);
  const previousContext = useRef(selectionContext);
  useEffect(() => {
    if (previousContext.current === selectionContext) return;
    previousContext.current = selectionContext;
    pagination.resetPage();
    setSelected([]);
  }, [selectionContext, pagination.resetPage]);
  useEffect(() => {
    setSelected((old) => {
      const next = old.filter((key) =>
        plan.rows.some(
          (r) => r.key === key && !r.blockers.length && r.protective?.proposedSlabs && r.policy?.active,
        ),
      );
      return next.length === old.length ? old : next;
    });
  }, [plan.rows]);
  const visible = rows.slice(
    (pagination.currentPage - 1) * pagination.rowsPerPage,
    pagination.currentPage * pagination.rowsPerPage,
  );
  return (
    <div className="purchase-panel">
      <div className="purchase-toolbar">
        <input
          aria-label="Search purchasing colors"
          placeholder="Search exact color / variant"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Purchasing action filter"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="all">All variants</option>
          <option value="short">Short within selected days</option><option value="unknown">Coverage unavailable</option>
          <option value="buy">Replenishment needed</option>
          <option value="urgent">Early receipt gaps</option>
          <option value="blocked">Resolve inputs</option>
          <option value="zero">Verified zero sales</option>
        </select>
        <select aria-label="Sort purchasing colors" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="cover">Lowest stock cover first</option><option value="sales">Highest reported sales first</option><option value="name">Color A–Z</option>
        </select>
        <label className="purchase-horizon">Plan for{' '}
          <input aria-label="Planning days" type="number" min="1" max="365" step="1" value={forecastDays}
            aria-invalid={horizon === null} onChange={e => setForecastDays(e.target.value)} /> days
        </label>
        <div className="purchase-day-presets" aria-label="Planning day presets">
          {[1, 2, 4, 5, 10, 30, 60, 90].map(days => <button type="button" key={days}
            aria-pressed={horizon === days} onClick={() => setForecastDays(String(days))}>{days}d</button>)}
        </div>
        <button onClick={() => exportPlan(plan, horizon || 10)} disabled={!horizon}>Export stock review</button>
        {canEdit && (
          <button
            disabled={!selected.length}
            onClick={() => onDraft(plan.rows.filter((r) => selected.includes(r.key)))}
          >
            Draft {selected.length || ''} selected variants
          </button>
        )}
      </div>
      {horizon === null && <p role="alert">Enter a whole number from 1 to 365 days.</p>}
      <p className="purchase-muted">Total SPS slabs include allocated stock. Days of cover and the selected-day balance use available stock only; in-transit containers are shown separately.</p>
      <div className="purchase-scroll purchase-responsive-table">
        <table>
          <thead>
            <tr>
              <th>Pick</th>
              <th>Color & variant</th>
              <th>Total SPS slabs</th>
              <th>Allocated</th>
              <th>Available to sell</th>
              <th>In-transit containers</th>
              <th>Stock lasts</th>
              <th>{horizon ? `After ${horizon} days` : 'Projected stock'}</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.key}>
                <td data-label="Select">
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.product}`}
                    disabled={
                      !canEdit ||
                      !r.protective?.proposedSlabs ||
                      !!r.blockers.length ||
                      r.policy?.active === false
                    }
                    checked={selected.includes(r.key)}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setSelected((s) => (checked ? [...s, r.key] : s.filter((x) => x !== r.key)));
                    }}
                  />
                </td>
                <td data-label="Color">
                  <button className="purchase-link" onClick={() => onInspect(r, horizon || 10)}>
                    {r.product}
                  </button>
                  <small>{num(r.sold)} {r.uom} sold · {num(r.soldSlabs)} slabs</small>
                  {!r.hasStock && (
                    <small>
                      No matching stock row{r.readySlabs === 0 ? ' · policy + coverage confirm zero' : ''}
                    </small>
                  )}
                </td>
                <td data-label="Total SPS slabs"><strong>{num(r.stockBreakdown?.total)}</strong></td>
                <td data-label="Allocated"><strong>{num(r.stockBreakdown?.allocated)}</strong>
                  {r.stockBreakdown?.otherUnavailable != null && <small>{num(r.stockBreakdown.otherUnavailable)} other unavailable</small>}
                </td>
                <td data-label="Available to sell"><strong>{num(r.stockBreakdown?.available)}</strong>
                  {r.stockBreakdown?.problems.length ? <small title={r.stockBreakdown.problems.join('\n')}>Stock reconciliation needed</small> : null}
                </td>
                <td data-label="In-transit containers"><IncomingSupply lines={r.transit} /></td>
                <td data-label="Stock lasts"><StockCover row={r} onReview={onReviewCoverage} /></td>
                <td data-label={horizon ? `After ${horizon} days` : "Projected stock"}><StockForecast row={r} days={horizon} /></td>
                <td data-label="Next action">
                  <StockReview row={r} days={horizon} />
                  <details><summary>Purchase planning</summary>
                    <p>Purchase status: {r.action}</p>
                    {r.blockers.length > 0 && <><p>Requirements for purchase recommendations:</p>
                      <ul>{r.blockers.filter(b => !plan.blockers.includes(b)).map(b => <li key={b}>{b}</li>)}</ul></>}
                    <p>Suggested buy · 60-day delivery: {num(r.baseline?.proposedSlabs)} slabs</p>
                    <p>Suggested buy · 90-day delivery: {num(r.protective?.proposedSlabs)} slabs</p>
                    <p>Replenishment needed by: {r.protective?.bufferBreachOn || '—'} (safety-buffer threshold)</p>
                    <small>Includes review/buffer policies and eligible incoming supply. Custom planning days do not change draft quantities.</small>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="purchase-empty">No variants match this view.</p>}
      <Pagination
        {...pagination}
        totalPages={pageCount(rows.length, pagination.rowsPerPage)}
        onPageChange={pagination.setCurrentPage}
        onRowsPerPageChange={pagination.setRowsPerPage}
        totalCount={rows.length}
      />
    </div>
  );
}
