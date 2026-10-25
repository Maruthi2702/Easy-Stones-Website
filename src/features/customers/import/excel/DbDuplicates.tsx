/**
 * The Excel import's "Possible duplicates already in the database": the last
 * merge/delete with its Undo, and each group with Keep, what happens to each
 * of the others, and Apply. Shown only with Edit (canResolveDuplicates).
 */
import { AlertTriangle, Check, Loader } from 'lucide-react';
import type { DbDuplicates as Dups, DupGroup } from './useDbDuplicates';

export function DupResultBanner({ dups }: { dups: Dups }) {
    const { dupResult, dupBusy } = dups;
    if (!dupResult) return null;
    return (
        <div className="import-dup-result">
            <Check size={16} /> {dupResult.message}
            {dupResult.undoIds.length > 0 && (
                <button className="import-link" onClick={dups.undoResolve} disabled={dupBusy !== ''}>
                    {dupBusy === 'undo' ? 'Undoing…' : 'Undo'}
                </button>
            )}
        </div>
    );
}

export default function DbDuplicates({ groups, dups }: { groups: DupGroup[]; dups: Dups }) {
    const { dupBusy } = dups;
    return (
        <section className="import-section import-section-warn">
            <h3><AlertTriangle size={16} /> Possible duplicates already in the database</h3>
            <p className="import-hint">
                Found independently of this sheet — records that look like the same
                business. Pick the one to keep, then for each of the others choose to
                merge it in, delete it, or keep it as a separate account. Anything
                booked against a merged or deleted record moves to the one you keep.
            </p>
            <div className="import-rows">
                {groups.map((g) => {
                    const key = dups.groupKey(g);
                    const { keepId, actions } = dups.choicesFor(g);
                    const others = g.members.filter(m => m.id !== keepId);
                    const ready = others.every(m => actions[m.id]);
                    const busy = dupBusy === key;
                    return (
                        <div key={key} className="import-row import-row-review">
                            <div className="import-row-head">
                                <span className="import-match-score">{g.signals.join(' + ')}</span>
                                <span className="import-row-sub">{g.members.length} records</span>
                            </div>
                            <div className="import-row-detail">
                                {g.members.map(m => (
                                    <div key={m.id} className={`import-dup-member ${m.id === keepId ? 'is-kept' : ''}`}>
                                        <label className="import-dup-keep">
                                            <input
                                                type="radio"
                                                name={`keep-${key}`}
                                                checked={m.id === keepId}
                                                disabled={busy}
                                                onChange={() => dups.setKeep(g, m.id)}
                                            />
                                            Keep
                                        </label>
                                        <span className="import-dup-label">
                                            {m.label}
                                            {m.salesRepName && <em> · rep {m.salesRepName}</em>}
                                        </span>
                                        {m.id !== keepId && (
                                            <select
                                                value={actions[m.id] || ''}
                                                disabled={busy}
                                                onChange={e => dups.setDupAction(g, m.id, e.target.value)}
                                            >
                                                <option value="">— choose —</option>
                                                <option value="merge">Merge into the kept one</option>
                                                <option value="delete">Delete this one</option>
                                                <option value="separate">Keep as a separate account</option>
                                            </select>
                                        )}
                                    </div>
                                ))}
                                <div className="import-dup-actions">
                                    <button
                                        className="import-btn-primary"
                                        disabled={!ready || dupBusy !== ''}
                                        onClick={() => dups.resolveGroup(g)}
                                    >
                                        {busy ? <><Loader size={14} className="spin" /> Saving…</> : 'Apply'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
