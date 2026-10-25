import FormModal from '../../../components/shared/form/FormModal';
import type { Plan, PlanRow } from '../../../purchasing/types';
import { num } from './BuyerQueue';
import IncomingSupply from './IncomingSupply';
export default function PlanDetails({
  row,
  plan,
  onClose,
  onConfigure,
}: {
  row: PlanRow;
  plan: Plan;
  onClose: () => void;
  onConfigure?: () => void;
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
      footerStart={
        onConfigure ? (
          <button type="button" onClick={onConfigure}>
            Configure variant policy
          </button>
        ) : null
      }
    >
      <div className="purchase-form">
        {row.blockers.length > 0 && (
          <div className="purchase-warning">
            <strong>Quantity is blocked</strong>
            <ul>
              {row.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
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
          <dt>Total SPS / allocated / available slabs</dt>
          <dd>{num(row.stockBreakdown?.total)} / {num(row.stockBreakdown?.allocated)} / {num(row.stockBreakdown?.available)}</dd>
          <dt>Current stock cover</dt>
          <dd>{row.coverage?.state === 'known' ? `${num(row.coverage.days)} days` : row.coverage?.state === 'no-sales' ? 'No sales in observed period' : 'Coverage unknown'}</dd>
          <dt>Usable / excluded reported slabs</dt>
          <dd>
            {num(row.readySlabs)} / {num(row.excludedSlabs)}
          </dd>
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
                stroke="#c4a25b"
                strokeDasharray="5 4"
              />
              <polyline
                points={points.map((t, i) => `${x(i)},${y(t.available)}`).join(' ')}
                fill="none"
                stroke="#60b594"
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
      </div>
    </FormModal>
  );
}
