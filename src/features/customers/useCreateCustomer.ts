import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { refreshCustomers, addCustomerRecord } from '../../api/customerOptions';
import type { Loose } from '../../types/records';

export type CreateCustomerDeps = {
    setIsSaving: (saving: boolean) => void;
    /** The page's own first page of customers, refetched past its cache. */
    fetchCustomers: (silent?: boolean) => Promise<unknown>;
    /** The new customer, once the lists have it (the page opens them). */
    onCreated: (customer: Loose) => void;
};

/**
 * Add customer → Save: POST /api/customers (one retry, for a cold start or a
 * stale connection), put the new customer in every dropdown at once, refetch,
 * close the form, then `onCreated`. Moved out of SalesPage unchanged (2026-10-24).
 */
export function useCreateCustomer({ setIsSaving, fetchCustomers, onCreated }: CreateCustomerDeps) {
    const handleCreateCustomer = async (formData: Loose, closeModal: () => void) => {
        try {
            setIsSaving(true);

            // Smart Retry Logic for cold-starts/stale connections
            let response: Response | undefined;
            let lastError: unknown;
            const maxRetries = 1;

            for (let i = 0; i <= maxRetries; i++) {
                try {
                    response = await authFetch(`${API_URL}/api/customers`, {
                        method: 'POST',
                        body: JSON.stringify(formData)
                    });

                    if (response.ok) break;

                    const errorJson = await response.json().catch(() => ({}));
                    lastError = new Error(errorJson.message || 'Failed to create customer');
                } catch (err) {
                    lastError = err;
                }

                if (i < maxRetries) {
                    console.warn(`[Retry] Customer creation attempt ${i + 1} failed. Retrying once...`);
                    await new Promise(resolve => setTimeout(resolve, 1500)); // wait 1.5s
                }
            }

            if (!response || !response.ok) {
                throw lastError || new Error('Failed to create customer');
            }

            const newCustomer = await response.json();
            // silent=true: fetchCustomers' own cache has no bearing on
            // whether the customer we JUST created shows up — skip straight
            // to a fresh fetch instead of possibly redisplaying the
            // pre-create cached page.
            // In the shared dropdown list at once, so the form that asked for it
            // can show it selected; the refetch then brings everything else.
            addCustomerRecord(newCustomer);
            await Promise.all([fetchCustomers(true), refreshCustomers()]);
            closeModal();
            onCreated(newCustomer);
        } catch (error) {
            console.error('Error creating customer:', error);
            alert((error as Error).message || 'Failed to create customer');
        } finally {
            setIsSaving(false);
        }
    };
    return { handleCreateCustomer };
}
