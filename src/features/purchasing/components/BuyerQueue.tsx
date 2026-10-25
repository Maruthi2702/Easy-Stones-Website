import { useState, useMemo, useEffect } from 'react';
import Pagination from '../../../components/shared/Pagination';
import { usePagination, pageCount } from '../../../components/shared/paginationConfig';
import IncomingSupply from './IncomingSupply';
import { StockCover, StockForecast } from './StockCoverageCells';
import type { Plan, PlanRow } from '../../../purchasing/types';
export const num = (value: number | null | undefined) =>
  value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
export default function BuyerQueue({
  plan,
  onInspect,
  onDraft,
  canEdit,
  performance = false,
}: {
  plan: Plan;
  onInspect: (row: PlanRow) => void;
  onDraft: (rows: PlanRow[]) => void;
  canEdit: boolean;
  performance?: boolean;
}) {
  const [search, setSearch] = useState(''),
    [state, setState] = useState('all'),
    [selected, setSelected] = useState<string[]>([]);
  const [forecastDays, setForecastDays] = useState('10');
  const horizon = /^\d+$/.test(forecastDays) && Number(forecastDays) >= 1 && Number(forecastDays) <= 365 ? Number(forecastDays) : null;
  const pagination = usePagination();
  const rows = useMemo(
    () =>
      [...plan.rows]
        .filter(
          (r) =>
            (!performance || r.uom === 'SF') &&
            r.product.toLowerCase().includes(search.toLowerCase()) &&
            (state === 'all' ||
              (state === 'blocked' && r.blockers.length > 0) ||
              (state === 'buy' && !!r.protective?.proposedSlabs) ||
              (state === 'urgent' && !!r.protective?.bridgeShortfall) ||
              (state === 'zero' && r.sold === 0)),
        )
        .sort((a, b) => (performance ? (b.sold || 0) - (a.sold || 0) : 0)),
    [plan, search, state, performance],
  );
  useEffect(() => {
    pagination.resetPage();
    setSelected([]);
  }, [plan.fingerprint, search, state, pagination.resetPage]);
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
          <option value="buy">Replenishment needed</option>
          <option value="urgent">Early receipt gaps</option>
          <option value="blocked">Resolve inputs</option>
          <option value="zero">Verified zero sales</option>
        </select>
        <label className="purchase-horizon">Plan for{' '}
          <input aria-label="Planning days" type="number" min="1" max="365" step="1" value={forecastDays}
            aria-invalid={horizon === null} onChange={e => setForecastDays(e.target.value)} /> days
        </label>
        <div className="purchase-day-presets" aria-label="Planning day presets">
          {[1, 2, 4, 5, 10, 30, 60, 90].map(days => <button type="button" key={days}
            aria-pressed={horizon === days} onClick={() => setForecastDays(String(days))}>{days}d</button>)}
        </div>
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
      <div className="purchase-scroll">
        <table>
          <thead>
            <tr>
              <th>Pick</th>
              <th>Color & variant{performance ? ' · reported SF sales rank' : ''}</th>
              <th>Reported sold / UOM</th>
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
                <td>
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
                <td>
                  <button className="purchase-link" onClick={() => onInspect(r)}>
                    {r.product}
                  </button>
                  {!r.hasStock && (
                    <small>
                      No matching stock row{r.readySlabs === 0 ? ' · policy + coverage confirm zero' : ''}
                    </small>
                  )}
                </td>
                <td>
                  {num(r.sold)} {r.uom}
                  <small>{num(r.soldSlabs)} slabs sold</small>
                </td>
                <td><strong>{num(r.stockBreakdown?.total)}</strong></td>
                <td><strong>{num(r.stockBreakdown?.allocated)}</strong>
                  {r.stockBreakdown?.otherUnavailable != null && <small>{num(r.stockBreakdown.otherUnavailable)} other unavailable</small>}
                </td>
                <td><strong>{num(r.stockBreakdown?.available)}</strong>
                  {r.stockBreakdown?.problems.length ? <small title={r.stockBreakdown.problems.join('\n')}>Stock reconciliation needed</small> : null}
                </td>
                <td><IncomingSupply lines={r.transit} /></td>
                <td><StockCover row={r} /></td>
                <td><StockForecast row={r} days={horizon} /></td>
                <td>
                  <span
                    className={
                      r.blockers.length
                        ? 'purchase-badge warn'
                        : r.protective?.bridgeShortfall
                          ? 'purchase-badge urgent'
                          : 'purchase-badge'
                    }
                  >
                    {r.action}
                  </span>
                  {r.blockers.some(b => !plan.blockers.includes(b)) && <small>{r.blockers.find(b => !plan.blockers.includes(b))}</small>}
                  <details><summary>Buying calculation</summary>
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
