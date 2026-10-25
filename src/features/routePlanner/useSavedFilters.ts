import { useState, useEffect, useCallback, useRef } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { PIN_COLOR_MODES } from './helpers';
import type { CurrentUser, StaffMember } from '../../types/records';
import type { ColorMode, Toggles } from './types';

/** The Route Planner's saved filters on the user record (PUT /api/user/me/route-planner-filters). */
type SavedFilters = { activeSalesReps?: Toggles | null; activeTypes?: Toggles | null; activeBuckets?: Toggles | null; pinColors?: { mode?: string } };
const savedFiltersOf = (user: CurrentUser | null) => user?.routePlannerFilters as SavedFilters | undefined;

export type SavedFiltersDeps = {
    currentUser: CurrentUser | null;
    myId: string;
    /** The whole roster (an admin starts with every rep on). */
    salesReps: StaffMember[];
    /** The reps this person may see (a manager starts with these on). */
    scopedReps: StaffMember[];
};

/**
 * The Filter's four choices — which reps, which customer types, which visit
 * ages, and what the pins' colour means — loaded once from the user record
 * and saved back on every real change (PUT /api/user/me/route-planner-filters).
 * Saved filters load once and save only on a real change (`saveFilter`):
 * saving the empty starting value before the real one loaded is what used to
 * reset the rep ticks on every open.
 */
export function useSavedFilters({ currentUser, myId, salesReps, scopedReps }: SavedFiltersDeps) {
    // Keyed by sales rep id (or 'unassigned'), same on/off shape as
    // activeTypes/activeBuckets — replaces the old boolean mineOnly, which
    // could only ever mean "just me" or "everyone" and had no way to show,
    // say, two reps covering the same territory. Seeded to "just me" the
    // first time myId/salesReps are known (see the sync effect below), so
    // the default behaviour is unchanged even though the model isn't.
    const [activeSalesReps, setActiveSalesReps] = useState<Toggles>({});
    // Which of the three saved filters have been loaded (seeded) yet. State,
    // not a ref, so a save effect sees "ready" only in the render where the
    // loaded value is already in place: with a ref, the save ran in the same
    // pass as the seed, wrote the empty starting value, and raced the real one
    // to the server, so a reopen often came back reset.
    const [filtersReady, setFiltersReady] = useState({ reps: false, types: false, buckets: false, colors: false });
    const markReady = useCallback((key: keyof typeof filtersReady) => setFiltersReady(prev => (prev[key] ? prev : { ...prev, [key]: true })), []);
    // The last value each filter saved (JSON), so loading one doesn't save it
    // straight back and only a real change goes to the server.
    const savedFilterJson = useRef<Record<string, string>>({});
    const saveFilter = useCallback((key: string, value: unknown) => {
        const json = JSON.stringify(value);
        if (savedFilterJson.current[key] === json) return;
        savedFilterJson.current[key] = json;
        authFetch(`${API_URL}/api/user/me/route-planner-filters`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: value })
        }).catch(() => {
            // Best-effort — losing a saved filter preference isn't worth
            // surfacing an error over; the in-session toggle still works.
        });
    }, []);
    const [activeBuckets, setActiveBuckets] = useState<Toggles>({ never: true, overdue: true, due: true, recent: true });
    // Multi-select, not the single dropdown value this replaced — every type
    // (plus the synthetic '(blank)' bucket for pins with none set) defaults
    // to shown, same on/off-per-key shape as activeBuckets above. Synced from
    // `types` (useFilterView) as new ones appear, since that list is
    // data-driven and can't be known up front.
    const [activeTypes, setActiveTypes] = useState<Toggles>({});
    // What the pins' colour means — the customer's type or how long since the
    // last visit (the Filter's "Type colours | Visit colours" switch). Saved
    // with the other filters; type until someone chooses otherwise.
    const [colorMode, setColorMode] = useState<ColorMode>('type');

    // Seeds the rep filter once, without clobbering a toggle the rep already
    // made this session (filtersSeededRef guards that, same intent as the
    // `key in prev` check the old version used). A saved preference
    // (currentUser.routePlannerFilters, set by the PUT below) wins when one
    // exists; otherwise the default is role-based rather than uniformly
    // "just me", since an admin or manager landing on an empty map with
    // nothing checked reads as broken, not as a starting point to build from:
    //   - admin: every rep on
    //   - manager/director: every rep sharing one of their assignedLocations
    //     (falling back to `location` for a rep with none recorded)
    //   - sales_rep (or anyone else): just themselves, the prior default
    // Admin/manager both need the full roster, not just salesRepOptions
    // (which only lists reps with a pin on the map right now), so this waits
    // on `salesReps` before computing those two branches.
    const filtersSeededRef = useRef(false);
    useEffect(() => {
        if (filtersSeededRef.current || !myId) return;

        // undefined/null means "never saved one" (a brand-new user's
        // routePlannerFilters is just {}) — distinct from a saved, empty {}
        // meaning "I want nobody checked", which must not fall through to
        // the role default below.
        const saved = savedFiltersOf(currentUser)?.activeSalesReps;
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
            savedFilterJson.current.activeSalesReps = JSON.stringify(saved);
            // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved value, loaded once (the seed effects' whole job)
            setActiveSalesReps(saved);
            filtersSeededRef.current = true;
            markReady('reps');
            return;
        }

        const role = String(currentUser?.role || '').toLowerCase();
        if (role === 'admin') {
            if (salesReps.length === 0) return; // wait for the roster
            // 'unassigned' isn't a real staff member so it never appears in
            // salesReps — included explicitly, since "all reps" for an admin
            // should mean every pin, not every pin with an owner.
            const next: Toggles = { unassigned: true };
            salesReps.forEach(r => { next[String(r._id)] = true; });
            setActiveSalesReps(next);
            filtersSeededRef.current = true;
            markReady('reps');
        } else if (role === 'manager' || role === 'director') {
            if (salesReps.length === 0) return; // wait for the roster
            // Every rep at their locations — scopedReps is exactly that list.
            const next: Toggles = { [myId]: true }; // never hide the manager's own accounts
            scopedReps.forEach((r: StaffMember) => { next[String(r._id)] = true; });
            setActiveSalesReps(next);
            filtersSeededRef.current = true;
            markReady('reps');
        } else {
            setActiveSalesReps(prev => (myId in prev ? prev : { ...prev, [myId]: true }));
            filtersSeededRef.current = true;
            markReady('reps');
        }
    }, [myId, currentUser, salesReps, scopedReps, markReady]);

    // Persists every change back to the user's record so the next visit
    // loads it instead of recomputing the role default — immediately, not
    // debounced (a refresh right after toggling must not lose it), and only
    // once the saved value has loaded (filtersReady above).
    useEffect(() => {
        if (!filtersReady.reps || !myId) return;
        saveFilter('activeSalesReps', activeSalesReps);
    }, [activeSalesReps, myId, filtersReady.reps, saveFilter]);

    // The pins' colour mode: loaded once, saved on change.
    const colorsSeededRef = useRef(false);
    useEffect(() => {
        if (colorsSeededRef.current || !myId) return;
        const saved = savedFiltersOf(currentUser)?.pinColors?.mode;
        if (PIN_COLOR_MODES.includes(saved as string)) {
            savedFilterJson.current.pinColors = JSON.stringify({ mode: saved });
            // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved value, loaded once (the seed effects' whole job)
            setColorMode(saved as ColorMode);
        }
        colorsSeededRef.current = true;
        markReady('colors');
    }, [myId, currentUser, markReady]);
    useEffect(() => {
        if (!filtersReady.colors || !myId) return;
        saveFilter('pinColors', { mode: colorMode });
    }, [colorMode, myId, filtersReady.colors, saveFilter]);

    // Loads a saved Customer Type filter once, same "don't clobber an
    // in-session toggle" guard as the sales-rep seed effect. Unlike that one
    // there's no role-based default to compute — when nothing's saved yet,
    // the sync effect (useFilterView) already defaults every type to shown.
    const typesSeededRef = useRef(false);
    useEffect(() => {
        if (typesSeededRef.current || !myId) return;
        const saved = savedFiltersOf(currentUser)?.activeTypes;
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
            savedFilterJson.current.activeTypes = JSON.stringify(saved);
            // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved value, loaded once (the seed effects' whole job)
            setActiveTypes(saved);
        }
        typesSeededRef.current = true;
        markReady('types');
    }, [myId, currentUser, markReady]);

    // Persists every change, same immediate (non-debounced) save as the
    // sales-rep filter and for the same reason — a refresh shortly after
    // toggling must not lose it.
    useEffect(() => {
        if (!filtersReady.types || !myId) return;
        saveFilter('activeTypes', activeTypes);
    }, [activeTypes, myId, filtersReady.types, saveFilter]);

    // Days Since Last Visit filter — same load-once / save-immediately pair
    // as Customer Type above. No sync-new-buckets effect needed here, since
    // the four recency buckets are fixed (never/overdue/due/recent), not
    // data-driven like customer types.
    const bucketsSeededRef = useRef(false);
    useEffect(() => {
        if (bucketsSeededRef.current || !myId) return;
        const saved = savedFiltersOf(currentUser)?.activeBuckets;
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
            savedFilterJson.current.activeBuckets = JSON.stringify(saved);
            // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved value, loaded once (the seed effects' whole job)
            setActiveBuckets(saved);
        }
        bucketsSeededRef.current = true;
        markReady('buckets');
    }, [myId, currentUser, markReady]);

    useEffect(() => {
        if (!filtersReady.buckets || !myId) return;
        saveFilter('activeBuckets', activeBuckets);
    }, [activeBuckets, myId, filtersReady.buckets, saveFilter]);

    const toggleType = (type: string) => {
        setActiveTypes(prev => ({ ...prev, [type]: prev[type] === false }));
    };

    const toggleBucket = (key: string) => setActiveBuckets(prev => ({ ...prev, [key]: !prev[key] }));

    const toggleSalesRep = (key: string) => {
        setActiveSalesReps(prev => ({ ...prev, [key]: !prev[key] }));
    };

    return {
        activeSalesReps, setActiveSalesReps, activeTypes, setActiveTypes, activeBuckets, colorMode, setColorMode,
        /** The saved rep ticks have loaded (the map waits for them before loading pins). */
        repsReady: filtersReady.reps,
        toggleType, toggleBucket, toggleSalesRep
    };
}

export type SavedFiltersState = ReturnType<typeof useSavedFilters>;
