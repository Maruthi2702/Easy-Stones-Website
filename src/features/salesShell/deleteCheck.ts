import { useState } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';

/**
 * The Sales page's one "Confirm Deletion" check (DeleteConfirmModal): a
 * contact, visit, resource or Team Files item asks it, and Delete sends the
 * request and refreshes what showed it. Moved out of SalesPage unchanged
 * (2026-10-24).
 */

export type DeleteType = 'contact' | 'visit' | 'resource' | 'dashboardResource' | '';

/** What the check is asking about. `customerId` falls back to the open customer. */
export type DeleteRequest = {
    isOpen: boolean;
    isDeleting?: boolean;
    type: DeleteType | string;
    id: string | null;
    customerId?: string | null;
    message: string;
};

const CLOSED: DeleteRequest = { isOpen: false, isDeleting: false, type: '', id: null, customerId: null, message: '' };

/** The address each kind of delete goes to; null for a kind nobody sends. */
export const deleteUrl = (type: string, customerId: string | null | undefined, id: string | null): string | null => {
    if (type === 'contact') return `${API_URL}/api/customers/${customerId}/contacts/${id}`;
    if (type === 'visit') return `${API_URL}/api/customers/${customerId}/visits/${id}`;
    if (type === 'resource') return `${API_URL}/api/customers/${customerId}/resources/${id}`;
    if (type === 'dashboardResource') return `${API_URL}/api/sales-dashboard/resources/${id}`;
    return null;
};

/** The check's state; the page holds it from the start, since every module can ask it. */
export function useDeleteCheck() {
    const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteRequest>(CLOSED);
    const cancelDelete = () => {
        setDeleteConfirmation({ isOpen: false, type: '', id: null, customerId: null, message: '' });
    };
    return { deleteConfirmation, setDeleteConfirmation, cancelDelete };
}

export type ConfirmDeleteDeps = {
    deleteConfirmation: DeleteRequest;
    setDeleteConfirmation: (next: DeleteRequest | ((prev: DeleteRequest) => DeleteRequest)) => void;
    selectedCustomerId: string | null;
    /** The dashboard tab showing; a delete there refreshes the dashboard instead of a customer. */
    activeDashboardTab: string;
    fetchDashboardResources: () => unknown;
    fetchDashboardData: () => unknown;
    fetchDashboardStats: () => unknown;
    fetchSingleCustomer: (customerId: string) => unknown;
};

/** Delete: send it, close the check, and refresh the Team Files list, the dashboard or the customer behind it. */
export const makeConfirmDelete = ({
    deleteConfirmation, setDeleteConfirmation, selectedCustomerId, activeDashboardTab,
    fetchDashboardResources, fetchDashboardData, fetchDashboardStats, fetchSingleCustomer
}: ConfirmDeleteDeps) => async () => {
    const { type, id, customerId } = deleteConfirmation;
    // Use the customerId from state, or fallback to selectedCustomerId for legacy calls
    const targetCustomerId = customerId || selectedCustomerId;

    setDeleteConfirmation(prev => ({ ...prev, isDeleting: true }));

    if (!targetCustomerId && type !== 'dashboardResource') {
        console.error('No customer ID provided for deletion');
        alert(`Failed to delete ${type}: Missing customer information`);
        return;
    }

    try {
        let response: Response | undefined;
        const url = deleteUrl(type, targetCustomerId, id);
        if (url) response = await authFetch(url, { method: 'DELETE' });

        if (response && response.ok) {
            // If we're on the Dashboard view (dashboard tabs), refresh dashboard data
            const isDashboardView = activeDashboardTab === 'visits' || activeDashboardTab === 'resources' || activeDashboardTab === 'followups' || activeDashboardTab === 'leads';

            // Close first, refresh behind it — same reasoning as refreshAfterSave.
            setDeleteConfirmation({ ...CLOSED });
            if (type === 'dashboardResource') {
                fetchDashboardResources();
            } else if (!selectedCustomerId && isDashboardView) {
                Promise.allSettled([fetchDashboardData(), fetchDashboardStats()]);
            } else {
                // Otherwise, refresh the selected customer's data
                fetchSingleCustomer(targetCustomerId!);
            }
        } else {
            setDeleteConfirmation(prev => ({ ...prev, isDeleting: false }));
            const reason = response ? (await response.json().catch(() => ({}))).message : '';
            alert(reason || `Failed to delete ${type}`);
        }
    } catch (error) {
        console.error(`Error deleting ${type}:`, error);
        setDeleteConfirmation(prev => ({ ...prev, isDeleting: false }));
        alert(`Failed to delete ${type}`);
    }
};
