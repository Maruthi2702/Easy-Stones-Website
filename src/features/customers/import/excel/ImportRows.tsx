/**
 * The Excel import preview's rows, one tab per outcome (updated, new, needs
 * review, unreadable): what changes on each, and the decision a flagged row needs.
 */
import { AlertTriangle, Download } from 'lucide-react';
import type { Loose } from '../../../../types/records';
import { FIELD_LABELS } from '../importFields';
import { ACTION_LABELS } from '../excelImport';
import type { ExcelImport } from './useExcelImport';

export default function ImportRows({ x }: { x: ExcelImport }) {
    const counts = x.plan!.counts;
    const working = x.busy === 'preview';
    // The preview's rows, grouped once for the four tabs.
    const rowsByAction: Record<string, Loose[]> = {};
    for (const r of x.plan?.rows || []) (rowsByAction[r.action] ||= []).push(r);
    const rowsFor = (action: string) => rowsByAction[action] || [];
    const { tab, decisions } = x;
    return (
        <section className="import-section">
            <div className="import-tabs">
                {['update', 'create', 'review', 'error'].map(action => (
                    <button
                        key={action}
                        className={`import-tab ${tab === action ? 'active' : ''}`}
                        onClick={() => x.setTab(action)}
                    >
                        {ACTION_LABELS[action]} ({counts[action] || 0})
                    </button>
                ))}
                {counts.review > 0 && (
                    <>
                        <button className="import-link import-tabs-action" onClick={x.downloadReview}>
                            <Download size={14} /> Review list as CSV
                        </button>
                        <button
                            className="import-link import-tabs-action"
                            onClick={x.acceptAllReviewAsNew}
                            disabled={working}
                            title="Marks every row still flagged for review as a different business, so all of them import as new customers"
                        >
                            Accept all as new
                        </button>
                    </>
                )}
            </div>

            <div className="import-rows">
                {rowsFor(tab).length === 0 && <p className="import-empty">Nothing here.</p>}
                {rowsFor(tab).map(r => (
                    <div key={r.rowNumber} className={`import-row import-row-${r.action}`}>
                        <div className="import-row-head">
                            <span className="import-row-num">Row {r.rowNumber}</span>
                            <strong>{r.company}</strong>
                            <span className="import-row-sub">{r.contactName} · {r.email}</span>
                        </div>

                        {r.action === 'update' && (
                            <div className="import-row-detail">
                                <div className="import-row-target">matches: {r.targetLabel}</div>
                                {r.changes.map((c: Loose) => (
                                    <div key={c.field} className="import-change">
                                        {FIELD_LABELS[c.field] || c.field}:
                                        <span className="import-from">{c.from || '(blank)'}</span>
                                        →<span className="import-to">{c.to}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {r.action === 'create' && (
                            <div className="import-row-detail">
                                rep: {r.create?.salesRepName || 'unassigned'} ·
                                branch: {r.create?.location || 'default'}
                            </div>
                        )}

                        {r.action === 'review' && (
                            <div className="import-row-detail">
                                <div className="import-row-reason">{r.reason}</div>
                                {r.matches.map((m: Loose) => (
                                    <div key={m.id} className="import-match">
                                        <span className="import-match-score">{m.signals.join(' + ')}</span>
                                        {m.label}
                                        {m.salesRepName && <em> · rep {m.salesRepName}</em>}
                                        {m.fromSheet && <em> · another row of this sheet</em>}
                                    </div>
                                ))}
                                <div className="import-decision">
                                    <span>This row is:</span>
                                    <select
                                        value={decisions[r.rowNumber] ?? ''}
                                        disabled={working}
                                        onChange={e => x.decide(r.rowNumber, e.target.value)}
                                    >
                                        <option value="">— leave it, decide later —</option>
                                        <option value="create">a different business — create it</option>
                                        {r.matches.filter((m: Loose) => !m.fromSheet).map((m: Loose) => (
                                            <option key={m.id} value={m.id}>
                                                the same as: {m.label.slice(0, 70)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {r.action === 'error' && <div className="import-row-detail">{r.reason}</div>}

                        {r.warnings?.map((w: string, i: number) => (
                            <div key={i} className="import-row-warning">
                                <AlertTriangle size={12} /> {w}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </section>
    );
}
