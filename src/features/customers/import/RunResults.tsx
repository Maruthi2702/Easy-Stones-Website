/**
 * One SPS import's results: the numbers (each a button that shows the
 * customers behind it) and those customers, a page at a time. Step 5 and the
 * import history both show them.
 */
import { useEffect, useState } from 'react';
import Pagination from '../../../components/shared/Pagination';
import { usePagination, pageCount } from '../../../components/shared/paginationConfig';
import type { Loose } from '../../../types/records';
import { API, call } from './spsImportApi';
import { RESULT_TILES, fieldName, n, resultLabel, resultTone } from './spsImport';

// The result numbers, each one a button that shows the customers behind it.
export function ResultTiles({ counts = {}, selected, onSelect }: { counts?: Loose; selected: string; onSelect: (result: string) => void }) {
    return (
        <div className="spsi-counts">
            {RESULT_TILES.map(([k, label]) => {
                const c = Number(counts[k] || 0);
                return (
                    <button key={k} type="button" className={`spsi-tile${selected === k ? ' on' : ''}`} disabled={c === 0}
                        aria-pressed={selected === k} onClick={() => onSelect(selected === k ? '' : k)}>
                        <b>{n(c)}</b><span>{label}</span>
                    </button>
                );
            })}
        </div>
    );
}

// The customers of one run, a page at a time (the server pages them).
export function RunItems({ runId, result }: { runId: string; result: string }) {
    const pager = usePagination();
    const { currentPage, rowsPerPage, resetPage } = pager;
    const [data, setData] = useState<{ items: Loose[]; total: number }>({ items: [], total: 0 });
    const [state, setState] = useState('loading');
    useEffect(() => { resetPage(); }, [runId, result, resetPage]);
    useEffect(() => {
        let alive = true;
        setState('loading');
        call(`${API}/${runId}/items?result=${result}&page=${currentPage}&limit=${rowsPerPage}`)
            .then((r) => r.json())
            .then((d) => { if (alive) { setData(d); setState('ok'); } })
            .catch(() => { if (alive) setState('error'); });
        return () => { alive = false; };
    }, [runId, result, currentPage, rowsPerPage]);

    if (state === 'error') return <div className="spsc-banner bad">Couldn’t load the customers. Try again.</div>;
    return (
        <div className="spsi-items" aria-busy={state === 'loading'}>
            {state === 'ok' && data.items.length === 0 && <div className="spsc-muted">Nothing here.</div>}
            {data.items.map((i) => (
                <div key={`${i.rowNumber}-${i.name}`} className="spsi-row">
                    <span className={`spsi-pill ${resultTone(i.result)}`}>
                        {resultLabel(i)}
                    </span>
                    <span className="spsi-row-main">
                        <b>{i.name}</b>
                        {i.added && <span className="spsc-muted">{[i.added.city, i.added.branch, i.added.rep].filter(Boolean).join(' · ') || 'New customer'}</span>}
                        {i.changes.filter((c: Loose) => c.field !== 'sps').map((c: Loose, k: number) => <span key={k} className="spsi-chg">{fieldName(c.field)}: <s>{c.from || '—'}</s> → {c.to}</span>)}
                        {i.reason && <span className="spsi-warn">⚠ {i.reason}</span>}
                        {i.warnings.map((w: string, k: number) => <span key={k} className="spsi-warn">⚠ {w}</span>)}
                    </span>
                </div>
            ))}
            {data.total > 0 && (
                <Pagination currentPage={currentPage} totalPages={pageCount(data.total, rowsPerPage)} onPageChange={pager.setCurrentPage}
                    rowsPerPage={rowsPerPage} onRowsPerPageChange={pager.setRowsPerPage} totalCount={data.total} />
            )}
        </div>
    );
}
