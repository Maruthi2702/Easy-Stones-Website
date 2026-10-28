import type { ReportListItem } from '../../../fuelman/types';
import { money, statusLabels } from '../format';
export default function ReportList({ reports, onOpen }: { reports: ReportListItem[]; onOpen: (id: string) => void }) {
  return <div className="fuel-table-wrap"><table className="fuel-table"><thead><tr><th>Statement</th><th>Status</th><th>Drivers / IDs</th><th>Expense lines</th><th>Total expenses</th><th>Imported</th></tr></thead>
    <tbody>{reports.map(report => <tr key={report.id}>
      <td data-label="Statement"><button className="fuel-link" onClick={() => onOpen(report.id)}>{report.month} · Revision {report.revision}</button><small>{report.company}</small><small>{report.filename}</small></td>
      <td data-label="Status"><span className={`fuel-status ${report.status}`}>{report.status === 'draft' ? 'Unpublished' : statusLabels[report.status]}</span></td>
      <td data-label="Drivers / IDs">{report.employeeCount}</td><td data-label="Expense lines">{report.lineCount}</td>
      <td data-label="Total expenses"><strong>{money(report.totalCents)}</strong></td>
      <td data-label="Imported">{new Date(report.importedAt).toLocaleDateString()}<small>{report.importedBy}</small></td>
    </tr>)}</tbody></table></div>;
}
