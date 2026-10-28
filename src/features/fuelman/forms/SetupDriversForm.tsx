import { useState } from 'react';
import type { FuelMetadata, ReportDetail } from '../../../fuelman/types';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormSearchPicker } from '../../../components/shared/form/FormControls';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import Pagination from '../../../components/shared/Pagination';
import { pageCount, usePagination } from '../../../components/shared/paginationConfig';
import { fuelApi } from '../api';
import { money } from '../format';
import { driverChoices, suggestedLocation, userDrivers } from '../driverChoices';
export default function SetupDriversForm({ report, metadata, onClose, onSaved }: {
  report: ReportDetail; metadata: FuelMetadata; onClose: () => void; onSaved: () => void;
}) {
  const candidates = report.review.drivers.filter(d => !d.driverKey).slice(0, 100);
  const [rows, setRows] = useState(() => candidates.map(d => ({ externalId: d.externalId, name: d.name, driverKey: '', location: '', from: d.suggestedFrom, totalCents: d.totalCents })));
  const [allLocation, setAllLocation] = useState(''), [note, setNote] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const pager = usePagination(), start = (pager.currentPage - 1) * pager.rowsPerPage;
  const drivers = userDrivers(metadata), options = driverChoices(drivers);
  const changeDriver = (id: string, value: string) => {
    const location = suggestedLocation(drivers.find(d => d.key === value), metadata.locations);
    setRows(old => old.map(r => r.externalId === id ? { ...r, driverKey: value, location: r.location || location } : r));
  };
  const changeLocation = (id: string, location: string) => setRows(old => old.map(r => r.externalId === id ? { ...r, location } : r));
  const ready = rows.filter(r => r.location && r.driverKey), complete = ready.length;
  async function save() {
    setSaving(true); setError('');
    try {
      await fuelApi.command(report.id, 'assignments/batch', { version: report.version, token: report.review.token, note,
        assignments: ready.map(r => ({ externalId: r.externalId, driverKey: r.driverKey, from: r.from, allocations: [{ location: r.location, percent: '100' }] })) });
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <FormModal title="Assign driver locations" size="l" onClose={onClose} saving={saving} onSubmit={e => { e.preventDefault(); void save(); }}
    submitLabel={complete ? `Save ${complete} assignments` : 'Save assignments'} submitDisabled={!complete || !note.trim()} dirtyCount={rows.some(r => r.location || r.driverKey) || note ? 1 : 0} footerNote={`${complete} of ${rows.length} ready`}>
    <p>Match each reported driver to a user with a Driver profile in Users & Roles, then confirm the cost location. Future reports reuse these assignments. Only completed rows are saved; unmatched drivers stay pending.</p>
    <p className="fuel-muted">Assignments begin from the earliest required date in this report; use individual assignment editing for transfers or split costs.</p>
    {!drivers.length && <p className="fuel-notice">No users with a Driver profile are available in this database. Add or update the driver in Users &amp; Roles, then refresh Fuel Man.</p>}
    {report.review.drivers.filter(d => !d.driverKey).length > 100 && <p>Showing the first 100 unassigned drivers. Save these to continue with the next group.</p>}
    {error && <p className="fuel-error" role="alert">{error}</p>}
    <div className="fuel-setup-apply"><FormField id="fuel-setup-all" label="Use one location for this group"><LocationPicker id="fuel-setup-all" value={allLocation} options={metadata.locations} noneLabel="Choose location" onChange={setAllLocation} /></FormField>
      <button className="fuel-form-action" type="button" disabled={!allLocation} onClick={() => setRows(old => old.map(r => ({ ...r, location: allLocation })))}>Apply to all {rows.length} drivers</button></div>
    {rows.slice(start, start + pager.rowsPerPage).map((r, i) => <div className="fuel-setup-row" key={r.externalId}>
      <div className="fuel-setup-person"><strong>{r.name}</strong><small>{r.externalId}</small><span>{money(r.totalCents)}</span></div>
      <FormField id={`fuel-setup-driver-${i}`} label="Driver from Users & Roles" required><FormSearchPicker id={`fuel-setup-driver-${i}`} value={r.driverKey} options={options} placeholder="Choose a driver" onChange={v => changeDriver(r.externalId, v)} /></FormField>
      <FormField id={`fuel-setup-location-${i}`} label="Cost location" required><LocationPicker id={`fuel-setup-location-${i}`} value={r.location} options={metadata.locations} noneLabel="Choose location" onChange={v => changeLocation(r.externalId, v)} /></FormField>
    </div>)}
    <Pagination {...pager} totalPages={pageCount(rows.length, pager.rowsPerPage)} totalCount={rows.length} onPageChange={pager.setCurrentPage} onRowsPerPageChange={pager.setRowsPerPage} />
    <FormField id="fuel-setup-note" label="Assignment note" required><textarea className="fm-input" id="fuel-setup-note" value={note} maxLength={500} required onChange={e => setNote(e.target.value)} /></FormField>
  </FormModal>;
}
