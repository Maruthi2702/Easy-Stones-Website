/**
 * The Excel import window's state and calls: the picked file, the preview the
 * server plans from it (asked again after every mapping, alias or decision —
 * only the newest answer shows), forgetting saved choices, the apply, and the
 * review list's download. The file is re-posted for the apply rather than the
 * plan being sent back, so nothing edited in the browser chooses what is written.
 */
import type React from 'react';
import { useRef, useState } from 'react';
import { API_URL } from '../../../../config/api';
import { authFetch } from '../../../../api/authFetch';
import type { Loose } from '../../../../types/records';
import { plural, withEntry, importForm, describeFailure, reviewCsvText } from '../excelImport';
import { useDbDuplicates } from './useDbDuplicates';

type Answers = Record<string, string>;
type AnswerKey = 'mapping' | 'repAliases' | 'branchAliases' | 'decisions';

export function useExcelImport({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
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
    const fileRef = useRef<HTMLInputElement | null>(null);
    const previewSeq = useRef(0);
    const dups = useDbDuplicates({ setError, onImported, refresh: () => (file ? runPreview(file) : undefined) });

    const reset = () => {
        setFile(null); setPlan(null); setMapping({}); setRepAliases({});
        setBranchAliases({}); setDecisions({}); setError(''); setResult(null); setTab('update');
        dups.reset();
    };

    const close = () => { reset(); onClose(); };

    /**
     * Ask the server what this file would do. Called again whenever the mapping
     * or an alias changes, because every one of those changes what it would do.
     */
    const runPreview = async (theFile: File, overrides: Partial<Record<AnswerKey, Answers>> = {}) => {
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
        const url = URL.createObjectURL(new Blob([reviewCsvText(plan!.rows || [])], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `customer-import-review-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return {
        file, plan, mapping, repAliases, branchAliases, decisions, busy, error, result, tab, setTab, fileRef,
        close, onPickFile, changeMapping, changeRepAlias, changeBranchAlias, decide, acceptAllReviewAsNew, forgetSaved, apply, downloadReview,
        dups
    };
}

export type ExcelImport = ReturnType<typeof useExcelImport>;
