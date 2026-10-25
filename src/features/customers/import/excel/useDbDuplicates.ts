/**
 * "Possible duplicates already in the database" in the Excel import: per
 * group, which record stays and what happens to each of the others; Apply
 * (POST /api/customers/duplicates/resolve) and its Undo. After either, the
 * preview is asked again so the list reflects the customers as they now stand.
 */
import { useState } from 'react';
import { API_URL } from '../../../../config/api';
import { authFetch } from '../../../../api/authFetch';
import type { Loose } from '../../../../types/records';
import { describeFailure } from '../excelImport';

/** One "possible duplicates already in the database" group from the preview. */
export type DupGroup = { members: (Loose & { id: string; label: string })[]; signals: string[] };
/** A group's choices: the record kept, and what happens to each of the others. */
export type DupChoice = { keepId: string; actions: Record<string, string> };

export type DbDuplicatesDeps = {
    setError: (message: string) => void;
    onImported?: () => void;
    /** Re-runs the preview (when a file is open). */
    refresh: () => Promise<void> | void;
};

export function useDbDuplicates({ setError, onImported, refresh }: DbDuplicatesDeps) {
    // Per duplicate group (keyed by its member ids): which record stays, and
    // what happens to each of the others.
    const [dupChoices, setDupChoices] = useState<Record<string, DupChoice>>({});
    const [dupBusy, setDupBusy] = useState('');
    // The last merge/delete, for its Undo button.
    const [dupResult, setDupResult] = useState<{ message: string; undoIds: string[] } | null>(null);

    const reset = () => { setDupChoices({}); setDupResult(null); };

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
            await refresh();
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
            await refresh();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setDupBusy('');
        }
    };

    return { dupBusy, dupResult, reset, groupKey, choicesFor, setKeep, setDupAction, resolveGroup, undoResolve };
}

export type DbDuplicates = ReturnType<typeof useDbDuplicates>;
