import { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import { salesRepNameOptions, branchSalesRepOf, startingRepFor } from '../utils/salesReps';
import type { LocationRecord, StaffMember } from '../types/records';

/*
 * The one staff list behind every sales rep dropdown that saves a name
 * (Selection Sheet, Delivery, Location). Loaded once per page load from
 * /api/salesreps and shared, so each screen shows the same people; who is
 * offered is decided in src/utils/salesReps.js (salesRepNameOptions), the same
 * rule as the customer rep picker (toSalesRepList).
 */

let staff: StaffMember[] = [];
let loaded = false;
let inflight: Promise<StaffMember[]> | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const fn of listeners) fn(); };

// Each branch's sales person (Users & Roles → Locations → Sales defaults).
let branchReps: Record<string, string> = {};
let branchLoaded = false;
let branchInflight: Promise<Record<string, string>> | null = null;

/** Fetch the list (once, unless force). Resolves when it's in. */
export function loadStaff({ force = false }: { force?: boolean } = {}): Promise<StaffMember[]> {
    if (inflight && !force) return inflight;
    if (loaded && !force) return Promise.resolve(staff);
    // Named, then called: `run` is read inside, after it has been assigned.
    const load = async (): Promise<StaffMember[]> => {
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
    };
    const run = load();
    inflight = run;
    return run;
}

/**
 * Options for a sales rep dropdown: `branches` narrows it to people working
 * there ([] = everyone), `current` ({ name, email }) is the rep already saved.
 */
export function useSalesRepOptions({ branches = [], current = {} }: { branches?: string[]; current?: { name?: string; email?: string } } = {}) {
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
export function loadBranchReps({ force = false }: { force?: boolean } = {}): Promise<Record<string, string>> {
    if (branchInflight && !force) return branchInflight;
    if (branchLoaded && !force) return Promise.resolve(branchReps);
    const load = async (): Promise<Record<string, string>> => {
        try {
            const res = await authFetch(`${API_URL}/api/admin/locations`);
            if (res.ok) {
                const data = await res.json();
                if (branchInflight === run && Array.isArray(data)) {
                    branchReps = Object.fromEntries((data as LocationRecord[]).filter((l) => l?.name).map((l) => [l.name, branchSalesRepOf(l)]));
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
    };
    const run = load();
    branchInflight = run;
    return run;
}

/**
 * For a new customer / delivery: { repFor(branch), ready }. repFor gives the
 * staff record of who it starts with (startingRepFor: the creator if they're
 * a sales rep, else the branch's sales person) or null; `ready` once both
 * lists are in, so a form only fills it in when the answer is final.
 */
export function useStartingRep(creator: { _id?: string; id?: string } | null | undefined) {
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
    const repFor = useMemo(() => (branch: string) => startingRepFor({ staff, branch, branchReps, creator: creatorId ? { id: creatorId } : null }), [staff, branchReps, creatorId]);
    return { repFor, ready };
}
