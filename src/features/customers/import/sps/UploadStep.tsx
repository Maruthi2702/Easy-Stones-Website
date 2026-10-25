/** SPS import step 1: an unfinished draft to continue, the file, its check, and the history link. */
import type React from 'react';
import { Upload } from 'lucide-react';
import type { Loose } from '../../../../types/records';
import { n, when } from '../spsImport';
import type { SpsImport } from '../useSpsImport';

export default function UploadStep({ s, fileInput }: { s: SpsImport; fileInput: React.RefObject<HTMLInputElement | null> }) {
    const { resume, run, busy, fileCheck } = s;
    return (
        <>
            {resume?.draft && !run && (
                <div className="spsc-banner info">
                    <span>↺</span>
                    <span><b>You have an import in progress</b>
                        {resume.draft.fileName} · started {when(resume.draft.createdAt)} · {n(resume.draft.answered)} answers saved.{' '}
                        <button type="button" className="spsi-link" onClick={s.continueDraft} disabled={busy}>Continue it</button>{' '}
                        <button type="button" className="spsi-link danger" onClick={s.startOver}>Start over</button>
                    </span>
                </div>
            )}
            <button type="button" className="spsc-drop" onClick={() => fileInput.current?.click()} disabled={busy}>
                <Upload size={20} aria-hidden="true" />
                <b>{busy ? 'Reading the file…' : run ? run.fileName : 'Choose the SPS customer export'}</b>
                <span>.xls or .xlsx, exactly as downloaded from SPS</span>
            </button>
            <input ref={fileInput} type="file" accept=".xls,.xlsx" hidden onChange={(e) => { s.upload(e.target.files?.[0]); e.target.value = ''; }} />
            {fileCheck && (
                <div className="spsi-checks">
                    <div className="sect-title">File check</div>
                    <div className="spsi-check"><span className={`spsi-dot ${fileCheck.ok ? 'ok' : 'bad'}`}>{fileCheck.ok ? '✓' : '!'}</span><span><b>{n(fileCheck.rowsRead)}</b> customers read{fileCheck.ok ? ', every row accounted for' : ''}</span></div>
                    {fileCheck.blocking.map((b: Loose) => <div key={b.code} className="spsc-banner bad"><span><b>{b.message}</b>{b.rows?.length ? <> Rows: {b.rows.join(', ')}.</> : null} Nothing has been imported.</span></div>)}
                    {fileCheck.ok && fileCheck.warnings.length === 0 && (
                        <>
                            <div className="spsi-check"><span className="spsi-dot ok">✓</span><span>Every row has a customer name</span></div>
                            <div className="spsi-check"><span className="spsi-dot ok">✓</span><span>No customer name appears twice</span></div>
                        </>
                    )}
                    {fileCheck.warnings.map((w: Loose) => <div key={w.code} className="spsi-check"><span className="spsi-dot warn">!</span><span>{w.message}{w.rows?.length ? ` Rows: ${w.rows.slice(0, 12).join(', ')}${w.rows.length > 12 ? '…' : ''}.` : ''}</span></div>)}
                </div>
            )}
            <button type="button" className="spsi-link" onClick={s.openHistory}>Import history</button>
        </>
    );
}
