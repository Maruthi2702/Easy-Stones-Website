import { useEffect, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { groupRepOptions } from '../../utils/salesReps';
import { UNASSIGNED, scopeLocationsOf } from '../../utils/routePlannerScope';
import { hasPoint } from '../../utils/routePlan';
import { KNOWN_TYPES, visitRecency } from './helpers';
import type { CurrentUser, StaffMember } from '../../types/records';
import type { MapPin as Customer, Pin, RecencyKey, RepOption, Toggles } from './types';

// Pure — doesn't close over anything component-specific — so it's hoisted
// here rather than redefined every render inside the hook body, which
// would otherwise need explaining away in every useMemo that calls it.
const repKey = (salesRep: unknown) => String(salesRep || '') || 'unassigned';

export type FilterViewDeps = {
    currentUser: CurrentUser | null;
    myId: string;
    pins: Pin[];
    /** How many customers each rep in scope holds (GET /map/rep-counts). */
    repCounts: Record<string, number>;
    /** The reps this person may see. */
    scopedReps: StaffMember[];
    activeSalesReps: Toggles;
    setActiveSalesReps: Dispatch<SetStateAction<Toggles>>;
    activeTypes: Toggles;
    setActiveTypes: Dispatch<SetStateAction<Toggles>>;
    activeBuckets: Toggles;
};

/**
 * What the Filter's choices show: the customers on the map, the counts beside
 * each row, the rep and type lists, whether anything is filtered out (the
 * funnel's dot), and the All / None switches.
 */
export function useFilterView({
    currentUser, myId, pins, repCounts, scopedReps,
    activeSalesReps, setActiveSalesReps, activeTypes, setActiveTypes, activeBuckets
}: FilterViewDeps) {
    const visible = useMemo((): Customer[] => {
        return pins
            .filter(p => hasPoint(p))
            // Absent-from-activeSalesReps reads as "hidden", the opposite
            // default from activeTypes/activeBuckets below — a rep who
            // hasn't loaded yet (or a colleague never explicitly checked)
            // shouldn't suddenly show up shown by omission the way a brand
            // new customer type should.
            .filter(p => activeSalesReps[repKey(p.salesRep)] === true)
            // Absent-from-activeTypes reads as "shown" (not yet synced, or a
            // type appearing for the first time this render) rather than
            // "hidden" — see the sync effect below for why that's safe.
            .filter(p => activeTypes[p.customerType || '(blank)'] !== false)
            .map(p => ({ ...p, recency: visitRecency(p.lastVisitAt) }))
            .filter(p => activeBuckets[p.recency.key]);
    }, [pins, activeSalesReps, activeTypes, activeBuckets]);

    // The six types customers can be given are always offered, with or without
    // customers loaded (they're also the colour key); any other type found in
    // the data follows, A–Z.
    const types = useMemo((): string[] => {
        const known = new Set(KNOWN_TYPES.map(t => t.toLowerCase()));
        const others = [...new Set(pins.map(p => p.customerType).filter(Boolean) as string[])]
            .filter(t => !known.has(String(t).toLowerCase()))
            .sort();
        return [...KNOWN_TYPES, ...others];
    }, [pins]);

    const counts = useMemo(() => {
        const tally: Record<RecencyKey, number> = { never: 0, overdue: 0, due: 0, recent: 0 };
        pins
            .filter(p => hasPoint(p))
            .filter(p => activeSalesReps[repKey(p.salesRep)] === true)
            .forEach(p => { tally[visitRecency(p.lastVisitAt).key] += 1; });
        return tally;
    }, [pins, activeSalesReps]);

    const typeCounts = useMemo(() => {
        const tally: Record<string, number> = {};
        pins
            .filter(p => hasPoint(p))
            .filter(p => activeSalesReps[repKey(p.salesRep)] === true)
            .forEach(p => {
                const key = p.customerType || '(blank)';
                tally[key] = (tally[key] || 0) + 1;
            });
        return tally;
    }, [pins, activeSalesReps]);

    // The rep picker's rows — every rep this person may see (scopedReps:
    // routePlannerScope.js, the server applies the same rule), whether or not
    // their customers are loaded; repCounts (the server's count per rep) is
    // what each row shows, so unchecking someone leaves their count in place.
    // salesReps supplies the display name for each id.
    // Unassigned first, then reps grouped under their branch with you marked
    // "(you)" — the format every rep dropdown and filter shares
    // (groupRepOptions in src/utils/salesReps.js). `group` is the heading.
    const salesRepOptions = useMemo((): RepOption[] => {
        const reps = scopedReps.map((r: StaffMember) => ({
            value: String(r._id), id: String(r._id), label: r.name || 'Unnamed', location: r.location || ''
        }));
        return [
            ...(repCounts[UNASSIGNED] ? [{ key: UNASSIGNED, label: 'Unassigned', group: null }] : []),
            ...groupRepOptions(reps, { you: myId }).flatMap(g => g.options.map(o => ({ key: o.value, label: o.label, group: g.group })))
        ];
    }, [scopedReps, repCounts, myId]);
    const scopeLocations = useMemo(() => scopeLocationsOf(currentUser), [currentUser]);

    // New types (including '(blank)', once any pin lacks one) default to
    // shown the first time they're seen, without clobbering a toggle the
    // rep already made on an existing one — or a saved preference loaded
    // in useSavedFilters, since that ends up in the same `prev` this reads.
    useEffect(() => {
        // types (above) already filters out falsy customerType — '(blank)'
        // is added back here as its own filterable bucket, matching how
        // pins with no type are treated in `visible`'s filter above.
        const known = [...types, '(blank)'];
        setActiveTypes(prev => {
            const next = { ...prev };
            let changed = false;
            known.forEach(t => {
                if (!(t in next)) { next[t] = true; changed = true; }
            });
            return changed ? next : prev;
        });
    }, [types, setActiveTypes]);

    const toggleAllTypes = (showAll: boolean) => {
        setActiveTypes(prev => {
            const next = { ...prev };
            [...types, '(blank)'].forEach(t => { next[t] = showAll; });
            return next;
        });
    };

    // Drives FilterButton's dot indicator — true once a type has been
    // toggled off, or the rep filter is hiding anyone (true by default,
    // since only "you" are seeded on — see the seed effect in
    // useSavedFilters). Recency already shows its own state elsewhere (the
    // legend's colours), so that dimension stays out of this.
    const filtersActive = useMemo(
        () => [...types, '(blank)'].some(t => activeTypes[t] === false) ||
            salesRepOptions.some(r => activeSalesReps[r.key] !== true),
        [types, activeTypes, salesRepOptions, activeSalesReps]
    );

    const toggleAllSalesReps = (showAll: boolean) => {
        setActiveSalesReps(prev => {
            const next = { ...prev };
            salesRepOptions.forEach(r => { next[r.key] = showAll; });
            return next;
        });
    };

    return { visible, types, counts, typeCounts, salesRepOptions, scopeLocations, filtersActive, toggleAllTypes, toggleAllSalesReps };
}
