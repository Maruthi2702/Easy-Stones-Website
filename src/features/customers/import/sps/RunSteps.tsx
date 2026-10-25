/** SPS import steps 4 and 5: the import running on the server, then its results and the check that every SPS customer is here. */
import { Download } from 'lucide-react';
import type { Loose } from '../../../../types/records';
import { ResultTiles, RunItems } from '../RunResults';
import { n, when } from '../spsImport';
import type { SpsImport } from '../useSpsImport';

export function ImportingStep({ progress }: { progress: Loose | null }) {
    return (
        <>
            <div><b>Importing… <span className="spsi-num">{n(progress?.done)}</span> of <span className="spsi-num">{n(progress?.total)}</span></b></div>
            <div className="spsc-bar"><span className="s-auto" style={{ width: `${progress?.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
            <div className="spsi-counts">
                <div><b>{n(progress?.results?.added)}</b><span>added</span></div>
                <div><b>{n(progress?.results?.updated)}</b><span>updated</span></div>
                <div><b>{n(progress?.results?.unchanged)}</b><span>no changes</span></div>
            </div>
            <div className="spsc-banner info"><span>i</span><span>You can close this window. The import keeps running on the server and you’ll find it under <b>Import history</b>.</span></div>
        </>
    );
}

export function ResultsStep({ s, canDelete, onClose }: { s: SpsImport; canDelete: boolean; onClose?: () => void }) {
    const progress = s.progress!;
    const { busy, viewResult, setViewResult } = s;
    return (
        <>
            {progress.status === 'failed' && <div className="spsc-banner bad" role="alert"><span><b>The import stopped</b>{progress.error}. What was already written stays; running it again carries on.</span></div>}
            {progress.verify && (
                <div className={`spsi-verify ${progress.verify.ok ? 'ok' : 'bad'}`}>
                    <h5>{progress.verify.ok ? '✓ Every SPS customer is accounted for' : `Problem: ${n(progress.verify.missingCount)} SPS customer${progress.verify.missingCount === 1 ? ' is' : 's are'} missing`}</h5>
                    <span className="spsc-muted"><b>{n(progress.verify.present)}</b> of {n(progress.verify.expected)} are in Easy Stones{progress.verify.keptDeleted > 0 && <> and <b>{n(progress.verify.keptDeleted)}</b> stayed deleted as you chose</>}. Each name in the file was looked up after the import. {when(progress.finishedAt)} · by {progress.createdBy}</span>
                    {!progress.verify.ok && (
                        <>
                            <ul className="spsi-missing">{progress.verify.missing.slice(0, 20).map((m: Loose) => <li key={m.key}><b>{m.name}</b> (row {m.rowNumber}): {m.reason}</li>)}</ul>
                            <button type="button" className="spsi-btn" onClick={s.retry} disabled={busy}>Try these again</button>
                        </>
                    )}
                </div>
            )}
            <ResultTiles counts={progress.results} selected={viewResult} onSelect={setViewResult} />
            {!viewResult && <div className="spsc-muted">Select a number to see those customers — and what changed on each.</div>}
            {viewResult && <RunItems runId={progress.id} result={viewResult} />}
            <div className="spsi-btnrow">
                <button type="button" className="spsi-btn" onClick={() => s.report(progress)}><Download size={14} aria-hidden="true" /> Download report</button>
                <button type="button" className="spsi-btn" onClick={s.openHistory}>Import history</button>
                {canDelete && progress.status === 'done' && <button type="button" className="spsi-btn danger" disabled={busy} onClick={() => s.undo(progress)}>Undo this import</button>}
                <span className="spsi-grow" />
                <button type="button" className="spsi-btn gold" onClick={onClose}>Done</button>
            </div>
        </>
    );
}
