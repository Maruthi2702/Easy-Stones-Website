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
import { useState, useRef } from 'react';
import type React from 'react';
import { X, Upload, AlertTriangle, Check, Loader, Download, Users } from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { orderLocations } from '../../../utils/locationFilter';
import type { Loose } from '../../../types/records';
import './CustomerImportModal.css';

const FIELD_LABELS: Record<string, string> = {
    salesRep: 'Sales rep',
    location: 'Easy Stones branch',
    marketingEmail: 'Marketing email',
    email: 'Email',
    contactName: 'Contact name',
    company: 'Company',
    phone: 'Phone',
    street: 'Street',
    street2: 'Suite / unit',
    city: 'City',
    state: 'State',
    zipCode: 'Zip',
    level: 'Level',
    customerType: 'Customer type',
    status: 'Status',
    modaDisplay: 'MODA display',
    modaBinder: 'MODA binder',
    receiveMarketing: 'Receive marketing',
    quickNote: 'Quick note',
    deliveryInstructions: 'Delivery instructions',
    accountAlert: 'Account alert'
};

const ACTION_LABELS: Record<string, string> = {
    create: 'New customers',
    update: 'Will be updated',
    review: 'Needs your review',
    error: 'Could not be read'
};

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A copy of `map` with `key` set to `value`, or dropped when `value` is blank. */
const withEntry = (map: Record<string, string>, key: string | number, value: string) => {
    const next = { ...map };
    if (value) next[key] = value; else delete next[key];
    return next;
};

/**
 * The upload both the preview and the apply send: the file, plus each answer
 * the person has given (only the ones they have, so an untouched import posts
 * nothing but the file). The server re-plans from exactly this.
 */
const importForm = (file: File, answers: Record<string, Record<string, unknown>>) => {
    const body = new FormData();
    body.append('file', file);
    for (const [name, value] of Object.entries(answers)) {
        if (Object.keys(value).length) body.append(name, JSON.stringify(value));
    }
    return body;
};

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

// "Decided: nobody", as opposed to '' ("not decided yet, ask again"). Same
// strings as IMPORT_UNASSIGNED / IMPORT_DEFAULT_BRANCH in
// src/utils/customerImport.js — not imported from there so this modal
// doesn't pull the xlsx parser into the browser bundle.
const UNASSIGNED = '__none__';
const DEFAULT_BRANCH = '__default__';

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
const describeFailure = async (res: Response): Promise<string> => {
    const body = await res.text();
    let parsed: Loose | null = null;
    try { parsed = JSON.parse(body); } catch { /* not JSON — fall through */ }

    const said = parsed && (parsed.message || parsed.error);
    if (said) return `${said}${parsed!.hint ? ` — ${parsed!.hint}` : ''} (HTTP ${res.status})`;

    return `HTTP ${res.status} — ${(body || '').trim().slice(0, 200) || res.statusText || 'no response body'}`;
};

// canResolveDuplicates: the "already in the database" duplicates section
// merges and deletes records, so it needs Edit (manage_customers), not just Import.
/** One "possible duplicates already in the database" group from the preview. */
type DupGroup = { members: Loose[]; signals: string[] };
/** A group's choices: the record kept, and what happens to each of the others. */
type DupChoice = { keepId: string; actions: Record<string, string> };
type Answers = Record<string, string>;

export type CustomerImportModalProps = {
    show?: boolean;
    onClose: () => void;
    onImported?: () => void;
    canResolveDuplicates?: boolean;
};

const CustomerImportModal = ({ show, onClose, onImported, canResolveDuplicates = false }: CustomerImportModalProps) => {
    const [file, setFile] = useState<File | null>(null);
    const [plan, setPlan] = useState<Loose | null>(null);
    const [mapping, setMapping] = useState<Answers>({});
    const [repAliases, setRepAliases] = useState<Answers>({});
    const [branchAliases, setBranchAliases] = useState<Answers>({});
    const [decisions, setDecisions] = useState<Answers>({});
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [result, setResult] = useState<Loose | null>(null);
    const [tab, setTab] = useState('update');
    // Per duplicate group (keyed by its member ids): which record stays, and
    // what happens to each of the others.
    const [dupChoices, setDupChoices] = useState<Record<string, DupChoice>>({});
    const [dupBusy, setDupBusy] = useState('');
    // The last merge/delete, for its Undo button.
    const [dupResult, setDupResult] = useState<{ message: string; undoIds: string[] } | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const previewSeq = useRef(0);

    const reset = () => {
        setFile(null); setPlan(null); setMapping({}); setRepAliases({});
        setBranchAliases({}); setDecisions({}); setError(''); setResult(null); setTab('update');
        setDupChoices({}); setDupResult(null);
    };

    const groupKey = (g: DupGroup) => g.members.map(m => m.id).join('|');

    /** The group's choices, defaulting "keep" to its oldest record (listed first). */
    const choicesIn = (all: Record<string, DupChoice>, g: DupGroup): DupChoice => all[groupKey(g)] || { keepId: g.members[0].id, actions: {} };
    const choicesFor = (g: DupGroup) => choicesIn(dupChoices, g);

    // Both read the latest state inside the updater rather than this render's
    // copy, so two changes in quick succession can't overwrite each other.
    const setKeep = (g: DupGroup, keepId: string) => {
        setDupChoices(all => {
            const rest = { ...choicesIn(all, g).actions };
            delete rest[keepId];
            return { ...all, [groupKey(g)]: { keepId, actions: rest } };
        });
    };

    const setDupAction = (g: DupGroup, id: string, action: string) => {
        setDupChoices(all => {
            const current = choicesIn(all, g);
            return { ...all, [groupKey(g)]: { ...current, actions: { ...current.actions, [id]: action } } };
        });
    };

    /**
     * Carry out one group's choices, then re-run the preview so the list (and
     * the import's own matching) reflects the customers as they now stand.
     */
    const resolveGroup = async (g: DupGroup) => {
        const { keepId, actions } = choicesFor(g);
        const kept = g.members.find(m => m.id === keepId)!;
        const count = (a: string) => Object.values(actions).filter(x => x === a).length;
        const merge = count('merge');
        const del = count('delete');
        if ((merge || del) && !window.confirm(
            `Keep "${kept.label}"` +
            (merge ? `\nMerge ${merge} record${merge === 1 ? '' : 's'} into it` : '') +
            (del ? `\nDelete ${del} record${del === 1 ? '' : 's'}` : '') +
            '\n\nYou can undo this straight after.'
        )) return;

        setDupBusy(groupKey(g));
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/duplicates/resolve`, {
                method: 'POST',
                body: JSON.stringify({ keepId, actions })
            });
            if (!res.ok) throw new Error(await describeFailure(res));
            const data = await res.json();
            const parts = [
                data.merged && `merged ${data.merged}`,
                data.deleted && `deleted ${data.deleted}`,
                data.separate && `kept ${data.separate} as ${data.separate === 1 ? 'a separate account' : 'separate accounts'}`
            ].filter(Boolean);
            setDupResult({ message: `${kept.label.split(' — ')[0]}: ${parts.join(', ')}.`, undoIds: data.undoIds });
            onImported?.();
            if (file) await runPreview(file);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setDupBusy('');
        }
    };

    const undoResolve = async () => {
        setDupBusy('undo');
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/duplicates/undo`, {
                method: 'POST',
                body: JSON.stringify({ undoIds: dupResult!.undoIds })
            });
            if (!res.ok) throw new Error(await describeFailure(res));
            setDupResult({ message: 'Undone — the removed records are back.', undoIds: [] });
            onImported?.();
            if (file) await runPreview(file);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setDupBusy('');
        }
    };

    const close = () => { reset(); onClose(); };

    /**
     * Ask the server what this file would do. Called again whenever the mapping
     * or an alias changes, because every one of those changes what it would do.
     */
    const runPreview = async (theFile: File, overrides: Partial<Record<'mapping' | 'repAliases' | 'branchAliases' | 'decisions', Answers>> = {}) => {
        // Only the newest request may show its answer: two quick changes (a
        // mapping, then an alias) used to let the slower, older response land
        // last and show a plan that no longer matched the choices on screen.
        const mine = ++previewSeq.current;
        setBusy('preview');
        setError('');
        try {
            const nextMapping = overrides.mapping ?? mapping;
            const body = importForm(theFile, {
                mapping: nextMapping,
                repAliases: overrides.repAliases ?? repAliases,
                branchAliases: overrides.branchAliases ?? branchAliases,
                decisions: overrides.decisions ?? decisions
            });

            const res = await authFetch(`${API_URL}/api/customers/import/preview`, {
                method: 'POST', body
            });
            if (!res.ok) throw new Error(await describeFailure(res));
            const data = await res.json();
            if (mine !== previewSeq.current) return;

            setPlan(data);
            // Adopt what the server detected, so the dropdowns show the mapping
            // actually in force rather than sitting empty until touched.
            if (!Object.keys(nextMapping).length) setMapping(data.mapping);
        } catch (err) {
            if (mine !== previewSeq.current) return;
            setError((err as Error).message);
            setPlan(null);
        } finally {
            if (mine === previewSeq.current) setBusy('');
        }
    };

    const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const picked = e.target.files![0];
        e.target.value = '';
        if (!picked) return;
        reset();
        setFile(picked);
        runPreview(picked, { mapping: {}, repAliases: {}, branchAliases: {} });
    };

    const changeMapping = (field: string, header: string) => {
        const next = { ...mapping, [field]: header };
        setMapping(next);
        runPreview(file!, { mapping: next });
    };

    const changeRepAlias = (given: string, userId: string) => {
        const next = withEntry(repAliases, given, userId);
        setRepAliases(next);
        runPreview(file!, { repAliases: next });
    };

    const changeBranchAlias = (given: string, branch: string) => {
        const next = withEntry(branchAliases, given, branch);
        setBranchAliases(next);
        runPreview(file!, { branchAliases: next });
    };

    /**
     * Settle one flagged row: import it as a new customer, or fold it into the
     * existing record it was confused with. Re-plans, so the row moves out of
     * the review list and into the create or update list with its changes shown.
     */
    const decide = (rowNumber: number, choice: string) => {
        const next = withEntry(decisions, rowNumber, choice);
        setDecisions(next);
        runPreview(file!, { decisions: next });
    };

    /**
     * Settle every row still awaiting review as "a different business" in one
     * click, for a re-export where the admin has already looked the list over
     * (in this modal or the downloaded CSV) and would otherwise be clicking
     * the same choice into the same dropdown dozens of times. A row anyone
     * already gave a specific decision to (picked a match, or was already set
     * to create) keeps that decision — this only fills in the ones still blank.
     */
    const acceptAllReviewAsNew = () => {
        const next = { ...decisions };
        for (const r of (plan?.rows || [])) {
            if (r.action === 'review' && !(r.rowNumber in next)) next[r.rowNumber] = 'create';
        }
        setDecisions(next);
        runPreview(file!, { decisions: next });
    };

    /**
     * Drop every remembered mapping and decision, then re-plan so the names
     * and rows they were answering come back to be asked about.
     */
    const forgetSaved = async () => {
        if (!window.confirm(
            'Forget every saved sales-rep mapping, branch mapping and review decision?\n\n' +
            'The next preview will ask about those names and rows again.'
        )) return;
        setBusy('preview');
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/import/memory`, { method: 'DELETE' });
            if (!res.ok) throw new Error(await describeFailure(res));
        } catch (err) {
            setError((err as Error).message);
            setBusy('');
            return;
        }
        runPreview(file!);
    };

    const apply = async () => {
        const { create, update } = plan!.counts;
        if (!window.confirm(
            `Create ${plural(create, 'customer')} and update ${update}?\n\n` +
            `${plural(plan!.counts.review, 'row')} flagged for review will not be touched.\n\n` +
            'The sales-rep mappings and review decisions you made here will be remembered for the next upload.'
        )) return;

        setBusy('apply');
        setError('');
        try {
            const body = importForm(file!, { mapping, repAliases, branchAliases, decisions });

            const res = await authFetch(`${API_URL}/api/customers/import/apply`, {
                method: 'POST', body
            });
            if (!res.ok) throw new Error(await describeFailure(res));
            const data = await res.json();

            setResult(data);
            setPlan(p => ({ ...p, ...data, counts: data.counts }));
            onImported?.();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy('');
        }
    };

    /** The duplicate list, as a file you can work through away from the screen. */
    const downloadReview = () => {
        const rows: Loose[] = (plan!.rows || []).filter((r: Loose) => r.action === 'review');
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
    // The preview's rows, grouped once for the four tabs.
    const rowsByAction: Record<string, Loose[]> = {};
    for (const r of plan?.rows || []) (rowsByAction[r.action] ||= []).push(r);
    const rowsFor = (action: string) => rowsByAction[action] || [];
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
                                    <button className="import-link" onClick={forgetSaved} disabled={working}>
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
                                            value={repAliases[u.given]} onChange={id => changeRepAlias(u.given, id)}
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
                                            value={branchAliases[u.given]} onChange={branch => changeBranchAlias(u.given, branch)}
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
                                        <>
                                            <button className="import-link import-tabs-action" onClick={downloadReview}>
                                                <Download size={14} /> Review list as CSV
                                            </button>
                                            <button
                                                className="import-link import-tabs-action"
                                                onClick={acceptAllReviewAsNew}
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
                                                            onChange={e => decide(r.rowNumber, e.target.value)}
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
                                    {result.results.errors.map((e: string, i: number) => <div key={i}>{e}</div>)}
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

                    {dupResult && (
                        <div className="import-dup-result">
                            <Check size={16} /> {dupResult.message}
                            {dupResult.undoIds.length > 0 && (
                                <button className="import-link" onClick={undoResolve} disabled={dupBusy !== ''}>
                                    {dupBusy === 'undo' ? 'Undoing…' : 'Undo'}
                                </button>
                            )}
                        </div>
                    )}

                    {canResolveDuplicates && plan?.dbDuplicates?.length > 0 && (
                        <section className="import-section import-section-warn">
                            <h3><AlertTriangle size={16} /> Possible duplicates already in the database</h3>
                            <p className="import-hint">
                                Found independently of this sheet — records that look like the same
                                business. Pick the one to keep, then for each of the others choose to
                                merge it in, delete it, or keep it as a separate account. Anything
                                booked against a merged or deleted record moves to the one you keep.
                            </p>
                            <div className="import-rows">
                                {plan!.dbDuplicates.map((g: DupGroup) => {
                                    const key = groupKey(g);
                                    const { keepId, actions } = choicesFor(g);
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
                                                                onChange={() => setKeep(g, m.id)}
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
                                                                onChange={e => setDupAction(g, m.id, e.target.value)}
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
                                                        onClick={() => resolveGroup(g)}
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
                            disabled={busy !== '' || !plan.fileCheck.ok || (counts.create + counts.update) === 0}
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
