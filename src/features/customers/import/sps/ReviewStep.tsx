/**
 * SPS import step 3: the tally, then one tab per outcome — the look-alikes to
 * decide (pre-set to "Add as new"), the deleted-before to answer, and the lists
 * of what will be added, updated, kept deleted or left alone, a page at a time.
 */
import { Check } from 'lucide-react';
import Pagination from '../../../../components/shared/Pagination';
import { pageCount } from '../../../../components/shared/paginationConfig';
import type { Loose } from '../../../../types/records';
import SpsSide from '../SpsSide';
import { SIGNAL_WORDS, fieldName, n, when } from '../spsImport';
import type { SpsImport } from '../useSpsImport';

export default function ReviewStep({ s }: { s: SpsImport }) {
    const data = s.data!;
    const { counts, tabs, tab, pickTab, listRows, pageRows, draft, answer, answerMany, pager } = s;
    const total = data?.distinct || 0;
    const seg = (c: number) => `${total ? (c / total) * 100 : 0}%`;
    return (
        <>
            <div className="spsc-tally">
                <div className="spsc-eq">
                    <b>{n(data.rowsRead)}</b> in the file{data.skipped.blank + data.skipped.repeated > 0 && <> ({n(data.skipped.blank + data.skipped.repeated)} blank or repeated rows set aside)</>} = <b>{n(counts.new)}</b> new + <b>{n((counts.update || 0) + (counts.restore || 0))}</b> to update + <b>{n(counts.unchanged)}</b> already here + <b>{n(counts.decision)}</b> need a decision + <b>{n(counts.deleted)}</b> deleted before{counts.keptDeleted > 0 && <> + <b>{n(counts.keptDeleted)}</b> kept deleted</>}
                </div>
                <div className="spsc-bar" aria-hidden="true">
                    <span className="s-new" style={{ width: seg(counts.new) }} /><span className="s-auto" style={{ width: seg((counts.update || 0) + (counts.restore || 0)) }} />
                    <span className="s-connected" style={{ width: seg(counts.unchanged) }} /><span className="s-check" style={{ width: seg(counts.decision) }} />
                    <span className="s-del" style={{ width: seg(counts.deleted + (counts.keptDeleted || 0)) }} />
                </div>
            </div>
            <div className="spsi-tabs" role="tablist">
                {tabs.map(([k, label, c]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pickTab(k)}>{label} {n(c)}</button>
                ))}
            </div>

            {tab === 'decision' && (
                <>
                    <div className="spsi-bulk"><span className="spsc-muted">Each one is pre-set to “Add as a new customer”, so ignoring it still adds the customer.</span>
                        {listRows.some((r) => draft.answers[r.key] !== 'new') && (
                            <button type="button" className="spsi-link" onClick={() => answerMany(Object.fromEntries(listRows.map((r) => [r.key, 'new'])))}>Add all remaining as new</button>)}</div>
                    {pageRows.map((r) => {
                        const chosen = draft.answers[r.key] || 'new';
                        return (
                            <fieldset key={r.key} className="spsc-card">
                                <legend><b>{r.name}</b> <span className="spsc-muted">row {r.rowNumber}</span></legend>
                                <div className="spsi-compare">
                                    <SpsSide k="In SPS" company={r.sheet.company} contact={r.sheet.contactName} phone={r.sheet.phone} email={r.sheet.email} place={r.sheet.city} branch={r.sheet.branch} rep={r.sheet.rep} />
                                    {r.matches.slice(0, 1).map((m: Loose) => (
                                        <SpsSide key={m.id} k="In Easy Stones" company={m.company} contact={m.contactName} phone={m.phone} email={m.email} place={m.city} branch={m.location} rep={m.salesRepName} />
                                    ))}
                                </div>
                                <label className={`spsc-opt${chosen === 'new' ? ' on' : ''}`}><input type="radio" name={`d-${r.key}`} checked={chosen === 'new'} onChange={() => answer('answers', r.key, 'new')} />
                                    <span><b>Add as a new customer</b><span className="spsc-muted"> pre-selected; merge later if it turns out to be the same</span></span></label>
                                {r.matches.map((m: Loose) => (
                                    <label key={m.id} className={`spsc-opt${chosen === m.id ? ' on' : ''}`}><input type="radio" name={`d-${r.key}`} checked={chosen === m.id} onChange={() => answer('answers', r.key, m.id)} />
                                        <span><b>Same customer: {m.company}</b><span className="spsc-muted"> {m.signals.map((x: string) => SIGNAL_WORDS[x] || x).join(' · ')} — connect and update</span></span></label>
                                ))}
                            </fieldset>
                        );
                    })}
                    {listRows.length === 0 && <div className="spsc-muted">Nothing needs a decision.</div>}
                </>
            )}

            {tab === 'deleted' && (
                <>
                    <div className="spsi-bulk"><span className="spsc-muted">These were deleted in Easy Stones but are still in SPS. Every one needs an answer.</span>
                        <span>
                            <button type="button" className="spsi-link" onClick={() => answerMany(Object.fromEntries(listRows.map((r) => [r.key, 'restore'])))}>Bring all back</button>{' · '}
                            <button type="button" className="spsi-link" onClick={() => answerMany(Object.fromEntries(listRows.map((r) => [r.key, 'keep'])))}>Keep all deleted</button>
                        </span></div>
                    {pageRows.map((r) => (
                        <div key={r.key} className="spsc-card">
                            <b>{r.name}</b>
                            <span className="spsc-muted">Deleted{r.deleted.deletedBy ? ` by ${r.deleted.deletedBy}` : ''}{r.deleted.deletedAt ? ` on ${when(r.deleted.deletedAt)}` : ''}{r.deleted.source === 'bulk' ? ' · bulk delete' : ''}</span>
                            <span className="spsi-btnrow">
                                <button type="button" className="spsi-btn gold" onClick={() => answer('answers', r.key, 'restore')}>Bring back</button>
                                <button type="button" className="spsi-btn" onClick={() => answer('answers', r.key, 'keep')}>Keep deleted</button>
                            </span>
                        </div>
                    ))}
                    {listRows.length === 0 && <div className="spsc-banner ok"><Check size={14} aria-hidden="true" /> All answered.</div>}
                </>
            )}

            {tab === 'keptDeleted' && pageRows.map((r) => (
                <div key={r.key} className="spsc-card">
                    <b>{r.name}</b>
                    <span className="spsc-muted">Deleted{r.deleted.deletedBy ? ` by ${r.deleted.deletedBy}` : ''}. {r.deleted.remembered ? 'Kept deleted on an earlier import.' : 'Kept deleted.'}</span>
                    {!r.deleted.remembered && <span className="spsi-btnrow"><button type="button" className="spsi-btn" onClick={() => answer('answers', r.key, 'restore')}>Bring back instead</button></span>}
                </div>
            ))}

            {(tab === 'new' || tab === 'update' || tab === 'unchanged') && (
                <div className="spsi-rows">
                    {pageRows.map((r) => (
                        <div key={r.key} className="spsi-row">
                            <span className={`spsi-pill ${tab === 'new' ? 'new' : tab === 'update' ? 'upd' : ''}`}>{tab === 'new' ? 'New' : tab === 'update' ? (r.restore ? 'Bring back' : r.connect ? 'Connect' : 'Update') : 'Same'}</span>
                            <span className="spsi-row-main"><b>{r.name}</b>
                                <span className="spsc-muted">{[r.city, r.branch, r.rep, r.customerLabel && r.customerLabel !== r.name ? `= ${r.customerLabel}` : ''].filter(Boolean).join(' · ')}</span>
                                {r.changes?.map((c: Loose, i: number) => <span key={i} className="spsi-chg">{fieldName(c.field)}: <s>{c.from || '—'}</s> → {String(c.to)}</span>)}
                                {r.warnings?.map((w: string, i: number) => <span key={i} className="spsi-warn">⚠ {w}</span>)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {listRows.length > 0 && (
                <Pagination currentPage={pager.currentPage} totalPages={pageCount(listRows.length, pager.rowsPerPage)} onPageChange={pager.setCurrentPage}
                    rowsPerPage={pager.rowsPerPage} onRowsPerPageChange={pager.setRowsPerPage} totalCount={listRows.length} />
            )}
        </>
    );
}
