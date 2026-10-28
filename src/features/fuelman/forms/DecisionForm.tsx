import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField } from '../../../components/shared/form/FormControls';
import type { ReportDetail } from '../../../fuelman/types';
import { fuelApi } from '../api';
import { money } from '../format';
export type Decision = 'publish' | 'reverse' | 'close' | 'reopen';
export default function DecisionForm({ report, action, onClose, onSaved }: { report: ReportDetail; action: Decision; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState(''), [ack, setAck] = useState(false), [replace, setReplace] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const replacing = action === 'publish' && !!report.currentPublishedReportId && report.currentPublishedReportId !== report.id;
  const title = { publish: report.status === 'draft' ? 'Approve location expenses' : 'Restore published revision', reverse: 'Reverse location expenses', close: 'Close reporting period', reopen: 'Reopen reporting period' }[action];
  async function save() {
    setSaving(true); setError('');
    try {
      const data = action === 'publish' ? { version: report.version, token: report.review.token, note, acknowledgePriorDates: ack, ...(replacing ? { replaceReportId: report.currentPublishedReportId } : {}) }
        : action === 'reverse' ? { version: report.version, note } : { closed: action === 'close', note };
      await fuelApi.command(report.id, ['close', 'reopen'].includes(action) ? 'period' : action, data); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <FormModal title={title} size="m" onClose={onClose} saving={saving} onSubmit={e => { e.preventDefault(); void save(); }} submitLabel={title}
    submitDisabled={!note.trim() || (action === 'publish' && report.priorDateLineCount > 0 && !ack) || (replacing && !replace)} dirtyCount={note || ack || replace ? 1 : 0}>
    <p>{report.company} · {report.month} · {money(report.totalCents)}</p>
    {error && <p className="fuel-error" role="alert">{error}</p>}
    {action === 'publish' && <><p>Approving adds these expenses to each location's {report.month} totals. No payment is created.</p>
      <table className="fuel-approve-summary"><caption className="fuel-muted">What each location will carry</caption><thead><tr><th>Location</th><th>Amount</th></tr></thead>
        <tbody>{report.review.locations.map(l => <tr key={l.location}><td>{l.location}</td><td>{money(l.totalCents)}</td></tr>)}</tbody>
        <tfoot><tr><th>Total</th><td>{money(report.review.allocatedCents)}</td></tr></tfoot></table></>}
    {action === 'reverse' && <p>Remove this revision from location totals. The original report, allocations and history are retained.</p>}
    {replacing && <label className="fuel-check"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Replace published revision {report.currentPublishedRevision} ({money(report.currentPublishedTotalCents)}). The previous revision will remain in history.</label>}
    {action === 'publish' && report.priorDateLineCount > 0 && <label className="fuel-check"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I reviewed the {report.priorDateLineCount} transactions dated before this statement. Include them in {report.month}, using their transaction dates for branch assignment.</label>}
    {action === 'close' && <p>Prevent publication, replacement or reversal for this account's {report.month} period until it is reopened.</p>}
    <FormField id="fuel-decision-note" label="Decision note" required><textarea className="fm-input" id="fuel-decision-note" required value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></FormField>
  </FormModal>;
}
