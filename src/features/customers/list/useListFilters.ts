// The Customers list's paging, its pickers' choices, and its filters.
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_ROWS_PER_PAGE } from '../../../components/shared/paginationConfig';
import { useLocationsFilter } from '../../../components/shared/useLocationFilter';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { toSalesRepList } from '../../../utils/salesReps';
import { scopedFilterOptions as scopedFilterOptionsJs, groupRepsByLocation } from '../../../utils/customerList';
import { UNASSIGNED } from './listOptions';
import type { FilterGroup } from './parts';
import type { Loose } from '../../../types/records';

// customerList.js is server-loaded JavaScript; its shape, as this screen reads it.
const scopedFilterOptions = scopedFilterOptionsJs as unknown as (args: { user: unknown; salesReps: Loose[]; locations: string[] }) => { scope: string; reps: Loose[]; locations: string[] };

const pageInUrl = () => parseInt(new URLSearchParams(window.location.search).get('p') as string, 10) || 1;

/** Page (kept in the URL's ?p=), rows per page and sort. */
export function useListPaging(canProfile: boolean) {
    const [currentPage, setCurrentPage] = useState(pageInUrl);
    const [limit, setLimit] = useState(DEFAULT_ROWS_PER_PAGE);
    const [sortBy, setSortBy] = useState(canProfile ? 'level' : 'company');
    const [sortOrder, setSortOrder] = useState('asc');

    useEffect(() => {
        const newUrl = new URL(window.location as unknown as URL);
        newUrl.searchParams.set('p', currentPage as unknown as string);
        window.history.replaceState(window.history.state, '', newUrl);
    }, [currentPage]);

    useEffect(() => {
        const handlePopState = () => setCurrentPage(pageInUrl());
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    return { currentPage, setCurrentPage, limit, setLimit, sortBy, setSortBy, sortOrder, setSortOrder };
}
export type ListPaging = ReturnType<typeof useListPaging>;

/** Pickers: cities, the staff who can own an account, and the branches. */
export function useListPickers() {
    const [uniqueCities, setUniqueCities] = useState<string[]>([]);
    const [salesReps, setSalesReps] = useState<Loose[]>([]);
    const [locations, setLocations] = useState<string[]>([]);
    useEffect(() => {
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/customers/cities`);
                if (res.ok) setUniqueCities((await res.json()) || []);
            } catch (err) { console.error('Error fetching unique cities:', err); }
        })();
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/salesreps`);
                if (res.ok) setSalesReps(toSalesRepList(await res.json()));
            } catch (err) { console.error('Error fetching sales reps:', err); }
        })();
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/admin/locations`);
                if (!res.ok) return;
                const data = await res.json();
                setLocations((data || []).map((l: Loose) => l.name).filter(Boolean));
            } catch (err) { console.error('Error fetching locations:', err); }
        })();
    }, []);
    return { uniqueCities, salesReps, locations };
}

/** The filters. Saved views and the A–Z letter are presets on top of these. */
export function useListFilters(user: Loose | null, salesReps: Loose[], locations: string[]) {
    const [filterLevels, setFilterLevels] = useState<string[]>([]);
    const [filterTypes, setFilterTypes] = useState<string[]>([]);
    const [filterCities, setFilterCities] = useState<string[]>([]);
    const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
    const [filterSalesReps, setFilterSalesReps] = useState<string[]>([]);
    const [filterModa, setFilterModa] = useState<string[]>([]);
    const [view, setView] = useState('');
    const [letter, setLetter] = useState('');

    // What this person is offered in the Rep and Location filters (by the
    // Visits view rule) — not what they're allowed to see; the list isn't scoped.
    const scoped = useMemo(() => scopedFilterOptions({ user, salesReps, locations }), [user, salesReps, locations]);
    // Opens with just their home location ticked ([] = every location), like
    // every other location filter — see useLocationFilter.js.
    const [filterLocations, setFilterLocations] = useLocationsFilter('customerList', user, scoped.locations);
    const repOptions: FilterGroup[] = useMemo(() => [
        { group: null, options: [{ value: UNASSIGNED, label: 'Unassigned' }] },
        ...groupRepsByLocation(scoped.reps).map(g => ({
            group: g.location,
            options: g.reps.map((r: Loose) => ({ value: r._id, label: String(r._id) === String(user?.id) ? `${r.name} (you)` : r.name }))
        }))
    ], [scoped.reps, user?.id]);
    const repNote = scoped.scope === 'all' ? null : 'Only the reps your role can see are listed.';
    const locationNote = scoped.scope === 'all' ? null : 'Only the locations you have access to in Users & Roles are listed.';

    const activeFilterCount = filterLevels.length + filterTypes.length + filterCities.length + filterStatuses.length
        + filterSalesReps.length + filterLocations.length + filterModa.length + (letter ? 1 : 0);

    return {
        filterLevels, setFilterLevels, filterTypes, setFilterTypes, filterCities, setFilterCities,
        filterStatuses, setFilterStatuses, filterSalesReps, setFilterSalesReps, filterLocations, setFilterLocations,
        filterModa, setFilterModa, view, setView, letter, setLetter,
        scoped, repOptions, repNote, locationNote, activeFilterCount
    };
}
export type ListFilters = ReturnType<typeof useListFilters>;
