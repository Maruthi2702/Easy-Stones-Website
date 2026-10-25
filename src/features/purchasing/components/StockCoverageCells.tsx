import type { PlanRow } from '../../../purchasing/types';
const num = (value: number | null) => value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
export function StockCover({ row, onReview }: { row: PlanRow; onReview?: () => void }) {
  const c = row.coverage;
  if (!c || c.state === 'unknown') {
    const reasons = c?.reasons.length ? c.reasons : ['Refresh purchasing data to load the coverage diagnostics.'];
    return <div className="purchase-coverage-issue">
      <strong>Coverage unknown</strong>
      <details><summary>Why is coverage unavailable?</summary>
        <ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <p>Coverage uses available stock and a verified sales period. Supplier, bundle and weight settings are only needed for buying recommendations.</p>
      </details>
      {onReview && <button type="button" className="purchase-link" onClick={onReview}>Review coverage inputs</button>}
    </div>;
  }
  if (c.state === 'no-sales') return <span>No sales in observed period</span>;
  return <><strong>{c.days! > 0 && c.days! < 0.1 ? '<0.1' : num(c.days)} days</strong>
    <small>Current available stock only</small>{c.stockoutDate && <small>Stockout around {c.stockoutDate}</small>}</>;
}
export function StockForecast({ row, days }: { row: PlanRow; days: number | null }) {
  const c = row.coverage;
  if (!days || !c || c.state !== 'known') return <span>—</span>;
  const sf = c.availableQuantity! - c.dailyQuantity! * days;
  const perSlab = row.policy?.sfPerSlab;
  const equivalent = Number.isFinite(perSlab) && perSlab! > 0;
  const balance = equivalent ? sf / perSlab! : sf;
  return <><strong>{num(Math.abs(balance))} {balance < -1e-8 ? 'short' : 'left'}</strong>
    <small>{equivalent ? 'Slab equivalents' : row.uom} · current stock</small></>;
}
