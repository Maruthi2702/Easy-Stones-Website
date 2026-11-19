import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import type { LoggedFrom } from '../utils/visitLocation';

/*
 * Where visits and resources were logged (src/utils/visitLocation.ts), for the marks on
 * rows, the Visit view, the Where logged filter and By rep's On site column. The server
 * answers only for readings this person may see (their own, or their team's with "See
 * where visits were logged"), so an id that isn't in the answer simply shows no mark. A
 * reading never changes once saved, so it's kept for the session; an id with no reading is
 * asked about once per screen (a visit still saving isn't asked yet). Long lists go in
 * calls of 500, the server's cap.
 */
const found = new Map<string, LoggedFrom>();
const CHUNK = 500;

type Answer = { locations?: Record<string, LoggedFrom>; byResource?: Record<string, LoggedFrom> };

async function ask(body: { visitIds?: string[]; resourceIds?: string[] }): Promise<Answer> {
    try {
        const res = await authFetch(`${API_URL}/api/visit-locations`, { method: 'POST', body: JSON.stringify(body) });
        return res.ok ? await res.json() : {};
    } catch { return {}; }
}

function useReadings(kind: 'visit' | 'resource', ids: string[], enabled: boolean): Record<string, LoggedFrom> {
    const [, bump] = useState(0);
    const [asked] = useState(() => new Set<string>());
    // Only an unmount stops a request in flight: a changed list must not drop ids already marked as asked.
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);
    const key = ids.join(',');
    const keyOf = (id: string) => `${kind}:${id}`;
    useEffect(() => {
        if (!enabled) return undefined;
        const todo = ids.filter((id) => id && !found.has(keyOf(id)) && !asked.has(keyOf(id)));
        if (!todo.length) return undefined;
        todo.forEach((id) => asked.add(keyOf(id)));
        void (async () => {
            for (let i = 0; i < todo.length; i += CHUNK) {
                const part = todo.slice(i, i + CHUNK);
                const answer = await ask(kind === 'visit' ? { visitIds: part } : { resourceIds: part });
                if (!mounted.current) return;
                const entries = Object.entries((kind === 'visit' ? answer.locations : answer.byResource) || {});
                entries.forEach(([id, reading]) => found.set(keyOf(id), reading));
                if (entries.length) bump((n) => n + 1);
            }
        })();
        return undefined;
        // `key` stands for the list of ids.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, enabled]);
    return Object.fromEntries(ids.filter((id) => found.has(keyOf(id))).map((id) => [id, found.get(keyOf(id)) as LoggedFrom]));
}

/** The readings for these visit ids that the caller may see, by visit id. */
export const useVisitLocations = (visitIds: string[], enabled = true) => useReadings('visit', visitIds, enabled);

/** The same for resources (kept on each one's placement visit), by resource id. */
export const useResourceLocations = (resourceIds: string[], enabled = true) => useReadings('resource', resourceIds, enabled);

/** Test hook: forget what was found. */
export const clearVisitLocations = () => found.clear();
