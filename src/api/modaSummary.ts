import { useEffect, useState } from 'react';
import { API_URL } from '../config/api';
import { authFetch } from './authFetch';
import type { ModaSummary } from '../utils/modaTotals';

/*
 * A customer's Moda Resources counts and the resources behind them
 * (GET /api/customers/:id/moda; the rule is src/utils/modaTotals.ts). Counted
 * from every resource on the customer, so it agrees with the stored totals
 * even for a login whose Visits scope shows only some of the resources.
 * `reloadKey` asks again (a save elsewhere changed the customer).
 */
export function useModaSummary(customerId: string | null | undefined, reloadKey: unknown = 0): ModaSummary | null {
    const [summary, setSummary] = useState<{ id: string; data: ModaSummary } | null>(null);
    useEffect(() => {
        if (!customerId) return undefined;
        let live = true;
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/customers/${customerId}/moda`);
                if (res.ok && live) setSummary({ id: customerId, data: await res.json() });
            } catch {
                // The form and the tiles fall back to the stored values.
            }
        })();
        return () => { live = false; };
    }, [customerId, reloadKey]);
    return summary && summary.id === customerId ? summary.data : null;
}
