import { useState } from 'react';
import type { MissingIdentity, MissingReason, ReportDetail } from '../../../fuelman/types';
import { REASONS } from '../../../fuelman/types';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormPicker } from '../../../components/shared/form/FormControls';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { fuelApi } from '../api';
import { reasonLabels } from '../format';
export default function MissingForm({ report, missing, onClose, onSaved }: { report: ReportDetail; missing: MissingIdentity; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState<MissingReason | ''>(missing.reason), [note, setNote] = useState(missing.note), [effectiveDate, setDate] = useState(report.start), [replacementId, setReplacement] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  async function save() {
    setSaving(true); setError('');
    try { await fuelApi.command(report.id, 'missing', { version: report.version, token: report.review.token, externalId: missing.externalId, reason, note,
      ...(['retired', 'identifier_changed'].includes(reason) ? { effectiveDate } : {}), ...(reason === 'identifier_changed' ? { replacementId } : {}) }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <FormModal title={`Review missing driver · ${missing.externalId}`} size="m" saving={saving} onClose={onClose} onSubmit={e => { e.preventDefault(); void save(); }} submitLabel="Save reason" submitDisabled={!reason || !note.trim()} dirtyCount={1}>
    <p>{missing.driverName} has no expense lines in {report.month}. This does not change website access or copy a previous month's cost.</p>
    {error && <p className="fuel-error" role="alert">{error}</p>}
    <FormField id="fuel-missing-reason" label="What happened?" required><FormPicker id="fuel-missing-reason" value={reason} onChange={v => setReason(v as MissingReason)} options={REASONS.map(value => ({ value, label: reasonLabels[value] }))} /></FormField>
    {['retired', 'identifier_changed'].includes(reason) && <FormField id="fuel-missing-effective" label="Effective date" required><DatePicker id="fuel-missing-effective" value={effectiveDate} onChange={setDate} max={report.end} ariaLabel="Missing identity effective date" /></FormField>}
    {reason === 'identifier_changed' && <FormField id="fuel-replacement" label="Replacement identity in this report" required><FormPicker id="fuel-replacement" value={replacementId} onChange={setReplacement}
      options={report.review.drivers.map(d => ({ value: d.externalId, label: `${d.externalId} · ${d.driverName || d.name}` }))} /></FormField>}
    {reason === 'identifier_changed' && <p className="fuel-muted">Assign the replacement identity to the same system driver before saving this reason.</p>}
    {['incomplete', 'investigating'].includes(reason) && <p className="fuel-muted">The report will remain pending until this issue is resolved.</p>}
    <FormField id="fuel-missing-note" label="Reason details" required><textarea className="fm-input" id="fuel-missing-note" value={note} required maxLength={500} onChange={e => setNote(e.target.value)} /></FormField>
  </FormModal>;
}
