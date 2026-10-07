import { useEffect, useState } from 'react';
import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import { toCustomerOptions } from '../utils/customerOptions';

/*
 * The one customer list behind every customer dropdown.
 *
 * Loaded once per page load from /api/customers/dropdown and shared, so
 * opening the Visit form, then a delivery, then a lost sale doesn't fetch the
 * same few thousand customers three times — and every screen shows the same
 * list. It's refreshed after a customer is created, edited or deleted
 * anywhere (refreshCustomers, called from SalesPage's customer_update socket
 * handler and after its own saves), and a customer just created is added at
 * once (addCustomerRecord) so it can be picked before the refetch lands.
 *
 * The naming, sorting and search rules are in src/utils/customerOptions.js.
 */

let records = [];
let options = [];
let loaded = false;
let loading = false;
let inflight = null;
const listeners = new Set();

const publish = () => {
    options = toCustomerOptions(records);
    for (const fn of listeners) fn();
};

const setRecords = (next) => {
    records = Array.isArray(next) ? next : [];
    loaded = true;
    publish();
};

/** Fetch the list (once, unless force). Resolves when it's in. */
export function loadCustomers({ force = false } = {}) {
    if (inflight && !force) return inflight;
    if (loaded && !force) return Promise.resolve(records);
    loading = true;
    for (const fn of listeners) fn();
    const run = (async () => {
        try {
            const res = await authFetch(`${API_URL}/api/customers/dropdown`);
            if (res.ok) {
                const data = await res.json();
                // A slower, older request must not overwrite a newer one.
                if (inflight === run) setRecords(data);
            }
        } catch (err) {
            console.warn('[customers] could not load the customer list:', err);
        } finally {
            if (inflight === run) {
                inflight = null;
                loading = false;
                for (const fn of listeners) fn();
            }
        }
        return records;
    })();
    inflight = run;
    return run;
}

/** Re-fetch after a change somewhere (create / edit / delete, or another user's). */
export const refreshCustomers = () => loadCustomers({ force: true });

/** Put a customer that was just created (or edited) into the list straight away. */
export function addCustomerRecord(record) {
    if (!record?._id) return;
    const id = String(record._id);
    setRecords([...records.filter((r) => String(r._id) !== id), record]);
}

/**
 * { records, options, loading, refresh } for a screen with a customer
 * dropdown. Loads the list the first time any screen asks for it.
 */
export function useCustomerOptions() {
    const [, setTick] = useState(0);
    useEffect(() => {
        const fn = () => setTick((t) => t + 1);
        listeners.add(fn);
        if (!loaded && !inflight) loadCustomers();
        return () => { listeners.delete(fn); };
    }, []);
    return { records, options, loading: loading && !loaded, refresh: refreshCustomers };
}
