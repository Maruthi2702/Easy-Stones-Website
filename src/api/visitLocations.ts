import { useEffect, useState } from 'react';
import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import type { LoggedFrom } from '../utils/visitLocation';

/*
 * Where visits and resources were logged (src/utils/visitLocation.ts), for the marks on
 * rows. The server answers only for readings this person may see (their own, or their
 * team's with "See where visits were logged"), so an id that isn't in the answer simply
 * shows no mark. A reading never changes once saved, so it's kept for the session; an id
 * with no reading is asked about once per screen (a visit still saving isn't asked yet).
 */
const found = new Map<string, LoggedFrom>();
const MAX = 500;

type Answer = { locations?: Record<string, LoggedFrom>; byResource?: Record<string, LoggedFrom> };

async function ask(body: { visitIds?: string[]; resourceIds?: string[] }): Promise<Answer> {
    try {
        const res = await authFetch(`${API_URL}/api/visit-locations`, { method: 'POST', body: JSON.stringify(body) });
        return res.ok ? await res.json() : {};
    } catch { return {}; }
}

/** The readings for these visit ids that the caller may see, by visit id. */
export function useVisitLocations(visitIds: string[], enabled = true): Record<string, LoggedFrom> {
    const [, bump] = useState(0);
    const [asked] = useState(() => new Set<string>());
    const key = visitIds.join(',');
    useEffect(() => {
        if (!enabled) return undefined;
        const todo = visitIds.filter((id) => id && !found.has(id) && !asked.has(id)).slice(0, MAX);
        if (!todo.length) return undefined;
        todo.forEach((id) => asked.add(id));
        let live = true;
        void ask({ visitIds: todo }).then((answer) => {
            if (!live) return;
            const entries = Object.entries(answer.locations || {});
            entries.forEach(([id, reading]) => found.set(id, reading));
            if (entries.length) bump((n) => n + 1);
        });
        return () => { live = false; };
        // `key` stands for the list of ids.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, enabled]);
    return Object.fromEntries(visitIds.filter((id) => found.has(id)).map((id) => [id, found.get(id) as LoggedFrom]));
}

/** Test hook: forget what was found. */
export const clearVisitLocations = () => found.clear();
