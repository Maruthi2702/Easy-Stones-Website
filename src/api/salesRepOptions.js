import { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import { salesRepNameOptions, branchSalesRepOf, startingRepFor } from '../utils/salesReps';

/*
 * The one staff list behind every sales rep dropdown that saves a name
 * (Selection Sheet, Delivery, Location). Loaded once per page load from
 * /api/salesreps and shared, so each screen shows the same people; who is
 * offered is decided in src/utils/salesReps.js (salesRepNameOptions), the same
 * rule as the customer rep picker (toSalesRepList).
 */

let staff = [];
let loaded = false;
let inflight = null;
const listeners = new Set();
const notify = () => { for (const fn of listeners) fn(); };

// Each branch's sales person (Users & Roles → Locations → Sales defaults).
let branchReps = {};
let branchLoaded = false;
let branchInflight = null;

/** Fetch the list (once, unless force). Resolves when it's in. */
export function loadStaff({ force = false } = {}) {
    if (inflight && !force) return inflight;
    if (loaded && !force) return Promise.resolve(staff);
    const run = (async () => {
        try {
            const res = await authFetch(`${API_URL}/api/salesreps`);
            if (res.ok) {
                const data = await res.json();
                if (inflight === run) {
                    staff = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                    loaded = true;
                }
            }
        } catch (err) {
            console.warn('[salesReps] could not load the staff list:', err);
        } finally {
            if (inflight === run) inflight = null;
            notify();
        }
        return staff;
    })();
    inflight = run;
    return run;
}

/**
 * Options for a sales rep dropdown: `branches` narrows it to people working
 * there ([] = everyone), `current` ({ name, email }) is the rep already saved.
 */
export function useSalesRepOptions({ branches = [], current = {} } = {}) {
    const [, rerender] = useState(0);
    useEffect(() => {
        const fn = () => rerender((n) => n + 1);
        listeners.add(fn);
        loadStaff();
        return () => { listeners.delete(fn); };
    }, []);
    const branchKey = (branches || []).join('\u0000');
    const name = current?.name || '';
    const email = current?.email || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => salesRepNameOptions(staff, { branches, current: { name, email } }), [staff, branchKey, name, email]);
}

/** Fetch { [branch]: sales person } (once, unless force). */
export function loadBranchReps({ force = false } = {}) {
    if (branchInflight && !force) return branchInflight;
    if (branchLoaded && !force) return Promise.resolve(branchReps);
    const run = (async () => {
        try {
            const res = await authFetch(`${API_URL}/api/admin/locations`);
            if (res.ok) {
                const data = await res.json();
                if (branchInflight === run && Array.isArray(data)) {
                    branchReps = Object.fromEntries(data.filter((l) => l?.name).map((l) => [l.name, branchSalesRepOf(l)]));
                }
            }
        } catch (err) {
            console.warn('[salesReps] could not load the branches\' sales people:', err);
        } finally {
            // Loaded (or given up) either way, so a form waiting on it moves on.
            if (branchInflight === run) { branchInflight = null; branchLoaded = true; }
            notify();
        }
        return branchReps;
    })();
    branchInflight = run;
    return run;
}

/**
 * For a new customer / delivery: { repFor(branch), ready }. repFor gives the
 * staff record of who it starts with (startingRepFor: the creator if they're
 * a sales rep, else the branch's sales person) or null; `ready` once both
 * lists are in, so a form only fills it in when the answer is final.
 */
export function useStartingRep(creator) {
    const [, rerender] = useState(0);
    useEffect(() => {
        const fn = () => rerender((n) => n + 1);
        listeners.add(fn);
        loadStaff();
        loadBranchReps();
        return () => { listeners.delete(fn); };
    }, []);
    const creatorId = String(creator?._id || creator?.id || '');
    const ready = loaded && branchLoaded;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const repFor = useMemo(() => (branch) => startingRepFor({ staff, branch, branchReps, creator: creatorId ? { id: creatorId } : null }), [staff, branchReps, creatorId]);
    return { repFor, ready };
}
