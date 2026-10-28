import { useState } from 'react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormField } from '../../../components/shared/form/FormControls';
import { fuelApi } from '../api';
export default function UploadForm({ onClose, onSaved, initialFiles = [] }: { onClose: () => void; onSaved: (id: string) => void; initialFiles?: File[] }) {
  const [files, setFiles] = useState<File[]>(initialFiles), [saving, setSaving] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const [results, setResults] = useState<{ file: File; filename: string; id: string; month: string; duplicate: boolean }[]>([]);
  async function submit() {
    setSaving(true); setError('');
    const completed = [...results];
    try {
      for (const file of files) {
        if (completed.some(r => r.file === file)) continue;
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: choose a PDF no larger than 10 MB`);
        setProgress(`Reading ${file.name}…`);
        const response = await fuelApi.upload(file); completed.push({ file, filename: file.name, ...response }); setResults([...completed]);
      }
      const first = completed.sort((a, b) => a.month.localeCompare(b.month))[0];
      if (first) onSaved(first.id);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); setProgress(''); }
  }
  return <FormModal title="Upload Fuelman reports" size="m" onClose={onClose} onSubmit={e => { e.preventDefault(); void submit(); }} saving={saving}
    submitLabel="Read reports" savingLabel="Reading reports…" submitDisabled={!files.length} dirtyCount={files.length && !results.length ? 1 : 0}>
    <p>Upload the original Employee Management PDF. Dates, drivers and expenses are read from the report; nothing reaches location totals until approved.</p>
    {error && <p className="fuel-error" role="alert">{error}</p>}
    <FormField id="fuel-files" label="Monthly PDF reports" required>
      <input className="fm-input" id="fuel-files" type="file" multiple accept="application/pdf,.pdf" onChange={e => { setFiles([...e.target.files || []]); setResults([]); setError(''); }} />
    </FormField>
    <p className="fuel-muted">Select several months together. Review starts with the earliest month so assignments carry forward.</p>
    {progress && <p role="status">{progress}</p>}
    {!!results.length && <ul>{results.map((r, i) => <li key={`${r.id}:${i}`}>{r.filename}: {r.duplicate ? 'Already imported' : 'Saved for review'}</li>)}</ul>}
    {error && !!results.length && <button className="fuel-form-action" type="button" onClick={() => onSaved(results[0]!.id)}>Review reports already saved</button>}
  </FormModal>;
}
