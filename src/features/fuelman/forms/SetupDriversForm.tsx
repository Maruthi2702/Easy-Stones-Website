import { useState } from 'react';
import type { FuelMetadata, ReportDetail } from '../../../fuelman/types';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormSearchPicker } from '../../../components/shared/form/FormControls';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import Pagination from '../../../components/shared/Pagination';
import { pageCount, usePagination } from '../../../components/shared/paginationConfig';
import { fuelApi } from '../api';
import { money } from '../format';
export default function SetupDriversForm({ report, metadata, onClose, onSaved }: {
  report: ReportDetail; metadata: FuelMetadata; onClose: () => void; onSaved: () => void;
}) {
  const candidates = report.review.drivers.filter(d => !d.driverKey).slice(0, 100);
  const [rows, setRows] = useState(() => candidates.map(d => ({ externalId: d.externalId, name: d.name, driverKey: '__new', location: '', from: d.suggestedFrom, totalCents: d.totalCents })));
  const [allLocation, setAllLocation] = useState(''), [note, setNote] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const pager = usePagination(), start = (pager.currentPage - 1) * pager.rowsPerPage;
  const options = [{ value: '__new', label: 'Create expense profile from report' }, ...metadata.drivers.map(d => ({ value: d.key, label: d.name, description: d.active ? d.locations.join(' / ') : 'Inactive · historical assignment' }))];
  const change = (id: string, field: 'driverKey' | 'location' | 'name', value: string) => setRows(old => old.map(r => r.externalId === id ? { ...r, [field]: value } : r));
  const complete = rows.filter(r => r.location && r.driverKey && r.name.trim()).length;
  async function save() {
    setSaving(true); setError('');
    try {
      await fuelApi.command(report.id, 'assignments/batch', { version: report.version, token: report.review.token, note,
        assignments: rows.map(r => ({ externalId: r.externalId, driverKey: r.driverKey === '__new' ? '' : r.driverKey, profileName: r.driverKey === '__new' ? r.name : '', profileKind: 'driver', from: r.from, allocations: [{ location: r.location, percent: '100' }] })) });
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <FormModal title="Assign driver locations" size="l" onClose={onClose} saving={saving} onSubmit={e => { e.preventDefault(); void save(); }}
    submitLabel={`Save ${rows.length} assignments`} submitDisabled={!rows.length || complete !== rows.length || !note.trim()} dirtyCount={rows.some(r => r.location) || note ? 1 : 0} footerNote={`${complete} of ${rows.length} ready`}>
    <p>Match each reported driver to a location once. Choose an existing system driver or confirm the name for a new expense profile. Future reports reuse these assignments.</p>
    <p className="fuel-muted">New expense profiles do not create logins. Assignments begin from the earliest required date in this report; use individual assignment editing for transfers or split costs.</p>
    {report.review.drivers.filter(d => !d.driverKey).length > 100 && <p>Showing the first 100 unassigned drivers. Save these to continue with the next group.</p>}
    {error && <p className="fuel-error" role="alert">{error}</p>}
    <div className="fuel-setup-apply"><FormField id="fuel-setup-all" label="Use one location for this group"><LocationPicker id="fuel-setup-all" value={allLocation} options={metadata.locations} noneLabel="Choose location" onChange={setAllLocation} /></FormField>
      <button className="fuel-form-action" type="button" disabled={!allLocation} onClick={() => setRows(old => old.map(r => ({ ...r, location: allLocation })))}>Apply to all {rows.length} drivers</button></div>
    {rows.slice(start, start + pager.rowsPerPage).map((r, i) => <div className="fuel-setup-row" key={r.externalId}>
      <div className="fuel-setup-person"><strong>{r.externalId}</strong><span>{money(r.totalCents)}</span>{r.driverKey === '__new' ? <FormField id={`fuel-setup-name-${i}`} label="Driver name" required><input className="fm-input" id={`fuel-setup-name-${i}`} value={r.name} maxLength={150} required onChange={e => change(r.externalId, 'name', e.target.value)} /></FormField> : <small>{r.name}</small>}</div>
      <FormField id={`fuel-setup-driver-${i}`} label="System driver / expense profile" required><FormSearchPicker id={`fuel-setup-driver-${i}`} value={r.driverKey} options={options} onChange={v => change(r.externalId, 'driverKey', v)} /></FormField>
      <FormField id={`fuel-setup-location-${i}`} label="Cost location" required><LocationPicker id={`fuel-setup-location-${i}`} value={r.location} options={metadata.locations} noneLabel="Choose location" onChange={v => change(r.externalId, 'location', v)} /></FormField>
    </div>)}
    <Pagination {...pager} totalPages={pageCount(rows.length, pager.rowsPerPage)} totalCount={rows.length} onPageChange={pager.setCurrentPage} onRowsPerPageChange={pager.setRowsPerPage} />
    <FormField id="fuel-setup-note" label="Assignment note" required><textarea className="fm-input" id="fuel-setup-note" value={note} maxLength={500} required onChange={e => setNote(e.target.value)} /></FormField>
  </FormModal>;
}
