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
        <p>Stock cover needs valid quantities, dates and matching branches. Supplier, bundle and weight settings are only needed for buying recommendations.</p>
      </details>
      {onReview && <button type="button" className="purchase-link" onClick={onReview}>Review coverage inputs</button>}
    </div>;
  }
  const warnings = !!c.warnings?.length && <details className="purchase-coverage-issue">
    <summary>Estimate assumptions</summary>
    <ul>{c.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
    <p>Uses reported available stock and the selected historical sales pace. Review these inputs before making a purchase.</p>
    {onReview && <button type="button" className="purchase-link" onClick={onReview}>Review coverage inputs</button>}
  </details>;
  if (c.state === 'no-sales') return <><span>No sales in observed period</span>{warnings}</>;
  return <><strong>{c.state === 'estimated' ? '≈ ' : ''}{c.days! > 0 && c.days! < 0.1 ? '<0.1' : num(c.days)} days</strong>
    <small>{c.state === 'estimated' ? 'Estimate · reported stock and historical sales' : 'Current available stock only'}</small>
    {c.salesPeriod && <small>Sales: {c.salesPeriod.start} – {c.salesPeriod.through}</small>}{warnings}{c.stockoutDate && <small>Stockout around {c.stockoutDate}</small>}</>;
}
export function StockForecast({ row, days }: { row: PlanRow; days: number | null }) {
  const c = row.coverage;
  if (!days || !c || !['known', 'estimated'].includes(c.state)) return <span>—</span>;
  const sf = c.availableQuantity! - c.dailyQuantity! * days;
  const perSlab = row.policy?.sfPerSlab;
  const equivalent = Number.isFinite(perSlab) && perSlab! > 0;
  const balance = equivalent ? sf / perSlab! : sf;
  return <><strong>{num(Math.abs(balance))} {balance < -1e-8 ? 'short' : 'left'}</strong>
    <small>{c.state === 'estimated' ? 'Estimate · ' : ''}{equivalent ? 'Slab equivalents' : row.uom} · current stock</small></>;
}


export function StockReview({ row, days }: { row: PlanRow; days: number | null }) {
  const c = row.coverage;
  if (!c || c.state === 'unknown') return <span className="purchase-badge warn">Check report data</span>;
  if (c.state === 'no-sales') return <><span className="purchase-badge">Review slow-moving stock</span><small>No sales in the uploaded period.</small></>;
  if (!days) return <span className="purchase-badge warn">Choose a valid planning period</span>;
  const shortage = c.days !== null && c.days < days;
  return <><span className={shortage ? 'purchase-badge urgent' : 'purchase-badge'}>
    {shortage ? 'Review stock shortage' : c.state === 'estimated' ? 'Estimated cover sufficient' : 'Stock cover sufficient'}
  </span><small>{shortage ? `Available stock does not cover ${days} days at the reported sales pace.` : `Available stock covers the selected ${days} days at the reported sales pace.`}</small></>;
}
