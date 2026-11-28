/**
 * Multifamily Leads ⋯ → Import ConstructConnect file, in three steps like Import from SPS and Import Sales:
 * Upload and file check → Review → Results. The server reads the file (POST /import/preview writes nothing)
 * and says what it would add, refresh and drop; nothing is saved until Import. Statuses, who has a lead and
 * notes are never changed by an import, and the latest import can be undone (from Results, or ⋯ → Undo last
 * import). Rules: src/utils/projectLeads.ts, src/db/projectLeads/index.ts.
 */
import { useRef, useState } from 'react';
import { AlertTriangle, Upload } from 'lucide-react';
import FormModal from '../../components/shared/form/FormModal';
import {
  previewLeadsFile, importLeadsFile, undoLeadsImport, type ImportPreview, type ImportResult, type UndoResult, type LeadsMeta
} from '../../api/projectLeads';
import '../customers/import/SpsConnectModal.css';
import '../customers/import/SpsImportModal.css';

const STEPS = ['Upload', 'Review', 'Results'];
const n = (v: number) => v.toLocaleString('en-US');
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const show = (label: string, v: string) => (label === 'Value' && v ? `$${Number(v).toLocaleString('en-US')}` : v || '—');

type Last = NonNullable<LeadsMeta['lastImport']>;

export default function LeadImportModal({ onClose, onDone, undoOf = null }: { onClose: () => void; onDone: () => void; undoOf?: Last | null }) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [undone, setUndone] = useState<UndoResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const choose = async (f: File | undefined) => {
    setError(''); setPreview(null); setFile(null);
    if (!f) return;
    setBusy(true);
    try {
      setPreview(await previewLeadsFile(f));
      setFile(f);
    } catch (err) {
      setError((err as Error).message || 'That file couldn’t be read. Use the Excel file from ConstructConnect.');
    } finally { setBusy(false); }
  };

  const send = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      setDone(await importLeadsFile(file));
      onDone();
      setStep(3);
    } catch (err) {
      setError((err as Error).message || 'The import failed. Nothing was changed.');
    } finally { setBusy(false); }
  };

  const undo = async (importId: string) => {
    setBusy(true); setError('');
    try {
      setUndone(await undoLeadsImport(importId));
      onDone();
    } catch (err) {
      setError((err as Error).message || 'The undo failed. Nothing was changed.');
    } finally { setBusy(false); }
  };

  // ⋯ → Undo last import: one screen.
  if (undoOf) {
    return (
      <FormModal title="Undo last import" size="m" onClose={onClose} onSubmit={(e) => { e.preventDefault(); if (busy) return; if (undone) onClose(); else undo(undoOf.id); }}
        submitLabel={undone ? 'Done' : 'Undo import'} saving={busy} savingLabel="Undoing…" submitTone={undone ? 'primary' : 'danger'}>
        <div className="spsc">
          {error && <div className="spsc-banner bad" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {error}</div>}
          {undone ? (
            <>
              <div className="spsi-counts">
                <div><b>{n(undone.restored)}</b><span>projects put back</span></div>
                <div><b>{n(undone.removed)}</b><span>added projects removed</span></div>
                <div><b>{n(undone.kept)}</b><span>kept — already worked</span></div>
              </div>
              <div className="spsc-banner ok">✓ The import is undone.</div>
            </>
          ) : (
            <>
              <div className="spsc-banner info">
                Undo the import of <b>{undoOf.fileName || 'the file'}</b> from {day(undoOf.importedAt)} ({n(undoOf.added)} added, {n(undoOf.updated)} refreshed)?
                Projects it refreshed go back to how they were, with their contacts. Projects it added are removed — unless someone has already set a status, taken the lead or written a note, in which case they stay.
              </div>
              <div className="spsc-muted">Only the latest import can be undone, and only once.</div>
            </>
          )}
        </div>
      </FormModal>
    );
  }

  const matched = preview ? preview.refreshed + preview.unchanged : 0;
  const looksOld = !!preview && matched > 0 && preview.older / matched >= 0.5;
  const nothingToDo = !!preview && preview.added === 0 && preview.refreshed === 0;

  let label = 'Continue';
  let disabled = !preview;
  let run: () => void = () => setStep(2);
  if (step === 2) { label = preview ? `Import ${n(preview.projects)} projects` : 'Import'; disabled = nothingToDo; run = send; }
  if (step === 3) { label = 'Done'; disabled = false; run = onClose; }

  return (
    <FormModal
      title={step === 3 ? 'Multifamily leads imported' : 'Import ConstructConnect file'}
      size="l"
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); if (!disabled && !busy) run(); }}
      submitLabel={label}
      submitDisabled={disabled}
      saving={busy && step === 2}
      savingLabel="Importing…"
      dirtyCount={file && step < 3 ? 1 : 0}
      footerNote={step === 3 ? '' : 'Nothing is saved until you import.'}
    >
      <div className="spsc">
        <ol className="spsi-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
              {step > i + 1 ? '✓ ' : `${i + 1} `}{s}
            </li>
          ))}
        </ol>
        {error && <div className="spsc-banner bad" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {error}</div>}

        {step === 1 && (
          <>
            <button type="button" className="spsc-drop" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Upload size={20} aria-hidden="true" />
              <b>{busy ? 'Reading the file…' : file ? file.name : 'Choose the ConstructConnect export'}</b>
              <span>The Excel file with a “Design Team” sheet (and “Custom”, if it has one) · .xlsx, up to 25 MB</span>
            </button>
            <input ref={fileInput} type="file" accept=".xlsx,.xls" hidden aria-label="ConstructConnect file" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
            {preview && (
              <div className="spsi-checks">
                <div className="sect-title">File check</div>
                <div className="spsi-check"><span className="spsi-dot ok">✓</span><span><b>{n(preview.projects)}</b> projects with <b>{n(preview.companies)}</b> companies read</span></div>
                <div className="spsi-check"><span className="spsi-dot ok">✓</span><span>The columns of the ConstructConnect export are all there</span></div>
                {preview.skippedRows > 0 && (
                  <div className="spsi-check"><span className="spsi-dot warn">!</span><span>{n(preview.skippedRows)} rows had no project id and will be skipped</span></div>
                )}
                {looksOld && (
                  <div className="spsi-check"><span className="spsi-dot warn">!</span>
                    <span>This file looks <b>older</b> than what’s here: {n(preview.older)} of the {n(matched)} projects already imported have an earlier update date in this file. Importing would put older details over newer ones.</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {step === 2 && preview && (
          <>
            <div className="spsc-tally">
              <div className="spsc-eq">
                <b>{n(preview.projects)}</b> projects in the file = <b>{n(preview.added)}</b> new + <b>{n(preview.refreshed)}</b> changed + <b>{n(preview.unchanged)}</b> already the same
              </div>
              <div className="spsc-bar" aria-hidden="true">
                <span className="s-new" style={{ width: `${(preview.added / Math.max(1, preview.projects)) * 100}%` }} />
                <span className="s-auto" style={{ width: `${(preview.refreshed / Math.max(1, preview.projects)) * 100}%` }} />
                <span className="s-connected" style={{ width: `${(preview.unchanged / Math.max(1, preview.projects)) * 100}%` }} />
              </div>
            </div>
            {looksOld && <div className="spsc-banner bad" role="alert"><AlertTriangle size={14} aria-hidden="true" /> This file looks older than what’s here ({n(preview.older)} projects would go back to an earlier update date). Check you chose the right file.</div>}
            {nothingToDo
              ? <div className="spsc-banner info">Everything in this file is already here exactly as it is. There is nothing to import.</div>
              : <div className="spsc-banner ok">Statuses, who has a lead and notes are never changed. You can undo this import until the next one.</div>}
            <div className="spsi-counts">
              <div><b>{n(preview.contactsAdded)}</b><span>contacts added</span></div>
              <div><b>{n(preview.contactsRemoved)}</b><span>contacts no longer listed</span></div>
              <div><b>{n(preview.notInFile)}</b><span>here but not in this file — left as they are</span></div>
            </div>
            {preview.samples.length > 0 && (
              <div>
                <div className="sect-title">Some of the changes</div>
                <div className="spsi-rows">
                  {preview.samples.map((s) => (
                    <div key={s.id} className="spsi-row">
                      <span className="spsi-pill upd">Changed</span>
                      <span className="spsi-row-main">
                        <b>{s.title}</b>
                        {s.changes.length
                          ? s.changes.map((c) => <span key={c.label} className="spsi-chg">{c.label}: <s>{show(c.label, c.from)}</s> → {show(c.label, c.to)}</span>)
                          : <span className="spsi-chg">Contacts changed</span>}
                      </span>
                    </div>
                  ))}
                </div>
                {preview.refreshed > preview.samples.length && <div className="spsc-muted">…and {n(preview.refreshed - preview.samples.length)} more.</div>}
              </div>
            )}
          </>
        )}

        {step === 3 && done && (
          <>
            <div className="spsi-counts">
              <div><b>{n(done.projects)}</b><span>projects in the file</span></div>
              <div><b>{n(done.added)}</b><span>added</span></div>
              <div><b>{n(done.updated)}</b><span>refreshed</span></div>
              <div><b>{n(done.companies)}</b><span>companies</span></div>
            </div>
            {undone ? (
              <div className="spsc-banner ok">✓ Undone: {n(undone.restored)} put back, {n(undone.removed)} removed{undone.kept ? `, ${n(undone.kept)} kept because they were already worked` : ''}.</div>
            ) : (
              <div className="spsc-banner ok">
                ✓ The projects are in the list.{' '}
                <button type="button" className="spsi-link danger" onClick={() => undo(done.importId)} disabled={busy}>{busy ? 'Undoing…' : 'Undo this import'}</button>
              </div>
            )}
          </>
        )}
      </div>
    </FormModal>
  );
}
