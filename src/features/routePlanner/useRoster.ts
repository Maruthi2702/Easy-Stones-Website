import { useState, useEffect, useMemo } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { toSalesRepList } from '../../utils/salesReps';
import { repsInScope } from '../../utils/routePlannerScope';
import type { CurrentUser, StaffMember } from '../../types/records';

/**
 * The staff and branch lists: the reps (for the edit form's rep picker and the
 * Filter's rep rows), the reps this person may see (src/utils/routePlannerScope.js
 * — the server applies the same rule), and the branch names.
 */
export function useRoster(currentUser: CurrentUser | null) {
    const [salesReps, setSalesReps] = useState<StaffMember[]>([]);
    const [locationOptions, setLocationOptions] = useState<string[]>([]);

    // The rep/branch pickers AddCustomerModal needs for its edit form — same
    // two endpoints and shapes features/customers/list/PartnersSheet.tsx already fetches this from.
    useEffect(() => {
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/salesreps`);
                if (res.ok) setSalesReps(toSalesRepList(await res.json()));
            } catch {
                /* the edit modal still opens; the rep dropdown is just empty */
            }
        })();
        (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/admin/locations`);
                if (!res.ok) return;
                const data = await res.json();
                setLocationOptions((data || []).map((l: { name?: string }) => l.name).filter(Boolean));
            } catch {
                /* as above — the branch dropdown is just empty */
            }
        })();
    }, []);

    // The reps this person may see (routePlannerScope.js — the server applies the
    // same rule), with how many customers each holds.
    const scopedReps = useMemo(() => repsInScope(currentUser, salesReps), [currentUser, salesReps]);

    return { salesReps, locationOptions, scopedReps };
}
