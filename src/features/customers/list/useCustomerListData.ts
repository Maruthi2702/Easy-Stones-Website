// The Customers list's rows: the query its filters make, loading a page (with
// the in-memory cache and a guard against stale answers), the saved views'
// counts, and the search box's debounce.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { globalPartnersCache, clearListCache } from './listOptions';
import type { ListFilters } from './useListFilters';
import type { Loose } from '../../../types/records';

export type ListQueryDeps = {
    activeTab: string;
    filters: ListFilters;
    sortBy: string;
    sortOrder: string;
    currentPage: number;
    setCurrentPage: Dispatch<SetStateAction<number>>;
    limit: number;
    customerRefreshTrigger?: number;
};

export function useCustomerListData({ activeTab, filters, sortBy, sortOrder, currentPage, setCurrentPage, limit, customerRefreshTrigger }: ListQueryDeps) {
    const { filterLevels, filterTypes, filterCities, filterStatuses, filterSalesReps, filterLocations, filterModa, view, letter } = filters;
    const [partners, setPartners] = useState<Loose[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
    const [countsNonce, setCountsNonce] = useState(0);

    // ── Query ────────────────────────────────────────────────────────────────
    const listParams = useCallback(() => {
        const p: Record<string, string> = { sortBy, sortOrder };
        if (debouncedSearch) p.search = debouncedSearch;
        if (filterLevels.length) p.level = filterLevels.join(',');
        if (filterTypes.length) p.type = filterTypes.join(',');
        if (filterCities.length) p.city = filterCities.join(',');
        if (filterStatuses.length) p.status = filterStatuses.join(',');
        if (filterSalesReps.length) p.salesRep = filterSalesReps.join(',');
        if (filterLocations.length) p.location = filterLocations.join(',');
        if (filterModa.length) p.moda = filterModa.join(',');
        if (view) p.view = view;
        if (letter) p.letter = letter;
        // The tab scopes the list, except while searching (a search finds the
        // customer whichever tab it's on) or when types were picked explicitly.
        if (!debouncedSearch && !filterTypes.length) {
            if (activeTab === 'fabricators') p.type = 'Fabricator';
            else p.typeExclude = 'Fabricator';
        }
        return p;
    }, [sortBy, sortOrder, debouncedSearch, filterLevels, filterTypes, filterCities, filterStatuses, filterSalesReps, filterLocations, filterModa, view, letter, activeTab]);

    const urlFor = (params: Record<string, unknown>) => {
        const url = new URL(`${API_URL}/api/customers/list`, window.location.origin);
        Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v as string));
        return url;
    };

    const requestSeq = useRef(0);
    const fetchPartners = useCallback(async ({ skipCache = false } = {}) => {
        const params = { ...listParams(), page: currentPage, limit };
        const cacheKey = JSON.stringify(params);
        const seq = ++requestSeq.current;
        const cached = globalPartnersCache[cacheKey];
        if (cached) {
            setPartners(cached.partners || []);
            setTotalPages(cached.totalPages || 1);
            setTotalCount(cached.totalCount || 0);
            setLoading(false);
            if (!skipCache) return;
        } else {
            setLoading(true);
        }
        try {
            const response = await authFetch(urlFor(params) as unknown as string);
            if (seq !== requestSeq.current) return; // a newer request has started; ignore this one
            if (response.ok) {
                const data = await response.json();
                if (seq !== requestSeq.current) return;
                globalPartnersCache[cacheKey] = data;
                setPartners(data.partners || []);
                setTotalPages(data.totalPages || 1);
                setTotalCount(data.totalCount || 0);
                setLoadError('');
            } else {
                setLoadError('Could not load customers. Try again.');
            }
        } catch (error) {
            console.error('Error fetching partners:', error);
            if (seq === requestSeq.current) setLoadError('Could not load customers. Check your connection and try again.');
        } finally {
            if (seq === requestSeq.current) setLoading(false);
        }
    }, [listParams, currentPage, limit]);

    useEffect(() => { fetchPartners(); }, [fetchPartners, customerRefreshTrigger]);

    const refreshAll = useCallback(() => {
        clearListCache();
        setCountsNonce(n => n + 1);
        fetchPartners({ skipCache: true });
    }, [fetchPartners]);

    // A change made elsewhere (the profile's status picker) while this list sits
    // mounted-but-hidden behind it would otherwise come back from the cache stale.
    useEffect(() => {
        window.addEventListener('customers:changed', refreshAll);
        return () => window.removeEventListener('customers:changed', refreshAll);
    }, [refreshAll]);

    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/customers/view-counts?tab=${activeTab}`);
                if (res.ok && live) setViewCounts(await res.json());
            } catch { /* counts are a nicety; the views still work without them */ }
        })();
        return () => { live = false; };
    }, [activeTab, customerRefreshTrigger, countsNonce]);

    useEffect(() => {
        if (searchTerm === debouncedSearch) return undefined;
        const timer = setTimeout(() => { setDebouncedSearch(searchTerm); setCurrentPage(1); }, 400);
        return () => clearTimeout(timer);
    }, [searchTerm, debouncedSearch, setCurrentPage]);

    /** Everything matching the filters (every page), for Export and the marketing list. */
    const fetchAllMatching = async (): Promise<Loose[]> => {
        const res = await authFetch(urlFor({ ...listParams(), limit: -1 }) as unknown as string);
        if (!res.ok) throw new Error('fetch failed');
        return (await res.json()).partners || [];
    };

    return {
        partners, setPartners, loading, loadError, totalPages, totalCount,
        searchTerm, setSearchTerm, debouncedSearch, setDebouncedSearch,
        viewCounts, setCountsNonce, fetchPartners, refreshAll, fetchAllMatching
    };
}
export type CustomerListData = ReturnType<typeof useCustomerListData>;
