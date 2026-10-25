/**
 * The SPS import history: every import, who ran it, whether every customer
 * was accounted for, its customers, the report, and Undo (with Delete).
 */
import FormModal from '../../../components/shared/form/FormModal';
import { ResultTiles, RunItems } from './RunResults';
import { n, when } from './spsImport';
import type { SpsImport } from './useSpsImport';

export default function SpsImportHistory({ s, canDelete, onClose }: { s: SpsImport; canDelete: boolean; onClose?: () => void }) {
    const { history, error, busy, openRun, setOpenRun, report, undo } = s;
    return (
        <FormModal title="SPS import history" size="l" onClose={onClose} onSubmit={() => s.setView('wizard')} submitLabel="Back to import" footerNote="Every import, who ran it and whether every customer was accounted for.">
            <div className="spsc">
                {error && <div className="spsc-banner bad" role="alert">{error}</div>}
                {history.length === 0 && <div className="spsc-muted">No SPS imports yet.</div>}
                {history.map((r) => (
                    <div key={r.id} className="spsc-card spsi-hist">
                        <div><b>{r.fileName}</b> <span className="spsc-muted">· {when(r.createdAt)} · {r.createdBy}</span></div>
                        <div className="spsc-muted">
                            {r.status === 'undone' ? `Undone ${when(r.undoneAt)} by ${r.undoneBy}`
                                : `${n(r.results.added)} added · ${n(r.results.updated)} updated · ${n(r.results.restored)} brought back · ${n(r.results.unchanged)} no changes${r.results.failed ? ` · ${n(r.results.failed)} failed` : ''}`}
                        </div>
                        <div className="spsi-hist-row">
                            {r.status === 'running' && <span className="spsi-pill warn">Running {n(r.done)} of {n(r.total)}</span>}
                            {r.status === 'failed' && <span className="spsi-pill bad">Stopped: {r.error}</span>}
                            {r.status === 'undone' && <span className="spsi-pill">Undone</span>}
                            {r.status === 'done' && r.verify && (r.verify.ok
                                ? <span className="spsi-pill ok">✓ All {n(r.verify.expected)} accounted for</span>
                                : <span className="spsi-pill bad">{n(r.verify.missingCount)} missing</span>)}
                            <span className="spsi-grow" />
                            {r.status !== 'undone' && r.total > 0 && (
                                <button type="button" className="spsi-link" onClick={() => setOpenRun(openRun?.id === r.id ? null : { id: r.id, result: r.results.added ? 'added' : 'updated' })}>
                                    {openRun?.id === r.id ? 'Hide customers' : 'See customers'}
                                </button>
                            )}
                            <button type="button" className="spsi-link" onClick={() => report(r)}>Download report</button>
                            {canDelete && r.status === 'done' && <button type="button" className="spsi-link danger" disabled={busy} onClick={() => undo(r)}>Undo</button>}
                        </div>
                        {openRun?.id === r.id && (
                            <>
                                <ResultTiles counts={r.results} selected={openRun!.result} onSelect={(v) => setOpenRun({ id: r.id, result: v })} />
                                <RunItems runId={r.id} result={openRun!.result} />
                            </>
                        )}
                    </div>
                ))}
            </div>
        </FormModal>
    );
}
