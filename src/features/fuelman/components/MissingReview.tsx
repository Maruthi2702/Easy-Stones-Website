import type { MissingIdentity, ReportDetail } from '../../../fuelman/types';
import { reasonLabels } from '../format';
export default function MissingReview({ report, canEdit, onResolve }: { report: ReportDetail; canEdit: boolean; onResolve: (value: MissingIdentity) => void }) {
  return <div className="fuel-missing-list"><p className="fuel-muted">Expected identities are based on this fleet's dated assignments. A missing identity does not establish that a person left the company.</p>
    {!report.review.missing.length && <p className="fuel-empty">No missing drivers need review for this period.</p>}
    {report.review.missing.map(m => <article className="fuel-missing" key={m.externalId}>
      <div><strong>{m.driverName}</strong><small>{m.externalId}</small></div><div><span className={`fuel-status ${m.resolved ? 'posted' : 'draft'}`}>{m.reason ? reasonLabels[m.reason] : 'Reason required'}</span>{m.note && <p>{m.note}</p>}</div>
      {canEdit && <button onClick={() => onResolve(m)}>{m.reason ? 'Edit reason' : 'Record reason'}</button>}
    </article>)}
  </div>;
}
