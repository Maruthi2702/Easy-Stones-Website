import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import type { AsOf } from '../utils/salesGoals';

/*
 * Sales goals (src/utils/salesGoals.ts, src/routes/salesGoals.ts). The server sends only the
 * people the signed-in person may see — a rep's own row, a team's with Team goals — so nothing
 * here decides who sees what. Money is whole cents; null is "no goal" / "nothing reported".
 */
export type GoalPerson = {
    id: string;
    name: string;
    branch: string;
    you: boolean;
    inactive: boolean;
    goalCents: (number | null)[];
    salesCents: (number | null)[];
};

export type GoalsAnswer = {
    year: number;
    years: number[];
    asOf: AsOf;
    canSet: boolean;
    canViewTeam: boolean;
    people: GoalPerson[];
    /** SPS report sales persons that match no staff member (only sent to someone who sets goals). */
    unmatchedReps?: { name: string; salesCents: number }[];
};

export type UseSalesGoals = {
    data: GoalsAnswer | null;
    loading: boolean;
    error: string;
    reload: () => void;
    /** Swap one person's row after they were saved, without asking again. */
    patchPerson: (person: GoalPerson) => void;
};

/** The year's goals for everyone the viewer may see. `year` null asks for this year. Keeps the last answer while a new year loads. */
export function useSalesGoals(year: number | null, enabled = true): UseSalesGoals {
    const [data, setData] = useState<GoalsAnswer | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        setLoading(true);
        setError('');
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/sales-goals${year ? `?year=${year}` : ''}`);
                const body = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (!res.ok) { setError(body?.message || 'Could not load sales goals.'); return; }
                setData(body as GoalsAnswer);
            } catch {
                if (!cancelled) setError('Could not load sales goals.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [year, enabled, tick]);

    const reload = useCallback(() => setTick((t) => t + 1), []);
    const patchPerson = useCallback((person: GoalPerson) => {
        setData((d) => (d ? { ...d, people: d.people.map((p) => (p.id === person.id ? person : p)) } : d));
    }, []);
    return { data, loading, error, reload, patchPerson };
}

/** Saves one person's year: twelve dollar amounts, blank = no goal. Throws the server's message when refused. */
export async function saveSalesGoals(userId: string, year: number, months: (number | string | null)[]): Promise<GoalPerson> {
    const res = await authFetch(`${API_URL}/api/sales-goals/${userId}?year=${year}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || 'Could not save the goals.');
    return body.person as GoalPerson;
}

/** What the rep file ("Sales by Primary Sales Rep - Monthly") holds, and which of its names match staff. Nothing is written. */
export type RepSalesPreview = {
    year: number;
    reps: number;
    totalCents: number;
    noRepCents: number;
    matched: { name: string; key: string; cents: number; userId: string; userName: string }[];
    unmatched: { name: string; key: string; cents: number }[];
    earlier: { importedAt: string; reps: number } | null;
};
export type RepSalesDone = {
    year: number;
    reps: number;
    rows: number;
    linked: number;
    totalCents: number;
    matched: number;
    unmatched: { name: string; cents: number }[];
};

const postSales = async (path: 'preview' | 'import', body: unknown) => {
    const res = await authFetch(`${API_URL}/api/sales-goals/sales/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out?.message || `The server refused it (HTTP ${res.status}).`);
    return out;
};
export const previewRepSales = (rows: unknown[][]): Promise<RepSalesPreview> => postSales('preview', { rows });
export const importRepSales = (body: { rows: unknown[][]; fileName: string; exportedOn: string; links: Record<string, string> }): Promise<RepSalesDone> => postSales('import', body);
