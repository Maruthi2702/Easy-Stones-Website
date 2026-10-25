import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import type { Loose } from '../../types/records';
import type { Pin, Toggles } from './types';

export type MapPinsDeps = {
    /** This page is the one on screen. */
    isActive: boolean;
    /** The Filter's rep ticks: only the checked reps' customers are loaded. */
    activeSalesReps: Toggles;
    /** The saved rep ticks have loaded — nothing is fetched before. */
    repsReady: boolean;
    setError: (message: string) => void;
};

/**
 * The customers on the map. Only the checked reps' customers are loaded
 * (GET /api/customers/map?reps=…), and the server only ever answers for reps
 * this person may see (src/utils/routePlannerScope.js). Ticking a rep fetches
 * just that rep's customers, once; unticking only hides them. Also the rep
 * filter's counts (GET /api/customers/map/rep-counts), and the contact details
 * fetched when a customer is opened.
 */
export function useMapPins({ isActive, activeSalesReps, repsReady, setError }: MapPinsDeps) {
    const [pins, setPins] = useState<Pin[]>([]);
    const [loading, setLoading] = useState(true);

    // A pin is slim (src/routes/customerMap.js): phone, email, address, notes… are
    // fetched when a customer is opened, and kept for the next time (cleared by
    // load(), since an edit elsewhere changes them).
    const detailsCache = useRef(new Map<string, Loose>());

    // `replace` throws away what is held and starts over; an answer that
    // arrives after a newer replace is dropped.
    const loadEpoch = useRef(0);
    const loadedRepsRef = useRef(new Set<string>());
    const wantedRepKeys = useMemo(
        () => Object.keys(activeSalesReps).filter(k => activeSalesReps[k] === true).sort(),
        [activeSalesReps]
    );
    const wantedRepKeysRef = useRef(wantedRepKeys);
    useEffect(() => { wantedRepKeysRef.current = wantedRepKeys; }, [wantedRepKeys]);

    const [repCountsAll, setRepCountsAll] = useState<Record<string, number>>({});

    const fetchPins = useCallback(async (keys: string[], replace: boolean) => {
        const epoch = replace ? ++loadEpoch.current : loadEpoch.current;
        if (replace) loadedRepsRef.current = new Set(keys);
        else keys.forEach(k => loadedRepsRef.current.add(k));
        if (keys.length === 0) {
            if (replace) { setPins([]); setLoading(false); }
            return;
        }
        setLoading(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/map?reps=${encodeURIComponent(keys.join(','))}`);
            if (!res.ok) throw new Error(`Map data unavailable (${res.status})`);
            const data = await res.json();
            if (epoch !== loadEpoch.current) return;
            const got: Pin[] = Array.isArray(data) ? data : [];
            setPins(prev => {
                if (replace) return got;
                const have = new Set(prev.map(p => p._id));
                return [...prev, ...got.filter(p => !have.has(p._id))];
            });
        } catch (err) {
            if (epoch !== loadEpoch.current) return;
            keys.forEach(k => loadedRepsRef.current.delete(k));
            setError((err as Error).message || 'Could not load customer locations');
        } finally {
            if (epoch === loadEpoch.current) setLoading(false);
        }
    }, [setError]);

    const loadRepCounts = useCallback(async () => {
        try {
            const res = await authFetch(`${API_URL}/api/customers/map/rep-counts`);
            if (res.ok) setRepCountsAll(await res.json());
        } catch {
            /* the rep rows just show no counts */
        }
    }, []);

    const pinById = useMemo(() => new Map(pins.map(p => [String(p._id), p])), [pins]);

    // Everything currently checked, again — after a customer is added or deleted.
    const load = useCallback(async () => {
        detailsCache.current.clear();
        await Promise.all([fetchPins(wantedRepKeysRef.current, true), loadRepCounts()]);
    }, [fetchPins, loadRepCounts]);

    // Keyed on isActive, not just mount: this view stays mounted-but-hidden
    // while another tab is open (see the comment on its usage in
    // SalesTabViews.tsx — avoids re-billing a Google Maps load), so a plain
    // mount-only fetch would leave every pin frozen at whatever `pins` was
    // the last time this tab was visible — an edit made elsewhere (Customers
    // tab, a visit/resource save) would never show up here short of a full
    // page reload. Refetching every time the tab becomes active again keeps
    // it current without needing every other screen to know this one exists.
    // Waits for the saved rep filter to load first (repsReady), or the
    // first load would fetch everyone and then hide most of it.
    useEffect(() => {
        if (isActive && repsReady) load();
    }, [isActive, repsReady, load]);

    // A rep ticked since: fetch just their customers.
    useEffect(() => {
        if (!isActive || !repsReady) return;
        const need = wantedRepKeys.filter(k => !loadedRepsRef.current.has(k));
        if (need.length) fetchPins(need, false);
    }, [isActive, repsReady, wantedRepKeys, fetchPins]);

    return {
        pins, setPins, loading,
        /** How many customers each rep in scope holds, loaded or not (the server counts them). */
        repCounts: repCountsAll,
        pinById,
        load,
        detailsCache
    };
}
