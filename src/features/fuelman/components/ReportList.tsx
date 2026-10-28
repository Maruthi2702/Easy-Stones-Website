import type { ReportListItem } from '../../../fuelman/types';
import { money, monthName, statusLabels } from '../format';
export default function ReportList({ reports, onOpen }: { reports: ReportListItem[]; onOpen: (id: string) => void }) {
  // Earlier months are reviewed first so each month's driver matches carry into the next.
  const firstOpen = reports.filter(r => r.status === 'draft').map(r => r.month).sort()[0];
  return <div className="fuel-table-wrap"><table className="fuel-table"><thead><tr><th>Month</th><th>Status</th><th>Charges</th><th>Total</th><th><span className="fuel-sr-only">Open</span></th></tr></thead>
    <tbody>{reports.map(report => {
      const later = report.status === 'draft' && !!firstOpen && report.month > firstOpen;
      return <tr key={report.id}>
        <td data-label="Month"><button className="fuel-link" onClick={() => onOpen(report.id)}>{monthName(report.month)}{report.revision > 1 ? ` · Revision ${report.revision}` : ''}</button><small>Uploaded {new Date(report.importedAt).toLocaleDateString()} by {report.importedBy}</small></td>
        <td data-label="Status"><span className={`fuel-status ${report.status}`}>{statusLabels[report.status]}</span>{later && <small>Review {monthName(firstOpen!)} first</small>}</td>
        <td data-label="Charges">{report.lineCount}</td>
        <td data-label="Total"><strong>{money(report.totalCents)}</strong></td>
        <td data-label=""><button className="fuel-small" onClick={() => onOpen(report.id)}>{report.status === 'draft' ? 'Continue' : 'Open'}</button></td>
      </tr>;
    })}</tbody></table></div>;
}
