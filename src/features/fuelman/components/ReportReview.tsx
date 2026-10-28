import { useState } from 'react';
import type { ExpenseLine, FuelMetadata, MissingIdentity, ReportDetail, ReviewDriver } from '../../../fuelman/types';
import { FUEL_MAN as P } from '../../../fuelman/permissions';
import type { Decision } from '../forms/DecisionForm';
import { downloadFuel } from '../api';
import { money, statusLabels } from '../format';
import DriverReview from './DriverReview';
import MissingReview from './MissingReview';
import Transactions from './Transactions';
import History from './History';
import AllocationPreview from './AllocationPreview';
export default function ReportReview({ report, metadata, reload, onAssign, onMissing, onClassify, onDecision, onSetup }: {
  report: ReportDetail; metadata: FuelMetadata; reload: number; onAssign: (d: ReviewDriver) => void; onMissing: (m: MissingIdentity) => void;
  onSetup: () => void; onClassify: (line: ExpenseLine) => void; onDecision: (action: Decision) => void;
}) {
  const [view, setView] = useState('drivers'), [externalId, setExternal] = useState(''), [error, setError] = useState('');
  const canEdit = metadata.global && metadata.permissions.includes(P.RECONCILE) && report.status === 'draft';
  const canPublish = metadata.global && metadata.permissions.includes(P.APPROVE) && report.status !== 'posted';
  const needsReplace = report.status !== 'draft' || !!report.currentPublishedReportId;
  const unassigned = report.review.unassigned;
  const setupCount = report.review.drivers.filter(d => !d.driverKey).length;
  return <>
    <div className="fuel-review-heading"><div><h2>{report.month} <span className="fuel-muted">Revision {report.revision}</span></h2><p>{report.company} · {report.employeeCount} reported identities · {report.lineCount} expense lines</p></div>
      <div className="fuel-actions">{report.canViewSource && <button onClick={() => void downloadFuel(`/reports/${report.id}/source`, `fuelman-${report.month}.pdf`).catch(e => setError(e.message))}>Download original PDF</button>}
        {canPublish && <button className="fuel-primary" disabled={!report.review.ready || report.periodClosed || (needsReplace && !metadata.permissions.includes(P.REVERSE))} onClick={() => onDecision('publish')}>{report.status === 'draft' ? 'Approve location expenses' : 'Restore this revision'}</button>}
        {metadata.global && metadata.permissions.includes(P.REVERSE) && report.status === 'posted' && <button disabled={report.periodClosed} onClick={() => onDecision('reverse')}>Reverse expenses</button>}
        {metadata.global && metadata.permissions.includes(P.CLOSE) && <button onClick={() => onDecision(report.periodClosed ? 'reopen' : 'close')}>{report.periodClosed ? 'Reopen period' : 'Close period'}</button>}
      </div></div>
    {error && <p className="fuel-error" role="alert">{error}</p>}
    <div className="fuel-stats"><div><span>Report total</span><strong>{money(report.totalCents)}</strong></div><div><span>Allocated to locations</span><strong className={!report.review.locations.length && unassigned?.lineCount ? 'fuel-stat-status' : ''}>{!report.review.locations.length && unassigned?.lineCount ? 'Awaiting locations' : money(report.review.allocatedCents)}</strong></div>
      <div><span>Drivers in report</span><strong>{report.employeeCount}</strong></div><div><span>Status</span><strong className="fuel-stat-status">{report.periodClosed ? 'Period closed' : report.status === 'draft' && report.review.ready ? 'Ready to approve' : statusLabels[report.status]}</strong></div></div>
    <div className="fuel-panel fuel-report-panel">
      {report.status === 'draft' && setupCount > 0 && <div className="fuel-setup-notice"><div><strong>{setupCount} drivers need a location</strong><span>Driver expenses are shown below. Confirm locations once to see branch totals.</span></div>{canEdit && <button className="fuel-primary" onClick={onSetup}>Assign locations</button>}</div>}
      {report.status === 'draft' && !setupCount && report.review.unresolvedCount > 0 && <p className="fuel-muted">{report.review.unresolvedCount} review items remain. Check driver details and missing drivers before approval.</p>}
      <nav className="fuel-tabs" aria-label="Report review views">
      <button className={view === 'drivers' ? 'active' : ''} onClick={() => setView('drivers')}>Drivers</button>
      <button className={view === 'missing' ? 'active' : ''} onClick={() => setView('missing')}>Missing drivers {report.review.missing.length ? `(${report.review.missing.length})` : ''}</button>
      <button className={view === 'allocations' ? 'active' : ''} onClick={() => setView('allocations')}>Location allocations</button>
      <button className={view === 'lines' ? 'active' : ''} onClick={() => { setView('lines'); setExternal(''); }}>Transactions</button>
      {metadata.global && metadata.permissions.includes(P.HISTORY) && <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>History</button>}
    </nav>
      {view === 'drivers' && <DriverReview report={report} canEdit={canEdit} onAssign={onAssign} onInspect={id => { setExternal(id); setView('lines'); }} />}
      {view === 'missing' && <MissingReview report={report} canEdit={canEdit} onResolve={onMissing} />}
      {view === 'allocations' && <AllocationPreview report={report} />}
      {view === 'lines' && <Transactions report={report} externalId={externalId} canEdit={canEdit} onClassify={onClassify} reload={reload} />}
      {view === 'history' && <History id={report.id} reload={reload} />}
    </div>
    <details className="fuel-source-notes"><summary>Source and reconciliation</summary><p>{report.start} – {report.end} · {report.pageCount} pages{report.account ? ` · Account ${report.account} · Fleet ${report.fleet}` : ''}</p><ul>{report.warnings.map(w => <li key={w}>{w}</li>)}</ul>
      {!!report.priorDateLineCount && <p>{report.priorDateLineCount} expense lines predate this statement. They remain included; review the dates before approval.</p>}
      <p>Signed detail amounts reconcile to employee totals. Fuel tax is already included in the reported total; adjustments retain their sign.</p></details>
  </>;
}
