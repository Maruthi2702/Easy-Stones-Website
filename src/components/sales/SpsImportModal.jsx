/**
 * Import customers from SPS — the five-step import from the "SPS Import
 * Redesign" artifact: Upload → Columns & names → Review → Import → Results,
 * plus Import history. The server does the work (src/routes/customerSpsImport.js):
 * it saves the file and every answer as a draft run, plans from that file,
 * writes in the background and checks the result; this window only asks and
 * shows. Every answer is saved as you go, so closing it loses nothing.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Check, AlertTriangle, Download } from 'lucide-react';
import FormModal from '../shared/form/FormModal';
import RepPicker from '../shared/form/RepPicker';
import LocationPicker from '../shared/form/LocationPicker';
import Pagination from '../shared/Pagination';
import { usePagination, pageCount } from '../shared/paginationConfig';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import './SpsConnectModal.css';
import './SpsImportModal.css';

const API = `${API_URL}/api/customers/sps-import/runs`;
const NONE_REP = '__none__';          // IMPORT_UNASSIGNED on the server
const DEFAULT_BRANCH = '__default__'; // IMPORT_DEFAULT_BRANCH
const STEPS = ['Upload', 'Columns & names', 'Review', 'Import', 'Results'];
const FIELD_LABELS = {
    salesRep: 'Sales rep', location: 'Easy Stones branch', marketingEmail: 'Marketing email', email: 'Email',
    contactName: 'Contact name', company: 'Company', phone: 'Phone', street: 'Street', street2: 'Suite / unit',
    city: 'City', state: 'State', zipCode: 'Zip', level: 'Level', customerType: 'Customer type', status: 'Status',
    modaDisplay: 'MODA display', modaBinder: 'MODA binder', receiveMarketing: 'Receive marketing',
    quickNote: 'Quick note', deliveryInstructions: 'Delivery instructions', accountAlert: 'Account alert'
};
const SIGNAL_WORDS = { phone: 'same phone', email: 'same email', 'company name': 'similar name', 'email domain': 'same email domain', 'exact name': 'same name' };
const n = (v) => Number(v || 0).toLocaleString();
const when = (d) => (d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const failure = async (res) => {
    const text = await res.text();
    let said = '';
    try { const j = JSON.parse(text); said = j.message || j.error || ''; } catch { /* not JSON */ }
    const err = new Error(`${said || text.slice(0, 200) || res.statusText} (HTTP ${res.status})`);
    try { err.body = JSON.parse(text); } catch { /* not JSON */ }
    return err;
};
const call = async (url, options) => {
    const res = await authFetch(url, options);
    if (!res.ok) throw await failure(res);
    return res;
};
const jsonCall = async (url, body, method = 'POST') =>
    (await call(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json();

const saveBlob = async (url, filename) => {
    const blob = await (await call(url)).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

/**
 * A picker opens its list inside the window's scrolling body, so on a short
 * screen a row near the bottom gets a list only a few lines tall. Bring the
 * row to the top of the body first (the body has room below it — .spsi-asks)
 * and the list gets all the space there is. Runs on click (capture), which is
 * after the press — scrolling on mouse-down moves the trigger from under the
 * pointer and the click never lands — and before the picker measures its space.
 * Scrolls the body only, never the page (scrollIntoView would — see LocationPicker).
 */
const liftRow = (e) => {
    const row = e.currentTarget;
    const body = row.closest('.fm-body');
    if (!body) return;
    const delta = row.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    if (Math.abs(delta) > 4) body.scrollTop += delta;
};

export default function SpsImportModal({ onClose, onChanged, salesReps = [], locations = [], user = null, canEdit = false, canAdd = false, canDelete = false }) {
    const fileInput = useRef(null);
    const [view, setView] = useState('loading');   // loading | wizard | history
    const [step, setStep] = useState(1);
    const [resume, setResume] = useState(null);    // { draft, running } from /current
    const [run, setRun] = useState(null);
    const [fileCheck, setFileCheck] = useState(null);
    const [draft, setDraft] = useState({ mapping: {}, repAliases: {}, branchAliases: {}, answers: {} });
    const [data, setData] = useState(null);        // the plan response
    const [tab, setTab] = useState('decision');
    const [busy, setBusy] = useState(false);
    const [planning, setPlanning] = useState(false);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState(null);
    const [history, setHistory] = useState([]);
    const [showMapping, setShowMapping] = useState(false);
    const planSeq = useRef(0);
    const pager = usePagination();

    // ── opening: is there an unfinished draft, or an import running now? ────
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const cur = await (await call(`${API}/current`)).json();
                if (!alive) return;
                setResume(cur);
                if (cur.running) { setRun(cur.running); setProgress(cur.running); setStep(4); }
            } catch (err) { if (alive) setError(err.message); }
            if (alive) setView('wizard');
        })();
        return () => { alive = false; };
    }, []);

    // ── the plan: save what changed, get the whole picture back ─────────────
    const replan = useCallback(async (runId, patch = {}) => {
        const seq = ++planSeq.current;
        setPlanning(true); setError('');
        try {
            const out = await jsonCall(`${API}/${runId}/plan`, patch);
            if (seq !== planSeq.current) return null;   // a newer answer is already on its way
            setData(out);
            setDraft({
                mapping: out.run ? (patch.mapping || out.mapping || {}) : {},
                repAliases: patch.repAliases || draftRef.current.repAliases,
                branchAliases: patch.branchAliases || draftRef.current.branchAliases,
                answers: patch.answers || draftRef.current.answers
            });
            return out;
        } catch (err) {
            if (seq === planSeq.current) setError(err.message);
            return null;
        } finally {
            if (seq === planSeq.current) setPlanning(false);
        }
    }, []);
    const draftRef = useRef(draft);
    useEffect(() => { draftRef.current = draft; }, [draft]);

    const answer = (patchKey, key, value) => {
        const next = { ...draftRef.current[patchKey], [key]: value };
        setDraft((d) => ({ ...d, [patchKey]: next }));
        draftRef.current = { ...draftRef.current, [patchKey]: next };
        replan(run.id, { [patchKey]: next });
    };
    const answerMany = (entries) => {
        const next = { ...draftRef.current.answers, ...entries };
        setDraft((d) => ({ ...d, answers: next }));
        draftRef.current = { ...draftRef.current, answers: next };
        replan(run.id, { answers: next });
    };

    // ── step 1 ───────────────────────────────────────────────────────────────
    const upload = async (file) => {
        if (!file) return;
        setBusy(true); setError(''); setFileCheck(null); setData(null);
        try {
            const body = new FormData();
            body.append('file', file);
            const out = await (await call(API, { method: 'POST', body })).json();
            setRun(out.run); setFileCheck(out.fileCheck);
            setDraft({ mapping: {}, repAliases: {}, branchAliases: {}, answers: {} });
            draftRef.current = { mapping: {}, repAliases: {}, branchAliases: {}, answers: {} };
            await replan(out.run.id, {});
        } catch (err) {
            setError(err.message);
            if (err.body?.fileCheck) setFileCheck(err.body.fileCheck);
            setRun(null);
        } finally { setBusy(false); }
    };
    const continueDraft = async () => {
        setBusy(true); setError('');
        try {
            const d = resume.draft;
            setRun(d);
            const out = await replan(d.id, {});
            if (out) {
                setFileCheck(out.fileCheck);
                setDraft({ mapping: out.mapping || {}, repAliases: {}, branchAliases: {}, answers: {} });
                setStep(out.blockers?.length && (out.unresolvedReps.length || out.unresolvedBranches.length) ? 2 : 3);
            }
        } finally { setBusy(false); }
    };
    const startOver = async () => {
        try { await call(`${API}/${resume.draft.id}`, { method: 'DELETE' }); } catch { /* already gone */ }
        setResume((r) => ({ ...r, draft: null }));
    };

    // ── step 4: start, then watch ────────────────────────────────────────────
    const startImport = async () => {
        setBusy(true); setError('');
        try {
            const out = await jsonCall(`${API}/${run.id}/start`);
            setProgress(out.run); setStep(4);
        } catch (err) { setError(err.message); } finally { setBusy(false); }
    };
    useEffect(() => {
        if (step !== 4 || !run) return undefined;
        let alive = true;
        const tick = async () => {
            try {
                const out = await (await call(`${API}/${run.id}`)).json();
                if (!alive) return;
                setProgress(out.run);
                if (out.run.status === 'done' || out.run.status === 'failed') { onChanged?.(); setStep(5); }
            } catch { /* keep trying */ }
        };
        const t = setInterval(tick, 1500);
        tick();
        return () => { alive = false; clearInterval(t); };
    }, [step, run, onChanged]);

    // ── step 5 ───────────────────────────────────────────────────────────────
    const retry = async () => {
        setBusy(true); setError('');
        try { await jsonCall(`${API}/${run.id}/retry`); setStep(4); } catch (err) { setError(err.message); } finally { setBusy(false); }
    };
    const undo = async (r) => {
        const warning = `Undo this import?\n\nCustomers it added are removed (each saved first), customers it updated go back to what they were, and customers it brought back are deleted again.`;
        if (!window.confirm(warning)) return;
        setBusy(true); setError('');
        try {
            const out = await jsonCall(`${API}/${r.id}/undo`);
            onChanged?.();
            setError('');
            await openHistory();
            window.alert(`Undone: ${n(out.removed)} removed, ${n(out.reverted)} put back${out.failed?.length ? `, ${out.failed.length} couldn’t be undone` : ''}.`);
        } catch (err) { setError(err.message); } finally { setBusy(false); }
    };
    const report = (r) => saveBlob(`${API}/${r.id}/report.csv`, `sps-import-${r.id.slice(-6)}.csv`).catch((err) => setError(err.message));
    const openHistory = async () => {
        setError('');
        try {
            const out = await (await call(API)).json();
            setHistory(out.runs); setView('history');
        } catch (err) { setError(err.message); }
    };

    // ── derived ──────────────────────────────────────────────────────────────
    const counts = data?.counts || {};
    const repOptions = useMemo(() => {
        const allowed = new Set((data?.reps || []).map((r) => String(r._id)));
        const list = salesReps.filter((r) => !r.inactive && allowed.has(String(r._id)))
            .map((r) => ({ value: String(r._id), label: r.name, location: r.location || '', id: String(r._id) }));
        for (const r of data?.reps || []) if (!list.some((o) => o.value === String(r._id))) list.push({ value: String(r._id), label: r.name, location: '' });
        return [...list, { value: NONE_REP, label: 'No sales rep', location: '' }];
    }, [data, salesReps]);
    const branchNames = useMemo(() => [...(data?.branches || locations.map((l) => l.name || l)), DEFAULT_BRANCH], [data, locations]);
    const unanswered = (data?.unresolvedReps?.length || 0) + (data?.unresolvedBranches?.length || 0);
    const needsBlocked = (data?.needs?.edit && !canEdit ? 'Some customers here connect to existing ones, which needs the Edit customer switch.' : '')
        || (data?.needs?.add && !canAdd ? 'Bringing back a deleted customer needs the Add customer switch.' : '');

    // ── the footer button for each step ──────────────────────────────────────
    let submit = { label: 'Continue', run: () => setStep(2), disabled: true, hide: false };
    if (view === 'wizard') {
        if (step === 1) submit = { label: 'Continue', run: () => setStep(2), disabled: !data || !fileCheck?.ok || busy };
        else if (step === 2) submit = { label: 'Continue', run: () => { setTab(counts.decision ? 'decision' : counts.deleted ? 'deleted' : 'new'); pager.resetPage(); setStep(3); }, disabled: !data || unanswered > 0 || planning };
        else if (step === 3) submit = { label: `Start import`, run: startImport, disabled: !data || (data.blockers || []).length > 0 || !!needsBlocked || planning };
        else submit = { hide: true };
    } else submit = { hide: true };

    const footerNote = view === 'wizard' && step === 1 ? 'Nothing is saved to your customers until step 4.'
        : step === 2 && unanswered > 0 ? `${unanswered} name${unanswered === 1 ? '' : 's'} left to answer`
        : step === 3 ? (needsBlocked || (data?.blockers || [])[0] || (planning ? 'Saving…' : 'Everything else has a safe default.'))
        : undefined;

    const Steps = () => (
        <ol className="spsi-steps" aria-label="Steps">
            {STEPS.map((s, i) => (
                <li key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
                    {step > i + 1 ? '✓ ' : `${i + 1} `}{s}
                </li>
            ))}
        </ol>
    );

    // ── lists on step 3 ──────────────────────────────────────────────────────
    const listRows = data?.rows?.[tab] || [];
    const pageRows = listRows.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
    const tabs = [
        ['decision', 'Need a decision', counts.decision], ['deleted', 'Deleted before', counts.deleted],
        ['new', 'New', counts.new], ['update', 'Will be updated', (counts.update || 0) + (counts.restore || 0)],
        ['keptDeleted', 'Kept deleted', counts.keptDeleted], ['unchanged', 'No changes', counts.unchanged]
    ].filter(([k, , c]) => c > 0 || k === 'decision' || k === 'new');
    const total = data?.distinct || 0;
    const seg = (c) => `${total ? (c / total) * 100 : 0}%`;

    const planCsv = () => {
        const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [['Row', 'SPS customer', 'Plan'].map(q).join(',')];
        for (const [k, label] of [['new', 'New'], ['update', 'Update'], ['decision', 'Need a decision'], ['deleted', 'Deleted before'], ['keptDeleted', 'Kept deleted'], ['unchanged', 'No changes']]) {
            for (const r of data.rows[k] || []) lines.push([r.rowNumber, r.name, label].map(q).join(','));
        }
        const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'sps-import-plan.csv'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };

    // ── history ──────────────────────────────────────────────────────────────
    if (view === 'history') {
        return (
            <FormModal title="SPS import history" size="l" onClose={onClose} onSubmit={() => setView('wizard')} submitLabel="Back to import" footerNote="Every import, who ran it and whether every customer was accounted for.">
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
                                <button type="button" className="spsi-link" onClick={() => report(r)}>Download report</button>
                                {canDelete && r.status === 'done' && <button type="button" className="spsi-link danger" disabled={busy} onClick={() => undo(r)}>Undo</button>}
                            </div>
                        </div>
                    ))}
                </div>
            </FormModal>
        );
    }

    return (
        <FormModal
            title="Import customers from SPS"
            size="l"
            onClose={onClose}
            onSubmit={submit.run}
            submitLabel={submit.label}
            submitDisabled={submit.disabled}
            hideSubmit={submit.hide}
            saving={busy && step === 3}
            savingLabel="Starting…"
            footerNote={footerNote}
            footerStart={step === 3 && data ? <button type="button" className="spsi-link" onClick={planCsv}><Download size={14} aria-hidden="true" /> Download plan (CSV)</button> : null}
        >
            <div className="spsc">
                <Steps />
                {error && <div className="spsc-banner bad" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {error}</div>}

                {/* ── 1 · Upload ───────────────────────────────────────── */}
                {view === 'loading' && <div className="spsc-muted">Loading…</div>}
                {view === 'wizard' && step === 1 && (
                    <>
                        {resume?.draft && !run && (
                            <div className="spsc-banner info">
                                <span>↺</span>
                                <span><b>You have an import in progress</b>
                                    {resume.draft.fileName} · started {when(resume.draft.createdAt)} · {n(resume.draft.answered)} answers saved.{' '}
                                    <button type="button" className="spsi-link" onClick={continueDraft} disabled={busy}>Continue it</button>{' '}
                                    <button type="button" className="spsi-link danger" onClick={startOver}>Start over</button>
                                </span>
                            </div>
                        )}
                        <button type="button" className="spsc-drop" onClick={() => fileInput.current?.click()} disabled={busy}>
                            <Upload size={20} aria-hidden="true" />
                            <b>{busy ? 'Reading the file…' : run ? run.fileName : 'Choose the SPS customer export'}</b>
                            <span>.xls or .xlsx, exactly as downloaded from SPS</span>
                        </button>
                        <input ref={fileInput} type="file" accept=".xls,.xlsx" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
                        {fileCheck && (
                            <div className="spsi-checks">
                                <div className="sect-title">File check</div>
                                <div className="spsi-check"><span className={`spsi-dot ${fileCheck.ok ? 'ok' : 'bad'}`}>{fileCheck.ok ? '✓' : '!'}</span><span><b>{n(fileCheck.rowsRead)}</b> customers read{fileCheck.ok ? ', every row accounted for' : ''}</span></div>
                                {fileCheck.blocking.map((b) => <div key={b.code} className="spsc-banner bad"><span><b>{b.message}</b>{b.rows?.length ? <> Rows: {b.rows.join(', ')}.</> : null} Nothing has been imported.</span></div>)}
                                {fileCheck.ok && fileCheck.warnings.length === 0 && (
                                    <>
                                        <div className="spsi-check"><span className="spsi-dot ok">✓</span><span>Every row has a customer name</span></div>
                                        <div className="spsi-check"><span className="spsi-dot ok">✓</span><span>No customer name appears twice</span></div>
                                    </>
                                )}
                                {fileCheck.warnings.map((w) => <div key={w.code} className="spsi-check"><span className="spsi-dot warn">!</span><span>{w.message}{w.rows?.length ? ` Rows: ${w.rows.slice(0, 12).join(', ')}${w.rows.length > 12 ? '…' : ''}.` : ''}</span></div>)}
                            </div>
                        )}
                        <button type="button" className="spsi-link" onClick={openHistory}>Import history</button>
                    </>
                )}

                {/* ── 2 · Columns & names ──────────────────────────────── */}
                {view === 'wizard' && step === 2 && data && (
                    <>
                        <div className="spsc-banner ok">
                            <Check size={14} aria-hidden="true" />
                            <span><b>{Object.keys(data.mapping || {}).length} of {Object.keys(FIELD_LABELS).length} columns matched</b>{' '}
                                Detected from the headings. <button type="button" className="spsi-link" onClick={() => setShowMapping((s) => !s)}>{showMapping ? 'Hide' : 'Show all'}</button></span>
                        </div>
                        {showMapping && (
                            <div className="spsi-map">
                                {Object.keys(FIELD_LABELS).map((f) => (
                                    <label key={f} className="spsi-map-row">
                                        <span>{FIELD_LABELS[f]}</span>
                                        <select value={data.mapping?.[f] ?? ''} disabled={planning} onChange={(e) => {
                                            const m = { ...(data.mapping || {}) };
                                            if (e.target.value) m[f] = e.target.value; else delete m[f];
                                            replan(run.id, { mapping: m });
                                        }}>
                                            <option value="">— not imported —</option>
                                            {data.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                                        </select>
                                    </label>
                                ))}
                            </div>
                        )}
                        {data.unresolvedReps.length > 0 && (
                            <div className="spsi-asks">
                                <div className="sect-title">{data.unresolvedReps.length} sales {data.unresolvedReps.length === 1 ? 'person' : 'people'} we don’t recognise</div>
                                {data.unresolvedReps.map((u) => {
                                    const suggestion = (data.reps || []).find((r) => r.name === u.suggestion);
                                    return (
                                        <div key={u.given} className="spsi-ask" onClickCapture={liftRow}>
                                            <div><b>{u.given}</b><div className="spsc-muted">{n(u.rowCount)} customer{u.rowCount === 1 ? '' : 's'}{suggestion ? ` · suggested: ${suggestion.name}` : ''}</div></div>
                                            <RepPicker id={`rep-${u.given}`} value={draft.repAliases[u.given] || ''} onChange={(v) => answer('repAliases', u.given, v)} options={repOptions}
                                                placeholder={suggestion ? `Use ${suggestion.name}?` : 'Choose a rep or “No sales rep”'} you={user?.id || user?._id} error={draft.repAliases[u.given] ? '' : ' '} />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {data.unresolvedBranches.length > 0 && (
                            <div className="spsi-asks">
                                <div className="sect-title">{data.unresolvedBranches.length} branch{data.unresolvedBranches.length === 1 ? '' : 'es'} we don’t recognise</div>
                                {data.unresolvedBranches.map((u) => (
                                    <div key={u.given} className="spsi-ask" onClickCapture={liftRow}>
                                        <div><b>{u.given}</b><div className="spsc-muted">{n(u.rowCount)} customer{u.rowCount === 1 ? '' : 's'}</div></div>
                                        <LocationPicker id={`br-${u.given}`} value={draft.branchAliases[u.given] || ''} onChange={(v) => answer('branchAliases', u.given, v)} options={branchNames}
                                            labelOf={(b) => (b === DEFAULT_BRANCH ? 'Use the default branch' : b)} user={user} placeholder="Choose a branch" error={draft.branchAliases[u.given] ? '' : ' '} />
                                    </div>
                                ))}
                            </div>
                        )}
                        {unanswered === 0
                            ? <div className="spsc-muted">Every name is recognised. Continue to review.</div>
                            : <div className="spsi-room" aria-hidden="true" />}
                    </>
                )}

                {/* ── 3 · Review ───────────────────────────────────────── */}
                {view === 'wizard' && step === 3 && data && (
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
                                <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); pager.resetPage(); }}>{label} {n(c)}</button>
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
                                                <div className="spsi-side"><span className="k">In SPS</span><b>{r.sheet.company}</b>{r.sheet.contactName !== 'N/A' && <span>{r.sheet.contactName}</span>}<span>{r.sheet.phone}</span><span>{r.sheet.email}</span><span className="spsc-muted">{[r.sheet.city, r.sheet.branch, r.sheet.rep].filter(Boolean).join(' · ')}</span></div>
                                                {r.matches.slice(0, 1).map((m) => (
                                                    <div key={m.id} className="spsi-side"><span className="k">In Easy Stones</span><b>{m.company}</b><span className="spsc-muted">{m.label}</span><span className="spsc-muted">{[m.location, m.salesRepName].filter(Boolean).join(' · ')}</span></div>
                                                ))}
                                            </div>
                                            <label className={`spsc-opt${chosen === 'new' ? ' on' : ''}`}><input type="radio" name={`d-${r.key}`} checked={chosen === 'new'} onChange={() => answer('answers', r.key, 'new')} />
                                                <span><b>Add as a new customer</b><span className="spsc-muted"> pre-selected; merge later if it turns out to be the same</span></span></label>
                                            {r.matches.map((m) => (
                                                <label key={m.id} className={`spsc-opt${chosen === m.id ? ' on' : ''}`}><input type="radio" name={`d-${r.key}`} checked={chosen === m.id} onChange={() => answer('answers', r.key, m.id)} />
                                                    <span><b>Same customer: {m.company}</b><span className="spsc-muted"> {m.signals.map((s) => SIGNAL_WORDS[s] || s).join(' · ')} — connect and update</span></span></label>
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
                                            {r.changes?.map((c, i) => <span key={i} className="spsi-chg">{c.field}: <s>{c.from || '—'}</s> → {String(c.to)}</span>)}
                                            {r.warnings?.map((w, i) => <span key={i} className="spsi-warn">⚠ {w}</span>)}
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
                )}

                {/* ── 4 · Import ───────────────────────────────────────── */}
                {view === 'wizard' && step === 4 && (
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
                )}

                {/* ── 5 · Results ──────────────────────────────────────── */}
                {view === 'wizard' && step === 5 && progress && (
                    <>
                        {progress.status === 'failed' && <div className="spsc-banner bad" role="alert"><span><b>The import stopped</b>{progress.error}. What was already written stays; running it again carries on.</span></div>}
                        {progress.verify && (
                            <div className={`spsi-verify ${progress.verify.ok ? 'ok' : 'bad'}`}>
                                <h5>{progress.verify.ok ? '✓ Every SPS customer is accounted for' : `Problem: ${n(progress.verify.missingCount)} SPS customer${progress.verify.missingCount === 1 ? ' is' : 's are'} missing`}</h5>
                                <span className="spsc-muted"><b>{n(progress.verify.present)}</b> of {n(progress.verify.expected)} are in Easy Stones{progress.verify.keptDeleted > 0 && <> and <b>{n(progress.verify.keptDeleted)}</b> stayed deleted as you chose</>}. Each name in the file was looked up after the import. {when(progress.finishedAt)} · by {progress.createdBy}</span>
                                {!progress.verify.ok && (
                                    <>
                                        <ul className="spsi-missing">{progress.verify.missing.slice(0, 20).map((m) => <li key={m.key}><b>{m.name}</b> (row {m.rowNumber}): {m.reason}</li>)}</ul>
                                        <button type="button" className="spsi-btn" onClick={retry} disabled={busy}>Try these again</button>
                                    </>
                                )}
                            </div>
                        )}
                        <div className="spsi-counts">
                            {[['added', 'added'], ['updated', 'updated'], ['restored', 'brought back'], ['keptDeleted', 'kept deleted'], ['unchanged', 'no changes'], ['failed', 'failed']].map(([k, label]) => (
                                <div key={k}><b>{n(progress.results?.[k])}</b><span>{label}</span></div>
                            ))}
                        </div>
                        <div className="spsi-btnrow">
                            <button type="button" className="spsi-btn" onClick={() => report(progress)}><Download size={14} aria-hidden="true" /> Download report</button>
                            <button type="button" className="spsi-btn" onClick={openHistory}>Import history</button>
                            {canDelete && progress.status === 'done' && <button type="button" className="spsi-btn danger" disabled={busy} onClick={() => undo(progress)}>Undo this import</button>}
                            <span className="spsi-grow" />
                            <button type="button" className="spsi-btn gold" onClick={onClose}>Done</button>
                        </div>
                    </>
                )}

                {planning && step !== 1 && <div className="spsc-muted" aria-live="polite">Saving your answer…</div>}
            </div>
        </FormModal>
    );
}
