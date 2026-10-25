import React, { useEffect, useState } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { canViewCustomerProfile } from '../../utils/customerAccess';
import type { Loose } from '../../types/records';

/** What the page gives the open customer (MIGRATION_NOTES.md §4, step A5). */
export type OpenCustomerDeps = {
    currentUser: Loose | null;
    /** The Customers tab's first page — shown while the full record loads. */
    customers: Loose[];
    /** The customer the page has open (it changes with the URL and the list). */
    selectedCustomerId: string | null;
    /** A customer starts loading: clear the last one's password box and account message. */
    onOpening: () => void;
    /** A record is on screen (cached or fresh): fill the quick note from it. */
    onShown: (record: Loose) => void;
};

/**
 * The open customer's full record: loaded when the id changes (the cached copy
 * first, so it shows at once), kept in a per-customer cache, and patched by a
 * visit save before the server answers. `selectedCustomer` is what the profile
 * shows — null without Full profile. Moved out of SalesPage unchanged (2026-10-24).
 */
export function useOpenCustomer({ currentUser, customers, selectedCustomerId, onOpening, onShown }: OpenCustomerDeps) {
    const [selectedCustomerDetail, setSelectedCustomerDetail] = useState<Loose | null>(null);

    const [visitsLoading, setVisitsLoading] = useState(false);

    // In-memory customer cache for instant rendering
    const customerCacheRef = React.useRef<Record<string, Loose>>({});

    // Optimized function to fetch only the selected customer with instant cache hydration
    const fetchSingleCustomer = async (customerId: string, skipCache = false) => {
        if (!customerId) return;

        // 1. Instant Cache Hydration: Serve cached data in 0ms if available
        onOpening();

        if (!skipCache && customerCacheRef.current[customerId]) {
            const cachedData = customerCacheRef.current[customerId];
            setSelectedCustomerDetail(cachedData);
            onShown(cachedData);
            setVisitsLoading(false);
        } else {
            setVisitsLoading(true);
        }

        try {
            const response = await authFetch(`${API_URL}/api/customers/${customerId}`);

            if (response.ok) {
                const data = await response.json();
                customerCacheRef.current[customerId] = data; // Update memory cache
                setSelectedCustomerDetail(data);
                onShown(data);
                return data;
            }
        } catch (error) {
            console.error('Error fetching customer details:', error);
        } finally {
            setVisitsLoading(false);
        }
    };

    // Use selectedCustomerDetail for the main view, fallback to list item (which might be partial)
    // The full profile (visits, resources, contacts, network, details) is Full
    // profile's; without it every way of opening one — the list, a link, the
    // dashboard, the route planner — lands on the customer list instead.
    const selectedCustomer = !canViewCustomerProfile(currentUser)
        ? null
        : (selectedCustomerDetail || customers.find(c => c._id === selectedCustomerId) || (selectedCustomerId ? { _id: selectedCustomerId } : null));

    useEffect(() => {
        if (selectedCustomerId) {
            fetchSingleCustomer(selectedCustomerId);
        }
    }, [selectedCustomerId]);

    // Show a saved visit on the open customer straight away, rather than only
    // once the background refresh lands. Kept in the detail cache too, so the
    // cached copy shown while that refresh runs isn't the pre-save one.
    const patchOpenCustomerVisits = (customerId: string, visit: Loose) => {
        if (!visit?._id || customerId !== selectedCustomerId) return;
        setSelectedCustomerDetail(prev => {
            if (!prev || prev._id !== customerId) return prev;
            const visits = prev.visits || [];
            const exists = visits.some((v: Loose) => v._id === visit._id);
            const next = {
                ...prev,
                visits: exists ? visits.map((v: Loose) => (v._id === visit._id ? { ...v, ...visit } : v)) : [...visits, visit]
            };
            customerCacheRef.current[customerId] = next;
            return next;
        });
    };

    // The other way: take a visit that was shown ahead of its save back off.
    const removeOpenCustomerVisit = (customerId: string, visitId: string) => {
        if (!visitId || customerId !== selectedCustomerId) return;
        setSelectedCustomerDetail(prev => {
            if (!prev || prev._id !== customerId) return prev;
            const next = { ...prev, visits: (prev.visits || []).filter((v: Loose) => v._id !== visitId) };
            customerCacheRef.current[customerId] = next;
            return next;
        });
    };

    // A customer being opened shows at once: their cached copy, else the row
    // they were picked from (a name, an address…). Only an id (from a link or
    // a pin) has nothing to show, so it clears the last one and waits.
    const showCustomerAtOnce = (customer: Loose) => {
        const isShell = !customer.company && !customer.contactName && !customer.email && !customer.name;
        const cached = customerCacheRef.current[customer._id];
        if (isShell) {
            if (selectedCustomerId !== customer._id) {
                setSelectedCustomerDetail(null); // Clear previous details to show loading/fallback
            }
            setVisitsLoading(true);
        } else {
            // Populate selected customer details immediately to transition instantly
            setSelectedCustomerDetail(cached || customer);
            if (!cached || !cached.visits) {
                setVisitsLoading(true);
            }
        }
    };

    const clearCustomer = () => setSelectedCustomerDetail(null);

    return {
        showCustomerAtOnce,
        clearCustomer,
        selectedCustomerDetail,
        setSelectedCustomerDetail,
        visitsLoading,
        setVisitsLoading,
        customerCacheRef,
        fetchSingleCustomer,
        selectedCustomer,
        patchOpenCustomerVisits,
        removeOpenCustomerVisit,
    };
}

/** What the hook returns. */
export type OpenCustomer = ReturnType<typeof useOpenCustomer>;
