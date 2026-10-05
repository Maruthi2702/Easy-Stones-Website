import { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { sanitizeNavOrder } from '../../utils/navPins';

/**
 * The side nav's admin-set order (src/routes/navOrder.js; null = default).
 * Kept in localStorage as well, so the nav draws in the right order straight
 * away instead of reshuffling once the request comes back; the server's
 * answer always wins.
 */
const CACHE_KEY = 'navOrder';

const readCache = () => {
    try {
        return sanitizeNavOrder(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'));
    } catch {
        return null;
    }
};

const writeCache = (order) => {
    try {
        if (order) localStorage.setItem(CACHE_KEY, JSON.stringify(order));
        else localStorage.removeItem(CACHE_KEY);
    } catch {
        // storage unavailable — the nav still loads the order from the server
    }
};

export default function useNavOrder(enabled = true) {
    const [order, setOrder] = useState(readCache);

    useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        authFetch(`${API_URL}/api/nav-order`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled || !data) return;
                const next = sanitizeNavOrder(data.order);
                setOrder(next);
                writeCache(next);
            })
            .catch(() => {
                // Offline or the request failed: keep the cached/default order.
            });
        return () => { cancelled = true; };
    }, [enabled]);

    /** Save a new order for everyone (manage_users only). Throws on failure. */
    const saveOrder = useCallback(async (next) => {
        const res = await authFetch(`${API_URL}/api/nav-order`, {
            method: 'PUT',
            body: JSON.stringify({ order: next })
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.message || `Could not save (HTTP ${res.status})`);
        }
        const data = await res.json();
        const saved = sanitizeNavOrder(data.order);
        setOrder(saved);
        writeCache(saved);
        return saved;
    }, []);

    return { order, saveOrder };
}
