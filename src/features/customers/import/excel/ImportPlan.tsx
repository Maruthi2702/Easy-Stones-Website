/**
 * The Excel import's preview, before anything is written: which column is
 * which, the choices remembered from earlier uploads, the names this sheet
 * uses that we don't recognise, the file check, and what it will do.
 */
import type React from 'react';
import { AlertTriangle, Check, Users } from 'lucide-react';
import { orderLocations } from '../../../../utils/locationFilter';
import type { Loose } from '../../../../types/records';
import { FIELD_LABELS, UNASSIGNED, DEFAULT_BRANCH } from '../importFields';
import { plural } from '../excelImport';
import type { ExcelImport } from './useExcelImport';

/** One "who is this name?" row: the name from the sheet, how many rows use it, and the picker. */
const AliasRow = ({ given, rowCount, value, disabled, onChange, children }: {
    given: string; rowCount: number; value?: string; disabled: boolean; onChange: (value: string) => void; children?: React.ReactNode;
}) => (
    <div className="import-alias-row">
        <span className="import-alias-given">
            {given} <em>({plural(rowCount, 'row')})</em>
        </span>
        <select value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value)}>
            <option value="">— decide later —</option>
            {children}
        </select>
    </div>
);

export default function ImportPlan({ x }: { x: ExcelImport }) {
    const plan = x.plan!;
    const counts = plan.counts;
    const working = x.busy === 'preview';
    return (
        <>
            <section className="import-section">
                <h3>Which column is which</h3>
                <p className="import-hint">
                    Detected from the headings. Change anything it read wrongly — the
                    preview updates as you do.
                </p>
                <div className="import-mapping-grid">
                    {Object.keys(FIELD_LABELS).map(field => (
                        <label key={field} className="import-mapping-row">
                            <span>{FIELD_LABELS[field]}</span>
                            <select
                                value={x.mapping[field] ?? ''}
                                disabled={working}
                                onChange={e => x.changeMapping(field, e.target.value)}
                            >
                                <option value="">— not imported —</option>
                                {plan.headers.map((h: string) => <option key={h} value={h}>{h}</option>)}
                            </select>
                        </label>
                    ))}
                </div>
            </section>

            {(plan.remembered?.reps > 0 || plan.remembered?.branches > 0 || plan.remembered?.decisions > 0) && (
                <p className="import-hint import-remembered">
                    Using choices saved from earlier uploads:{' '}
                    {[
                        plan.remembered.reps > 0 && plural(plan.remembered.reps, 'sales-rep name'),
                        plan.remembered.branches > 0 && plural(plan.remembered.branches, 'branch name'),
                        plan.remembered.decisions > 0 && plural(plan.remembered.decisions, 'review decision')
                    ].filter(Boolean).join(', ')}.{' '}
                    <button className="import-link" onClick={x.forgetSaved} disabled={working}>
                        Forget saved choices
                    </button>
                </p>
            )}

            {(plan.unresolvedReps?.length > 0 || plan.unresolvedBranches?.length > 0) && (
                <section className="import-section import-section-warn">
                    <h3><Users size={16} /> Names this sheet uses that we don&apos;t recognise</h3>
                    <p className="import-hint">
                        Until you say who these are, those rows import unassigned. Whatever
                        you pick is remembered, so the next upload won&apos;t ask again.
                    </p>
                    {plan.unresolvedReps?.map((u: Loose) => (
                        <AliasRow
                            key={u.given} given={u.given} rowCount={u.rowCount} disabled={working}
                            value={x.repAliases[u.given]} onChange={id => x.changeRepAlias(u.given, id)}
                        >
                            <option value={UNASSIGNED}>Leave unassigned</option>
                            {plan.reps?.map((r: Loose) => (
                                <option key={r._id} value={r._id}>
                                    {r.name}{r.name === u.suggestion ? ' (likely)' : ''}
                                </option>
                            ))}
                        </AliasRow>
                    ))}
                    {plan.unresolvedBranches?.map((u: Loose) => (
                        <AliasRow
                            key={u.given} given={u.given} rowCount={u.rowCount} disabled={working}
                            value={x.branchAliases[u.given]} onChange={branch => x.changeBranchAlias(u.given, branch)}
                        >
                            <option value={DEFAULT_BRANCH}>Use the default branch</option>
                            {orderLocations(plan.branches || []).map(b => <option key={b} value={b}>{b}</option>)}
                        </AliasRow>
                    ))}
                </section>
            )}

            <section className="import-section">
                <h3>The file</h3>
                <p className="import-file-line">
                    <Check size={14} /> <strong>{plan.fileCheck.rowsRead.toLocaleString()}</strong> customers read from the file
                    {plan.coverage && (
                        <> · <strong>{plan.coverage.present.toLocaleString()}</strong> of {plan.coverage.total.toLocaleString()} are
                        already in Easy Stones{plan.coverage.absent > 0 && <>, <strong>{plan.coverage.absent.toLocaleString()}</strong> are not</>}</>
                    )}
                </p>
                {plan.fileCheck.blocking.map((b: Loose) => (
                    <div key={b.code} className="import-error">
                        <AlertTriangle size={16} /> {b.message}
                        {b.rows.length > 0 && <> Rows: {b.rows.join(', ')}{b.rows.length >= 50 ? '…' : ''}.</>}
                    </div>
                ))}
                {plan.fileCheck.warnings.map((w: Loose) => (
                    <p key={w.code} className="import-row-warning">
                        <AlertTriangle size={12} /> {w.message}
                        {w.rows.length > 0 && <> Rows: {w.rows.slice(0, 12).join(', ')}{w.rows.length > 12 ? '…' : ''}.</>}
                    </p>
                ))}
                {plan.coverage?.absent > 0 && (
                    <p className="import-hint">
                        &ldquo;Not in Easy Stones&rdquo; counts names with no customer of that exact name. They may still
                        be matched to a customer under a different spelling below.
                    </p>
                )}
            </section>

            <section className="import-section">
                <h3>What this will do</h3>
                <div className="import-counts">
                    <div className="import-count import-count-create">
                        <strong>{counts.create}</strong><span>created</span>
                    </div>
                    <div className="import-count import-count-update">
                        <strong>{counts.update}</strong><span>updated</span>
                    </div>
                    <div className="import-count import-count-review">
                        <strong>{counts.review}</strong><span>need review</span>
                    </div>
                    <div className="import-count">
                        <strong>{counts.unchanged}</strong><span>already correct</span>
                    </div>
                    {counts.error > 0 && (
                        <div className="import-count import-count-error">
                            <strong>{counts.error}</strong><span>unreadable</span>
                        </div>
                    )}
                </div>
                <p className="import-hint">
                    For customers already on file, the sheet only fills in what&apos;s
                    missing — phone, address, contact, notes, a sales rep — and never
                    overwrites anything typed into the CRM. Branch is taken from the sheet.
                </p>
            </section>
        </>
    );
}
