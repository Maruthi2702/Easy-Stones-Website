import { poStageOf, poTotals, timeAgo, dayText } from '../supplierPosView';
import type { Po } from '../types';

export function Chip({ colour, children }: { colour: string; children: React.ReactNode }) {
  return <span className={`sp-chip is-${colour}`}>{children}</span>;
}

/** Approved of ordered, with what waits on us shaded after it. */
export function CoverageBar({ ordered, approved, waiting, compact = false }: { ordered: number; approved: number; waiting: number; compact?: boolean }) {
  const pct = (n: number) => (ordered ? Math.min(100, Math.round((n / ordered) * 100)) : 0);
  const a = pct(approved);
  const w = Math.min(100 - a, pct(waiting));
  return (
    <div className={`sp-cov${compact ? ' is-compact' : ''}`}>
      <div className="sp-cov-bar" role="img" aria-label={`${approved} of ${ordered} slabs approved, ${waiting} waiting for review`}>
        <span className="sp-cov-ok" style={{ width: `${a}%` }} />
        <span className="sp-cov-wait" style={{ width: `${w}%` }} />
      </div>
      <span className="sp-cov-k"><b>{approved}</b> / {ordered}{waiting ? <span className="sp-muted"> · {waiting} waiting</span> : null}</span>
    </div>
  );
}

const materials = (po: Po) => {
  const first = po.lines[0];
  if (!first) return '—';
  const more = po.lines.length - 1;
  return <>{first.material}{first.thickness ? ` ${first.thickness}` : ''}{more ? <span className="sp-muted"> +{more} more</span> : null}</>;
};

export default function PoList({ rows, isPhone, onOpen }: { rows: Po[]; isPhone: boolean; onOpen: (po: Po) => void }) {
  if (isPhone) {
    return (
      <div className="sp-cards">
        {rows.map((po) => {
          const st = poStageOf(po.stage);
          const t = poTotals(po);
          return (
            <button key={po.id} type="button" className="sp-card" onClick={() => onOpen(po)}>
              <span className="sp-card-top"><b>PO {po.poNumber}</b><Chip colour={st.colour}>{st.label}</Chip></span>
              <span className="sp-card-meta">{po.supplierName} · {materials(po)}</span>
              <CoverageBar ordered={t.ordered} approved={t.approved} waiting={t.waiting} compact />
              <span className="sp-card-meta">{po.shipTo}{po.readyBy ? ` · ready by ${dayText(po.readyBy)}` : ''} · {timeAgo(po.lastActivityAt)}</span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="sp-table-wrap">
      <table className="sp-table">
        <thead>
          <tr>
            <th>PO #</th><th>Supplier</th><th>Material</th><th className="sp-col-wide">Ship to</th><th>Approved slabs</th><th>Status</th><th className="sp-col-wide">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((po) => {
            const st = poStageOf(po.stage);
            const t = poTotals(po);
            return (
              <tr key={po.id} onClick={() => onOpen(po)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(po); }}>
                <td><div className="sp-who"><b>{po.poNumber}</b><span><span className="sp-tag">{po.source === 'sps' ? 'SPS' : 'Typed'}</span>{po.readyBy ? ` ready ${dayText(po.readyBy)}` : ''}</span></div></td>
                <td><div className="sp-who"><b>{po.supplierName}</b><span>{po.supplierCountry}</span></div></td>
                <td>{materials(po)}</td>
                <td className="sp-col-wide">{po.shipTo}</td>
                <td><CoverageBar ordered={t.ordered} approved={t.approved} waiting={t.waiting} /></td>
                <td><Chip colour={st.colour}>{st.label}</Chip>{po.blockStages.review + po.blockStages.final > 1 ? <span className="sp-sub"> · {po.blockStages.review + po.blockStages.final} blocks</span> : null}</td>
                <td className="sp-col-wide sp-muted">{timeAgo(po.lastActivityAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
