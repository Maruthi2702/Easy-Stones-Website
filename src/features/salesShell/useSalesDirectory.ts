import { useState } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { toSalesRepList } from '../../utils/salesReps';
import type { LocationRecord, StaffMember } from '../../types/records';

/**
 * The Sales page's locations (GET /api/admin/locations) and sales reps
 * (/api/salesreps, who may own a customer — src/utils/salesReps.ts). Loaded by
 * useSalesLiveUpdates on mount, locations again on a `location_update`.
 * Moved out of SalesPage unchanged (2026-10-24).
 */
export function useSalesDirectory() {
    const [locations, setLocations] = useState<LocationRecord[]>([]);
    const [salesReps, setSalesReps] = useState<StaffMember[]>([]);

    async function fetchSalesReps() {
        try {
            const response = await authFetch(`${API_URL}/api/salesreps`);
            if (!response.ok) return;
            setSalesReps(toSalesRepList(await response.json()));
        } catch (error) {
            console.error('❌ [FETCH] Error fetching sales reps:', error);
        }
    }

    async function fetchLocations() {
        try {
            const response = await authFetch(`${API_URL}/api/admin/locations`);
            if (response.ok) {
                const data = await response.json();
                setLocations(data);
            }
        } catch (error) {
            console.error('❌ [FETCH] Error fetching locations:', error);
        }
    }

    return { locations, salesReps, fetchLocations, fetchSalesReps };
}
