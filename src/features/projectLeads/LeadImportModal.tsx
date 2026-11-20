import { useRef, useState } from 'react';
import { Upload, CheckCircle2 } from 'lucide-react';
import FormModal from '../../components/shared/form/FormModal';
import { importLeadsFile, type ImportResult } from '../../api/projectLeads';

/**
 * Project Leads ⋯ → Import ConstructConnect file. The server reads the export (the "Design Team" sheet,
 * plus "Custom" when it's there — src/utils/projectLeadsWorkbook.ts), adds the new projects and
 * refreshes the ones it already has. Status, who has a lead and notes are never changed by an import.
 */
export default function LeadImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<ImportResult | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (done) { onClose(); return; }
    if (!file) { setError('Choose the ConstructConnect Excel file first.'); return; }
    setBusy(true);
    setError('');
    try {
      setDone(await importLeadsFile(file));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormModal title="Import ConstructConnect file" size="s" onClose={onClose} onSubmit={submit}
      submitLabel={done ? 'Close' : 'Import'} savingLabel="Importing…" saving={busy} dirtyCount={file && !done ? 1 : 0}
      submitDisabled={!done && !file}>
      {done ? (
        <div className="prj-import-done" role="status">
          <CheckCircle2 size={22} aria-hidden="true" />
          <div>
            <strong>{done.projects.toLocaleString()} projects imported</strong>
            <p>{done.added.toLocaleString()} new, {done.updated.toLocaleString()} refreshed, {done.companies.toLocaleString()} companies.
              {done.skippedRows ? ` ${done.skippedRows} rows had no project id and were skipped.` : ''}</p>
          </div>
        </div>
      ) : (
        <div className="prj-import">
          <p>Upload the export from ConstructConnect (.xlsx). New projects are added and ones already here are refreshed.
            Statuses, who has a lead and notes are never changed.</p>
          <input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(''); }} />
          <button type="button" className="prj-drop" onClick={() => input.current?.click()} disabled={busy}>
            <Upload size={20} aria-hidden="true" />
            {file ? <span><strong>{file.name}</strong><br /><span className="prj-muted">{(file.size / 1024 / 1024).toFixed(1)} MB — click to choose another</span></span> : <span>Choose the Excel file</span>}
          </button>
          {error ? <div className="prj-error" role="alert">{error}</div> : null}
        </div>
      )}
    </FormModal>
  );
}
