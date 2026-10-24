import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { getCachedData, setCachedData, isCacheValid } from '../../utils/dataCache';
import type { Loose } from '../../types/records';

/**
 * The Sales page's own first page of customers (GET /api/customers, 50 a page,
 * cached two minutes): names for the dashboard and planner rows, and the
 * stand-in for the dropdown list until that has loaded. `fetchCustomers(true)`
 * skips the cache (after a save, or a customer_update). Moved out of SalesPage
 * unchanged (2026-10-24); the search and page never change today — the
 * Customers tab's list is PartnersSheet's own.
 */
export function useCustomersPage({ onSearchChanged }: { onSearchChanged: () => void }) {
    const [customers, setCustomers] = useState<Loose[]>([]);
    const [searchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [, setLoading] = useState(true);
    const [, setError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [, setTotalPages] = useState(1);
    const [, setTotalCustomers] = useState(0);
    const customersPerPage = 50;

    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchTerm !== debouncedSearch) {
                setDebouncedSearch(searchTerm); // Fixed: was called twice (bug)
                setCurrentPage(1);
                onSearchChanged();
            }
        }, 500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- as before
    }, [searchTerm, debouncedSearch]);

    const fetchCustomers = useCallback(async (silent = false) => {
        const cacheKey = `customers_${currentPage}_${customersPerPage}_${debouncedSearch}`;
        const cached = getCachedData(cacheKey) as Loose | null;

        if (cached && !silent) {
            setCustomers(cached.customers);
            setTotalPages(cached.totalPages);
            setTotalCustomers(cached.totalCustomers);
            setLoading(false);
            if (isCacheValid(cacheKey, 120000)) return;
        } else if (!cached && !silent) {
            setLoading(true);
        }

        try {
            const response = await authFetch(`${API_URL}/api/customers?page=${currentPage}&limit=${customersPerPage}&search=${encodeURIComponent(debouncedSearch)}`);

            if (response.ok) {
                const data = await response.json();
                const custList = data.customers || [];
                const pages = data.pages || 1;
                const total = data.total || 0;

                setCustomers(custList);
                setTotalPages(pages);
                setTotalCustomers(total);

                setCachedData(cacheKey, { customers: custList, totalPages: pages, totalCustomers: total });
            } else {
                if (response.status === 401) {
                    window.location.href = '/login';
                    return;
                }
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to fetch customers');
            }
        } catch (error) {
            console.error('Error fetching customers:', error);
            setError((error as Error).message);
        } finally {
            setLoading(false);
        }
    }, [currentPage, customersPerPage, debouncedSearch]);

    useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers]);

    return { customers, fetchCustomers };
}
