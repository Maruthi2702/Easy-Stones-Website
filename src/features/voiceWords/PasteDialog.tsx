import { useMemo, useState } from 'react';
import FormModal from '../../components/shared/form/FormModal';
import { FormField, FormPicker } from '../../components/shared/form/FormControls';
import type { VoiceWord, VoiceWordKind } from '../../utils/assistantContract';
import { VoiceWordsError } from './voiceWordsApi';
import { KIND_OPTIONS, PASTE_STATUS_LABEL, parsePastedList, pasteSummary } from './voiceWordsView';
import type { PasteRow } from './voiceWordsView';

/*
 * Paste a list (Words tab ⋯): one per line, `heard = meant` or just `meant`. Step 1 is the text, step 2 is a preview of what each line
 * will do (nothing is saved yet), step 3 says what happened. Rows go to the server one at a time, so a refused one (a word that is
 * already there) never loses the rest.
 */

export type PasteOutcome = { added: VoiceWord[]; skipped: number; failed: { row: PasteRow; message: string }[] };

export type PasteDialogProps = {
  existing: VoiceWord[];
  /** Saves one row; throws a VoiceWordsError (409 = already there). */
  onAddOne: (row: PasteRow) => Promise<VoiceWord>;
  onClose: () => void;
};

export default function PasteDialog({ existing, onAddOne, onClose }: PasteDialogProps) {
  const [step, setStep] = useState<'text' | 'preview' | 'done'>('text');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<VoiceWordKind>('other');
  const [tried, setTried] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<PasteOutcome | null>(null);

  const rows = useMemo(() => parsePastedList(text, existing, kind), [text, existing, kind]);
  const sum = pasteSummary(rows);
  const toAdd = rows.filter((r) => r.status === 'new');

  const run = async () => {
    const added: VoiceWord[] = []; const failed: PasteOutcome['failed'] = []; let skipped = sum.skip;
    for (let i = 0; i < toAdd.length; i += 1) {
      setProgress(i + 1);
      try { added.push(await onAddOne(toAdd[i])); } catch (error) {
        const e = error as VoiceWordsError;
        if (e.status === 409) skipped += 1; else failed.push({ row: toAdd[i], message: e.message || 'Could not save' });
      }
    }
    setProgress(null); setOutcome({ added, skipped, failed }); setStep('done');
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'text') { setTried(true); if (rows.length) setStep('preview'); return; }
    if (step === 'preview') { void run(); return; }
    onClose();
  };

  const submitLabel = step === 'text' ? 'Check the list' : step === 'preview' ? `Add ${sum.add} ${sum.add === 1 ? 'word' : 'words'}` : 'Done';
  return (
    <FormModal
      title="Paste a list"
      size="m"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={submitLabel}
      savingLabel={progress ? `Adding ${progress} of ${toAdd.length}…` : 'Adding…'}
      saving={progress !== null}
      submitDisabled={step === 'preview' && sum.add === 0}
      dirtyCount={step === 'done' ? 0 : text.trim() ? 1 : 0}
      footerStart={step === 'preview' ? <button type="button" className="vw-link" onClick={() => setStep('text')}>Back</button> : null}
      errors={{ text: tried && step === 'text' && !rows.length ? 'Paste at least one word' : '' }}
      showErrors={tried && step === 'text'}
      fieldLabels={{ text: 'List' }}
    >
      {step === 'text' && (
        <>
          <FormField name="text" id="vw-paste" label="List" required error={tried && !rows.length ? 'Paste at least one word' : ''}>
            <textarea id="vw-paste" className="fm-input no-capitalize vw-paste" rows={9} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={'cala cotta gold = Calacatta Gold\nsilestone = Silestone\nQuartzite'} aria-invalid={tried && !rows.length ? 'true' : undefined} />
          </FormField>
          <FormField name="kind" id="vw-paste-kind" label="Kind of every word">
            <FormPicker id="vw-paste-kind" value={kind} onChange={(v) => setKind(v as VoiceWordKind)} options={KIND_OPTIONS} sheetTitle="Kind" />
          </FormField>
          <p className="vw-fine">One per line: <code>heard = meant</code> or just the word. <code>=&gt;</code>, <code>-&gt;</code>, <code>→</code>, a tab or | work too.</p>
        </>
      )}
      {step === 'preview' && (
        <>
          <p className="vw-sum" role="status">
            <b>{sum.add}</b> to add{sum.skip ? <> · <b>{sum.skip}</b> already there or repeated</> : null}{sum.invalid ? <> · <b>{sum.invalid}</b> can’t be used</> : null}
          </p>
          <ul className="vw-prev" aria-label="Preview">
            {rows.map((r) => (
              <li key={r.line} className={`vw-prev-row is-${r.status}`}>
                <span className="vw-prev-text">
                  <b>{r.meant || '—'}</b>
                  <span>{r.heard ? `Heard as “${r.heard}”` : 'Plain word'}</span>
                </span>
                <span className="vw-prev-state" title={r.problem || undefined}>{PASTE_STATUS_LABEL[r.status]}{r.problem && r.status === 'invalid' ? ` — ${r.problem}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {step === 'done' && outcome && (
        <div role="status" className="vw-done">
          <p><b>{outcome.added.length}</b> {outcome.added.length === 1 ? 'word' : 'words'} added{outcome.skipped ? <>, <b>{outcome.skipped}</b> skipped because they were already there</> : null}.</p>
          {outcome.failed.length > 0 && (
            <>
              <p className="vw-error" role="alert">{outcome.failed.length} could not be saved:</p>
              <ul className="vw-prev">
                {outcome.failed.map((f) => <li key={f.row.line} className="vw-prev-row is-invalid"><span className="vw-prev-text"><b>{f.row.meant}</b></span><span className="vw-prev-state">{f.message}</span></li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </FormModal>
  );
}
