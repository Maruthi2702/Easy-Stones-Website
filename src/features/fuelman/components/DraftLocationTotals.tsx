import { useState } from 'react';
import type { FuelMetadata, ReportDetail } from '../../../fuelman/types';
import { FUEL_MAN as P } from '../../../fuelman/permissions';
import AllocationPreview from './AllocationPreview';
import LocationTotals from './LocationTotals';
export default function DraftLocationTotals({ report, metadata, reload, onSetup }: { report: ReportDetail; metadata: FuelMetadata; reload: number; onSetup: () => void }) {
  const [published, setPublished] = useState(false);
  return <>
    <div className="fuel-section-heading"><div><h2>{report.month} · {published ? 'Published expenses' : 'Draft location totals'}</h2><p className="fuel-muted">{published ? 'Approved expenses included in P&L.' : 'Your uploaded report. Assign locations to turn unassigned expenses into branch totals.'}</p></div>
      <div className="fuel-actions">{!published && metadata.permissions.includes(P.RECONCILE) && report.review.drivers.some(d => !d.driverKey) && <button className="fuel-primary" onClick={onSetup}>Assign locations</button>}
        <button onClick={() => setPublished(v => !v)}>{published ? 'Show uploaded report' : 'Show published expenses'}</button></div>
    </div>
    {published ? <LocationTotals metadata={metadata} initialMonth={report.month} reload={reload} /> : <div className="fuel-panel"><AllocationPreview report={report} /></div>}
  </>;
}
