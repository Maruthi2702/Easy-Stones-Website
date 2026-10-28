import { useState } from 'react';
import type { FuelMetadata, ReportDetail, ReviewDriver } from '../../../fuelman/types';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormRow, FormSearchPicker } from '../../../components/shared/form/FormControls';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import { fuelApi } from '../api';
import { driverChoices, suggestedLocation, userDrivers } from '../driverChoices';
export default function AssignmentForm({ report, driver, metadata, onClose, onSaved }: {
  report: ReportDetail; driver: ReviewDriver; metadata: FuelMetadata; onClose: () => void; onSaved: () => void;
}) {
  const drivers = userDrivers(metadata);
  const [key, setKey] = useState(drivers.some(d => d.key === driver.driverKey) ? driver.driverKey : '');
  const current = driver.assignments.filter(a => a.from <= report.end && (!a.to || a.to > report.start)).at(-1);
  const earliest = report.start < driver.suggestedFrom ? report.start : driver.suggestedFrom;
  const [from, setFrom] = useState(current && current.from > earliest ? current.from : earliest);
  const [allocations, setAllocations] = useState(() => current?.allocations.map(a => ({ location: a.location, percent: String(a.basisPoints / 100) })) || [{ location: '', percent: '100' }]);
  const [note, setNote] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true); setError('');
    try { await fuelApi.command(report.id, 'assignments', { version: report.version, token: report.review.token, externalId: driver.externalId,
      driverKey: key, from, allocations, note }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <FormModal title={`Assign ${driver.externalId}`} size="m" onClose={onClose} saving={saving} onSubmit={e => { e.preventDefault(); void save(); }} submitLabel="Save assignment" submitDisabled={!key || !from} dirtyCount={1}>
    <p>{driver.name} · {report.month}. This assignment is remembered for future reports. Published history stays unchanged.</p>
    {error && <p className="fuel-error" role="alert">{error}</p>}
    {!driver.driverKey && !!driver.suggestions?.length && <div className="fuel-notice"><p>Possible match from an earlier report. Confirm the identity before using it.</p>
      {driver.suggestions.filter(s => drivers.some(d => d.key === s.driverKey)).map(s => <button className="fuel-form-action" type="button" key={s.driverKey} onClick={() => setKey(s.driverKey)}>Use {s.driverName} · previously {s.externalId}</button>)}
    </div>}
    {!drivers.length && <p className="fuel-notice">No users with a Driver profile are available in this database. Add or update the driver in Users &amp; Roles, then refresh Fuel Man.</p>}
    <FormField id="fuel-driver" label="Driver from Users & Roles" required><FormSearchPicker id="fuel-driver" value={key} placeholder="Choose a driver" options={driverChoices(drivers)} onChange={value => {
      setKey(value);
      const location = suggestedLocation(drivers.find(d => d.key === value), metadata.locations);
      if (location) setAllocations(old => old.length === 1 && !old[0]!.location ? [{ location, percent: '100' }] : old);
    }} /></FormField>
    {!!driver.assignments.length && <details className="fuel-source-notes"><summary>Saved assignment dates</summary><ul>{driver.assignments.map(a => <li key={a.id}>{a.from} – {a.to || 'ongoing'} · {a.driverName} · {a.allocations.map(v => `${v.location} ${v.basisPoints / 100}%`).join(' / ')}</li>)}</ul></details>}
    <FormField id="fuel-from" label="Effective from" required><DatePicker id="fuel-from" value={from} onChange={setFrom} max={report.end} ariaLabel="Assignment effective from" /></FormField>
    {allocations.map((a, index) => <FormRow key={index}><FormField id={`fuel-location-${index}`} label="Cost location" required><LocationPicker id={`fuel-location-${index}`} value={a.location} options={metadata.locations} allLabel={null} noneLabel="Choose location" onChange={location => setAllocations(old => old.map((v, i) => i === index ? { ...v, location } : v))} /></FormField>
      <FormField id={`fuel-share-${index}`} label="Share (%)" required><div className="fuel-allocation-share"><input className="fm-input" id={`fuel-share-${index}`} value={a.percent} required inputMode="decimal" onChange={e => setAllocations(old => old.map((v, i) => i === index ? { ...v, percent: e.target.value } : v))} />
        {allocations.length > 1 && <button className="fuel-form-action" type="button" aria-label={`Remove location ${index + 1}`} onClick={() => setAllocations(old => old.filter((_, i) => i !== index))}>Remove</button>}</div></FormField></FormRow>)}
    <button className="fuel-form-action" type="button" onClick={() => setAllocations(old => [...old, { location: '', percent: '' }])}>Add another cost location</button>
    <FormField id="fuel-assignment-note" label="Assignment note"><textarea className="fm-input" id="fuel-assignment-note" value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></FormField>
  </FormModal>;
}
