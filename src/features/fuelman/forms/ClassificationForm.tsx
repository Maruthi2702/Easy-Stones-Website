import { useState } from 'react';
import type { Category, ExpenseLine, ReportDetail } from '../../../fuelman/types';
import { CATEGORIES } from '../../../fuelman/types';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField, FormPicker } from '../../../components/shared/form/FormControls';
import { fuelApi } from '../api';
import { categoryLabels, money } from '../format';
export default function ClassificationForm({ report, lines, onClose, onSaved }: { report: ReportDetail; lines: ExpenseLine[]; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState<Category>(lines.length === 1 ? lines[0]!.category : 'other'), [note, setNote] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true); setError('');
    try { await fuelApi.command(report.id, 'classifications', { version: report.version, token: report.review.token, rows: lines.map(line => ({ index: line.index, category, note })) }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <FormModal title={lines.length === 1 ? 'Choose a category' : `Choose a category for ${lines.length} charges`} onClose={onClose} saving={saving} onSubmit={e => { e.preventDefault(); void save(); }} submitLabel={lines.length === 1 ? 'Save category' : `Save for ${lines.length} charges`} submitDisabled={!note.trim() || category === 'other'} dirtyCount={1}>
    {lines.length === 1 ? <><p>{lines[0]!.externalId} · {lines[0]!.date} · {money(lines[0]!.amountCents)} · PDF page {lines[0]!.page}</p><p>{lines[0]!.description}</p></>
      : <><p>{lines.length} charges totalling {money(lines.reduce((n, l) => n + l.amountCents, 0))} get the same category and note.</p>
        <ul className="fuel-bulk-list">{lines.slice(0, 8).map(l => <li key={l.index}>{l.date} · {l.externalId} · {money(l.amountCents)} — {l.description}</li>)}{lines.length > 8 && <li>…and {lines.length - 8} more</li>}</ul></>}
    {error && <p role="alert" className="fuel-error">{error}</p>}
    <FormField id="fuel-category" label="Expense category" required><FormPicker id="fuel-category" value={category} onChange={v => setCategory(v as Category)} options={CATEGORIES.filter(c => c !== 'other').map(value => ({ value, label: categoryLabels[value] }))} /></FormField>
    <FormField id="fuel-category-note" label="Why this category" required><textarea className="fm-input" id="fuel-category-note" required value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></FormField>
  </FormModal>;
}
