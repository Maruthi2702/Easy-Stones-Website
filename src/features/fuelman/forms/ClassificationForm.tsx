import { useState } from 'react';
import type { Category, ExpenseLine, ReportDetail } from '../../../fuelman/types';
import { CATEGORIES } from '../../../fuelman/types';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormPicker } from '../../../components/shared/form/FormControls';
import { fuelApi } from '../api';
import { categoryLabels, money } from '../format';
export default function ClassificationForm({ report, line, onClose, onSaved }: { report: ReportDetail; line: ExpenseLine; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState<Category>(line.category), [note, setNote] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true); setError('');
    try { await fuelApi.command(report.id, 'classifications', { version: report.version, token: report.review.token, rows: [{ index: line.index, category, note }] }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <FormModal title="Classify expense" onClose={onClose} saving={saving} onSubmit={e => { e.preventDefault(); void save(); }} submitLabel="Save classification" submitDisabled={!note.trim() || category === 'other'} dirtyCount={1}>
    <p>{line.externalId} · {line.date} · {money(line.amountCents)} · PDF page {line.page}</p><p>{line.description}</p>
    {error && <p role="alert" className="fuel-error">{error}</p>}
    <FormField id="fuel-category" label="Expense category" required><FormPicker id="fuel-category" value={category} onChange={v => setCategory(v as Category)} options={CATEGORIES.filter(c => c !== 'other').map(value => ({ value, label: categoryLabels[value] }))} /></FormField>
    <FormField id="fuel-category-note" label="Classification note" required><textarea className="fm-input" id="fuel-category-note" required value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></FormField>
  </FormModal>;
}
