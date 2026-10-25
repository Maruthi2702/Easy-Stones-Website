import FormModal from '../../../components/shared/form/FormModal';
import type { Plan, PlanRow } from '../../../purchasing/types';
import { num } from './BuyerQueue';
import IncomingSupply from './IncomingSupply';
import { StockCover, StockForecast } from './StockCoverageCells';
export default function PlanDetails({
  row,
  plan,
  onClose,
  onConfigure,
  forecastDays = 10,
}: {
  row: PlanRow;
  plan: Plan;
  onClose: () => void;
  onConfigure?: () => void;
  forecastDays?: number;
}) {
  const p = row.protective,
    points = p?.points || [],
    low = Math.min(0, ...points.map((t) => t.available)),
    high = Math.max(1, p?.safety || 0, ...points.map((t) => t.available));
  const y = (n: number) => 165 - ((n - low) / (high - low || 1)) * 140,
    x = (i: number) => 30 + (i / Math.max(1, points.length - 1)) * 580;
  return (
    <FormModal
      title={row.product}
      size="m"
      onClose={onClose}
      hideSubmit
    >
      <div className="purchase-form">
        <h3>Stock evaluation</h3>
        <dl className="purchase-facts">
          <dt>Scope</dt>
          <dd>{plan.scope.branches.join(' / ')}</dd>
          <dt>Sales cohort</dt>
          <dd>
            {plan.cohort?.location} · {plan.cohort?.start} → observed {plan.scope.observedThrough}
          </dd>
          <dt>Warehouse snapshot</dt>
          <dd>{plan.stockImportedAt ? new Date(plan.stockImportedAt).toLocaleString() : 'Missing'}</dd>
          <dt>SPS incoming snapshot</dt>
          <dd>{plan.inboundImportedAt ? new Date(plan.inboundImportedAt).toLocaleString() : 'Missing'}</dd>
          <dt>Reported quantity</dt>
          <dd>
            {num(row.sold)} {row.uom}
          </dd>
          <dt>Reported slabs sold</dt>
          <dd>{num(row.soldSlabs)}</dd>
          <dt>Total SPS slabs</dt><dd>{num(row.stockBreakdown?.total)}</dd>
          <dt>Allocated slabs</dt><dd>{num(row.stockBreakdown?.allocated)}</dd>
          <dt>Other unavailable slabs</dt><dd>{num(row.stockBreakdown?.otherUnavailable)}</dd>
          <dt>Available to sell</dt><dd>{num(row.stockBreakdown?.available)} {row.stockBreakdown?.available === 1 ? 'slab' : 'slabs'}</dd>
          <dt>Available quantity</dt><dd>{num(row.stockBreakdown?.availableQuantity)} {row.uom}</dd>
          <dt>Current stock cover</dt><dd><StockCover row={row} /></dd>
          <dt>After {forecastDays} days</dt><dd><StockForecast row={row} days={forecastDays} /></dd>
          <dt>Missing stock</dt>
          <dd>
            {row.hasStock
              ? 'Matched to imported stock'
              : row.readySlabs === 0
                ? 'Confirmed zero from complete coverage + variant policy'
                : 'Unresolved; not assumed zero'}
          </dd>
        </dl>
        <div><h3>Imported in-transit containers</h3><IncomingSupply lines={row.transit} /></div>
        <details className="purchase-planning-requirements" open={!!p}>
          <summary>Purchase planning</summary>
          {row.blockers.length > 0 && <>
            <p>Requirements for purchase recommendations:</p>
            <ul>{row.blockers.map(b => <li key={b}>{b}</li>)}</ul>
            <p>Stock quantities and days of cover above are evaluated from the uploaded reports.</p>
          </>}
          {onConfigure && <button type="button" onClick={onConfigure}>Set up purchase planning</button>}
        {p && (
          <>
            <h3>90-day protective case</h3>
            <dl className="purchase-facts">
              <dt>Daily demand (supplier slab equivalents)</dt>
              <dd>{num(p.daily)}</dd>
              <dt>Ready equivalents + eligible incoming slabs</dt>
              <dd>
                {num(p.ready)} + {num(p.inbound)}
              </dd>
              <dt>Safety buffer</dt>
              <dd>{num(p.safety)} slabs</dd>
              <dt>Target position</dt>
              <dd>{num(p.target)} slabs</dd>
              <dt>Net / rounded buy</dt>
              <dd>
                {num(p.rawNeed)} / {num(p.proposedSlabs)} slabs
              </dd>
              <dt>Earliest shortage</dt>
              <dd>{p.stockoutOn || 'None in protection horizon'}</dd>
              <dt>Latest safe order date</dt>
              <dd>{p.orderBy || '—'}</dd>
              <dt>Normal arrival</dt>
              <dd>{p.regularArrival}</dd>
              <dt>Early receiving gap (new or existing supply)</dt>
              <dd>{num(p.bridgeShortfall)} slabs</dd>
              <dt>Urgent subset of total new buy</dt>
              <dd>{num(p.urgentSlabs)} slabs</dd>
            </dl>
            <svg
              className="purchase-chart"
              viewBox="0 0 640 200"
              role="img"
              aria-label="Projected stock using existing supply only"
            >
              <line x1="30" x2="610" y1={y(0)} y2={y(0)} stroke="currentColor" strokeDasharray="4 4" />
              <line
                x1="30"
                x2="610"
                y1={y(p.safety)}
                y2={y(p.safety)}
                stroke="var(--accent-primary)"
                strokeDasharray="5 4"
              />
              <polyline
                points={points.map((t, i) => `${x(i)},${y(t.available)}`).join(' ')}
                fill="none"
                stroke="var(--text-primary)"
                strokeWidth="3"
              />
              <text x="30" y="190" fill="currentColor" fontSize="10">
                {plan.today}
              </text>
              <text x="520" y="190" fill="currentColor" fontSize="10">
                {points.at(-1)?.day}
              </text>
            </svg>
            <p className="purchase-muted">
              Existing supply only. Gold is the safety buffer; a late receipt cannot erase an earlier
              shortage. Receipts are counted at end of day. The urgent subset is included in the total, not an
              additional order.
            </p>
            <p>
              60-day comparison: <strong>{num(row.baseline?.proposedSlabs)} slabs</strong>. These cases are
              alternatives. Demand uses verified SF ÷ inclusive observed days ÷ this variant's supplier
              SF/slab.
            </p>
          </>
        )}
        </details>
      </div>
    </FormModal>
  );
}
