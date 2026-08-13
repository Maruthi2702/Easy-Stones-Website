/**
 * Import customers from a spreadsheet — shown what will happen before it does.
 *
 * The flow is deliberately two-step. The old import wrote the moment a file was
 * picked and reported a count afterwards, which meant a mis-read column was
 * discovered only in the data. Here the server plans the import and returns it;
 * nothing is written until the admin has seen the column mapping it guessed,
 * told it who the sheet's unfamiliar names are, and read the list of rows it
 * cannot safely decide alone.
 *
 * The file is re-posted for the apply rather than the plan being sent back. The
 * server re-plans against the database as it stands at that moment, so nothing
 * edited in the browser can choose which record gets written.
 */
import React, { useState, useRef } from 'react';
import { X, Upload, AlertTriangle, Check, Loader, Download, Users } from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import './CustomerImportModal.css';

const FIELD_LABELS = {
    salesRep: 'Sales rep',
    location: 'Easy Stones branch',
    email: 'Email',
    contactName: 'Contact name',
    company: 'Company',
    phone: 'Phone',
    street: 'Street',
    city: 'City',
    state: 'State',
    zipCode: 'Zip',
    level: 'Level',
    customerType: 'Customer type',
    status: 'Status',
    modaDisplay: 'MODA display',
    modaBinder: 'MODA binder'
};

const ACTION_LABELS = {
    create: 'New customers',
    update: 'Will be updated',
    review: 'Needs your review',
    error: 'Could not be read'
};

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/**
 * Whatever the server said went wrong, in words.
 *
 * Only these two routes answer with `message`. The auth middleware says `error`,
 * and so does the API's catch-all 404 — which also carries a `hint` naming the
 * likeliest cause, the single most useful sentence in the whole response.
 * Reading only `message` threw all of that away and showed a bare "Preview
 * failed", which sent us looking in the wrong place for an afternoon. Read every
 * field the server actually uses, and always show the status code.
 */
const describeFailure = async (res) => {
    const body = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* not JSON — fall through */ }

    const said = parsed && (parsed.message || parsed.error);
    if (said) return `${said}${parsed.hint ? ` — ${parsed.hint}` : ''} (HTTP ${res.status})`;

    return `HTTP ${res.status} — ${(body || '').trim().slice(0, 200) || res.statusText || 'no response body'}`;
};

const CustomerImportModal = ({ show, onClose, onImported }) => {
    const [file, setFile] = useState(null);
    const [plan, setPlan] = useState(null);
    const [mapping, setMapping] = useState({});
    const [repAliases, setRepAliases] = useState({});
    const [branchAliases, setBranchAliases] = useState({});
    const [decisions, setDecisions] = useState({});
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [tab, setTab] = useState('update');
    const fileRef = useRef(null);

    const reset = () => {
        setFile(null); setPlan(null); setMapping({}); setRepAliases({});
        setBranchAliases({}); setDecisions({}); setError(''); setResult(null); setTab('update');
    };

    const close = () => { reset(); onClose(); };

    /**
     * Ask the server what this file would do. Called again whenever the mapping
     * or an alias changes, because every one of those changes what it would do.
     */
    const runPreview = async (theFile, overrides = {}) => {
        setBusy('preview');
        setError('');
        try {
            const body = new FormData();
            body.append('file', theFile);
            const nextMapping = overrides.mapping ?? mapping;
            const nextReps = overrides.repAliases ?? repAliases;
            const nextBranches = overrides.branchAliases ?? branchAliases;
            const nextDecisions = overrides.decisions ?? decisions;
            if (Object.keys(nextMapping).length) body.append('mapping', JSON.stringify(nextMapping));
            if (Object.keys(nextReps).length) body.append('repAliases', JSON.stringify(nextReps));
            if (Object.keys(nextBranches).length) body.append('branchAliases', JSON.stringify(nextBranches));
            if (Object.keys(nextDecisions).length) body.append('decisions', JSON.stringify(nextDecisions));

            const res = await authFetch(`${API_URL}/api/admin/customers/import/preview`, {
                method: 'POST', body
            });
            if (!res.ok) throw new Error(await describeFailure(res));
            const data = await res.json();

            setPlan(data);
            // Adopt what the server detected, so the dropdowns show the mapping
            // actually in force rather than sitting empty until touched.
            if (!Object.keys(nextMapping).length) setMapping(data.mapping);
        } catch (err) {
            setError(err.message);
            setPlan(null);
        } finally {
            setBusy('');
        }
    };

    const onPickFile = (e) => {
        const picked = e.target.files[0];
        e.target.value = '';
        if (!picked) return;
        reset();
        setFile(picked);
        runPreview(picked, { mapping: {}, repAliases: {}, branchAliases: {} });
    };

    const changeMapping = (field, header) => {
        const next = { ...mapping, [field]: header };
        setMapping(next);
        runPreview(file, { mapping: next });
    };

    const changeRepAlias = (given, userId) => {
        const next = { ...repAliases };
        if (userId) next[given] = userId; else delete next[given];
        setRepAliases(next);
        runPreview(file, { repAliases: next });
    };

    const changeBranchAlias = (given, branch) => {
        const next = { ...branchAliases };
        if (branch) next[given] = branch; else delete next[given];
        setBranchAliases(next);
        runPreview(file, { branchAliases: next });
    };

    /**
     * Settle one flagged row: import it as a new customer, or fold it into the
     * existing record it was confused with. Re-plans, so the row moves out of
     * the review list and into the create or update list with its changes shown.
     */
    const decide = (rowNumber, choice) => {
        const next = { ...decisions };
        if (choice) next[rowNumber] = choice; else delete next[rowNumber];
        setDecisions(next);
        runPreview(file, { decisions: next });
    };

    const apply = async () => {
        const { create, update } = plan.counts;
        if (!window.confirm(
            `Create ${create} customer${create === 1 ? '' : 's'} and update ${update}?\n\n` +
            `${plan.counts.review} row${plan.counts.review === 1 ? '' : 's'} flagged for review will not be touched.`
        )) return;

        setBusy('apply');
        setError('');
        try {
            const body = new FormData();
            body.append('file', file);
            if (Object.keys(mapping).length) body.append('mapping', JSON.stringify(mapping));
            if (Object.keys(repAliases).length) body.append('repAliases', JSON.stringify(repAliases));
            if (Object.keys(branchAliases).length) body.append('branchAliases', JSON.stringify(branchAliases));
            if (Object.keys(decisions).length) body.append('decisions', JSON.stringify(decisions));

            const res = await authFetch(`${API_URL}/api/admin/customers/import/apply`, {
                method: 'POST', body
            });
            if (!res.ok) throw new Error(await describeFailure(res));
            const data = await res.json();

            setResult(data);
            setPlan(p => ({ ...p, ...data, counts: data.counts }));
            onImported?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy('');
        }
    };

    /** The duplicate list, as a file you can work through away from the screen. */
    const downloadReview = () => {
        const rows = (plan.rows || []).filter(r => r.action === 'review');
        const lines = [
            ['Sheet row', 'Company', 'Contact', 'Email', 'Phone', 'City', 'Why', 'Existing match', 'Matched on', 'Confidence'].join(',')
        ];
        for (const r of rows) {
            for (const m of (r.matches || [])) {
                lines.push([
                    r.rowNumber, r.company, r.contactName, r.email, r.phone, r.city,
                    r.reason, m.label, m.signals.join(' + '), m.score
                ].map(csvCell).join(','));
            }
        }
        const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `customer-import-review-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (!show) return null;

    const counts = plan?.counts;
    const rowsFor = (action) => (plan?.rows || []).filter(r => r.action === action);
    const working = busy === 'preview';

    return (
        <div className="import-modal-overlay" onClick={close}>
            <div className="import-modal" onClick={e => e.stopPropagation()}>
                <div className="import-modal-header">
                    <h2>Import customers from Excel</h2>
                    <button className="import-close" onClick={close}><X size={20} /></button>
                </div>

                <div className="import-modal-body">
                    {!file && (
                        <div className="import-dropzone" onClick={() => fileRef.current?.click()}>
                            <Upload size={32} />
                            <p>Choose your SPS export (.xlsx or .xls)</p>
                            <span>Nothing is saved until you have reviewed what it will do.</span>
                        </div>
                    )}
                    <input
                        ref={fileRef} type="file" accept=".xlsx,.xls"
                        style={{ display: 'none' }} onChange={onPickFile}
                    />

                    {error && <div className="import-error"><AlertTriangle size={16} /> {error}</div>}

                    {file && (
                        <div className="import-filebar">
                            <strong>{file.name}</strong>
                            {working && <span className="import-working"><Loader size={14} className="spin" /> reading…</span>}
                            <button className="import-link" onClick={() => fileRef.current?.click()}>Choose a different file</button>
                        </div>
                    )}

                    {plan && !result && (
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
                                                value={mapping[field] ?? ''}
                                                disabled={working}
                                                onChange={e => changeMapping(field, e.target.value)}
                                            >
                                                <option value="">— not imported —</option>
                                                {plan.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                            </select>
                                        </label>
                                    ))}
                                </div>
                            </section>

                            {(plan.unresolvedReps?.length > 0 || plan.unresolvedBranches?.length > 0) && (
                                <section className="import-section import-section-warn">
                                    <h3><Users size={16} /> Names this sheet uses that we don&apos;t recognise</h3>
                                    <p className="import-hint">
                                        Until you say who these are, those rows import unassigned.
                                    </p>
                                    {plan.unresolvedReps?.map(u => (
                                        <div key={u.given} className="import-alias-row">
                                            <span className="import-alias-given">
                                                {u.given} <em>({u.rowCount} row{u.rowCount === 1 ? '' : 's'})</em>
                                            </span>
                                            <select
                                                value={repAliases[u.given] ?? ''}
                                                disabled={working}
                                                onChange={e => changeRepAlias(u.given, e.target.value)}
                                            >
                                                <option value="">— leave unassigned —</option>
                                                {plan.reps?.map(r => (
                                                    <option key={r._id} value={r._id}>
                                                        {r.name}{r.name === u.suggestion ? ' (likely)' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                    {plan.unresolvedBranches?.map(u => (
                                        <div key={u.given} className="import-alias-row">
                                            <span className="import-alias-given">
                                                {u.given} <em>({u.rowCount} row{u.rowCount === 1 ? '' : 's'})</em>
                                            </span>
                                            <select
                                                value={branchAliases[u.given] ?? ''}
                                                disabled={working}
                                                onChange={e => changeBranchAlias(u.given, e.target.value)}
                                            >
                                                <option value="">— use default branch —</option>
                                                {plan.branches?.map(b => <option key={b} value={b}>{b}</option>)}
                                            </select>
                                        </div>
                                    ))}
                                </section>
                            )}

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
                                    A customer who already has a sales rep keeps them — the sheet never
                                    overwrites an owner. Branch is taken from the sheet.
                                </p>
                            </section>

                            <section className="import-section">
                                <div className="import-tabs">
                                    {['update', 'create', 'review', 'error'].map(action => (
                                        <button
                                            key={action}
                                            className={`import-tab ${tab === action ? 'active' : ''}`}
                                            onClick={() => setTab(action)}
                                        >
                                            {ACTION_LABELS[action]} ({counts[action] || 0})
                                        </button>
                                    ))}
                                    {counts.review > 0 && (
                                        <button className="import-link import-tabs-action" onClick={downloadReview}>
                                            <Download size={14} /> Review list as CSV
                                        </button>
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
                                                    {r.changes.map(c => (
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
                                                    {r.matches.map(m => (
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
                                                            onChange={e => decide(r.rowNumber, e.target.value)}
                                                        >
                                                            <option value="">— leave it, decide later —</option>
                                                            <option value="create">a different business — create it</option>
                                                            {r.matches.filter(m => !m.fromSheet).map(m => (
                                                                <option key={m.id} value={m.id}>
                                                                    the same as: {m.label.slice(0, 70)}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                            )}

                                            {r.action === 'error' && <div className="import-row-detail">{r.reason}</div>}

                                            {r.warnings?.map((w, i) => (
                                                <div key={i} className="import-row-warning">
                                                    <AlertTriangle size={12} /> {w}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </>
                    )}

                    {result && (
                        <section className="import-section import-section-done">
                            <h3><Check size={18} /> Import finished</h3>
                            <div className="import-counts">
                                <div className="import-count import-count-create">
                                    <strong>{result.results.created}</strong><span>created</span>
                                </div>
                                <div className="import-count import-count-update">
                                    <strong>{result.results.updated}</strong><span>updated</span>
                                </div>
                                <div className="import-count">
                                    <strong>{result.results.skipped}</strong><span>left alone</span>
                                </div>
                            </div>
                            {result.results.errors.length > 0 && (
                                <div className="import-error-list">
                                    {result.results.errors.map((e, i) => <div key={i}>{e}</div>)}
                                </div>
                            )}
                            {result.counts.review > 0 && (
                                <p className="import-hint">
                                    {result.counts.review} row{result.counts.review === 1 ? '' : 's'} still
                                    need review — nothing was written for those.{' '}
                                    <button className="import-link" onClick={downloadReview}>Download the list</button>
                                </p>
                            )}
                        </section>
                    )}

                    {plan?.dbDuplicates?.length > 0 && (
                        <section className="import-section import-section-warn">
                            <h3><AlertTriangle size={16} /> Possible duplicates already in the database</h3>
                            <p className="import-hint">
                                Found independently of this sheet — two or more records that look like
                                the same business. Verify, then merge or delete with{' '}
                                <code>node scripts/merge-duplicate-customers.js</code>.
                            </p>
                            <div className="import-rows">
                                {plan.dbDuplicates.map((g, i) => (
                                    <div key={i} className="import-row import-row-review">
                                        <div className="import-row-head">
                                            <span className="import-match-score">{g.signals.join(' + ')}</span>
                                            <span className="import-row-sub">{g.members.length} records</span>
                                        </div>
                                        <div className="import-row-detail">
                                            {g.members.map(m => <div key={m.id} className="import-match">{m.label}</div>)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </div>

                <div className="import-modal-footer">
                    <button className="import-btn-secondary" onClick={close}>
                        {result ? 'Done' : 'Cancel'}
                    </button>
                    {plan && !result && (
                        <button
                            className="import-btn-primary"
                            onClick={apply}
                            disabled={busy !== '' || (counts.create + counts.update) === 0}
                        >
                            {busy === 'apply'
                                ? <><Loader size={16} className="spin" /> Importing…</>
                                : <>Import {counts.create + counts.update} row{counts.create + counts.update === 1 ? '' : 's'}</>}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CustomerImportModal;
