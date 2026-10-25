/**
 * The SPS import window's state and calls: the draft or running import it
 * opens on, the plan re-asked after every answer (the newest answer wins), the
 * upload, Start, watching the run, Retry, Undo, the report and the history.
 * The server keeps every answer in the draft run, so closing loses nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePagination } from '../../../components/shared/paginationConfig';
import type { RepOption } from '../../../components/shared/form/RepPicker';
import type { Loose } from '../../../types/records';
import { API, call, jsonCall, saveBlob } from './spsImportApi';
import type { CallError } from './spsImportApi';
import { UNASSIGNED as NONE_REP, DEFAULT_BRANCH } from './importFields';
import { n, reviewTabs, firstReviewTab, draftStep, blockedFor, planCsvText } from './spsImport';

/** A draft's answers so far, each a map from the name in the file to the answer. */
export type Draft = { mapping: Record<string, string>; repAliases: Record<string, string>; branchAliases: Record<string, string>; answers: Record<string, string> };
export type DraftKey = 'repAliases' | 'branchAliases' | 'answers';

export type SpsImportDeps = {
    onChanged?: () => void;
    salesReps: Loose[];
    locations: (string | { name?: string })[];
    canEdit: boolean;
    canAdd: boolean;
};

export function useSpsImport({ onChanged, salesReps, locations, canEdit, canAdd }: SpsImportDeps) {
    const [view, setView] = useState('loading');   // loading | wizard | history
    const [step, setStep] = useState(1);
    const [resume, setResume] = useState<Loose | null>(null);    // { draft, running } from /current
    const [run, setRun] = useState<Loose | null>(null);
    const [fileCheck, setFileCheck] = useState<Loose | null>(null);
    const [draft, setDraft] = useState<Draft>({ mapping: {}, repAliases: {}, branchAliases: {}, answers: {} });
    const [data, setData] = useState<Loose | null>(null);        // the plan response
    const [tab, setTab] = useState('decision');
    const [busy, setBusy] = useState(false);
    const [planning, setPlanning] = useState(false);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState<Loose | null>(null);
    const [history, setHistory] = useState<Loose[]>([]);
    const [showMapping, setShowMapping] = useState(false);
    const [viewResult, setViewResult] = useState('');   // step 5: which tile's customers are open
    const [openRun, setOpenRun] = useState<{ id: string; result: string } | null>(null);       // history: { id, result }
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
            } catch (err) { if (alive) setError((err as Error).message); }
            if (alive) setView('wizard');
        })();
        return () => { alive = false; };
    }, []);

    // ── the plan: save what changed, get the whole picture back ─────────────
    const replan = useCallback(async (runId: string, patch: Partial<Draft> = {}): Promise<Loose | null> => {
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
            if (seq === planSeq.current) setError((err as Error).message);
            return null;
        } finally {
            if (seq === planSeq.current) setPlanning(false);
        }
    }, []);
    const draftRef = useRef(draft);
    useEffect(() => { draftRef.current = draft; }, [draft]);

    const answer = (patchKey: DraftKey, key: string, value: string) => {
        const next = { ...draftRef.current[patchKey], [key]: value };
        setDraft((d) => ({ ...d, [patchKey]: next }));
        draftRef.current = { ...draftRef.current, [patchKey]: next };
        replan(run!.id, { [patchKey]: next });
    };
    const answerMany = (entries: Record<string, string>) => {
        const next = { ...draftRef.current.answers, ...entries };
        setDraft((d) => ({ ...d, answers: next }));
        draftRef.current = { ...draftRef.current, answers: next };
        replan(run!.id, { answers: next });
    };

    // ── step 1 ───────────────────────────────────────────────────────────────
    const upload = async (file: File | undefined) => {
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
            setError((err as CallError).message);
            if ((err as CallError).body?.fileCheck) setFileCheck((err as CallError).body!.fileCheck);
            setRun(null);
        } finally { setBusy(false); }
    };
    const continueDraft = async () => {
        setBusy(true); setError('');
        try {
            const d = resume!.draft;
            setRun(d);
            const out = await replan(d.id, {});
            if (out) {
                setFileCheck(out.fileCheck);
                setDraft({ mapping: out.mapping || {}, repAliases: {}, branchAliases: {}, answers: {} });
                setStep(draftStep(out));
            }
        } finally { setBusy(false); }
    };
    const startOver = async () => {
        try { await call(`${API}/${resume!.draft.id}`, { method: 'DELETE' }); } catch { /* already gone */ }
        setResume((r) => ({ ...r, draft: null }));
    };

    // ── step 4: start, then watch ────────────────────────────────────────────
    const startImport = async () => {
        setBusy(true); setError('');
        try {
            const out = await jsonCall(`${API}/${run!.id}/start`);
            setProgress(out.run); setStep(4);
        } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    };
    useEffect(() => {
        if (step !== 4 || !run) return undefined;
        let alive = true;
        const tick = async () => {
            try {
                const out = await (await call(`${API}/${run.id}`)).json();
                if (!alive) return;
                setProgress(out.run);
                if (out.run.status === 'done' || out.run.status === 'failed') {
                    onChanged?.();
                    setViewResult((v) => v || (out.run.results?.added ? 'added' : out.run.results?.updated ? 'updated' : ''));
                    setStep(5);
                }
            } catch { /* keep trying */ }
        };
        const t = setInterval(tick, 1500);
        tick();
        return () => { alive = false; clearInterval(t); };
    }, [step, run, onChanged]);

    // ── step 5 ───────────────────────────────────────────────────────────────
    const retry = async () => {
        setBusy(true); setError('');
        try { await jsonCall(`${API}/${run!.id}/retry`); setStep(4); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    };
    const undo = async (r: Loose) => {
        const warning = `Undo this import?\n\nCustomers it added are removed (each saved first), customers it updated go back to what they were, and customers it brought back are deleted again.`;
        if (!window.confirm(warning)) return;
        setBusy(true); setError('');
        try {
            const out = await jsonCall(`${API}/${r.id}/undo`);
            onChanged?.();
            setError('');
            await openHistory();
            window.alert(`Undone: ${n(out.removed)} removed, ${n(out.reverted)} put back${out.failed?.length ? `, ${out.failed.length} couldn’t be undone` : ''}.`);
        } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    };
    const report = (r: Loose) => saveBlob(`${API}/${r.id}/report.csv`, `sps-import-${r.id.slice(-6)}.csv`).catch((err) => setError(err.message));
    const openHistory = async () => {
        setError('');
        try {
            const out = await (await call(API)).json();
            setHistory(out.runs); setView('history');
        } catch (err) { setError((err as Error).message); }
    };

    // ── derived ──────────────────────────────────────────────────────────────
    const counts: Loose = data?.counts || {};
    const repOptions = useMemo(() => {
        const allowed = new Set((data?.reps || []).map((r: Loose) => String(r._id)));
        const list: RepOption[] = salesReps.filter((r) => !r.inactive && allowed.has(String(r._id)))
            .map((r) => ({ value: String(r._id), label: r.name, location: r.location || '', id: String(r._id) }));
        for (const r of data?.reps || []) if (!list.some((o) => o.value === String(r._id))) list.push({ value: String(r._id), label: r.name, location: '' });
        return [...list, { value: NONE_REP, label: 'No sales rep', location: '' }];
    }, [data, salesReps]);
    const branchNames = useMemo(() => [...(data?.branches || locations.map((l) => (l as { name?: string }).name || l)), DEFAULT_BRANCH], [data, locations]);
    const unanswered = (data?.unresolvedReps?.length || 0) + (data?.unresolvedBranches?.length || 0);
    const needsBlocked = blockedFor(data, canEdit, canAdd);

    // ── the footer button for each step ──────────────────────────────────────
    let submit: { label?: string; run?: () => void; disabled?: boolean; hide?: boolean } = { label: 'Continue', run: () => setStep(2), disabled: true, hide: false };
    if (view === 'wizard') {
        if (step === 1) submit = { label: 'Continue', run: () => setStep(2), disabled: !data || !fileCheck?.ok || busy };
        else if (step === 2) submit = { label: 'Continue', run: () => { setTab(firstReviewTab(counts)); pager.resetPage(); setStep(3); }, disabled: !data || unanswered > 0 || planning };
        else if (step === 3) submit = { label: `Start import`, run: startImport, disabled: !data || (data.blockers || []).length > 0 || !!needsBlocked || planning };
        else submit = { hide: true };
    } else submit = { hide: true };

    const footerNote = view === 'wizard' && step === 1 ? 'Nothing is saved to your customers until step 4.'
        : step === 2 && unanswered > 0 ? `${unanswered} name${unanswered === 1 ? '' : 's'} left to answer`
        : step === 3 ? (needsBlocked || (data?.blockers || [])[0] || (planning ? 'Saving…' : 'Everything else has a safe default.'))
        : undefined;

    // ── lists on step 3 ──────────────────────────────────────────────────────
    const listRows: Loose[] = data?.rows?.[tab] || [];
    const pageRows = listRows.slice((pager.currentPage - 1) * pager.rowsPerPage, pager.currentPage * pager.rowsPerPage);
    const tabs = reviewTabs(counts);
    const pickTab = (k: string) => { setTab(k); pager.resetPage(); };

    const planCsv = () => {
        const blob = new Blob([planCsvText(data!.rows)], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'sps-import-plan.csv'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };

    return {
        view, setView, step, resume, run, fileCheck, draft, data, tab, busy, planning, error, progress, history,
        showMapping, setShowMapping, viewResult, setViewResult, openRun, setOpenRun, pager,
        replan, answer, answerMany, upload, continueDraft, startOver, retry, undo, report, openHistory, planCsv,
        counts, repOptions, branchNames, unanswered, submit, footerNote, listRows, pageRows, tabs, pickTab
    };
}

export type SpsImport = ReturnType<typeof useSpsImport>;
