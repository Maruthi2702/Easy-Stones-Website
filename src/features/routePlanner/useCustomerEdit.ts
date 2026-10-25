import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { nameOf } from './helpers';
import type { Loose } from '../../types/records';
import type { MapPin as Customer, Pin, ReturnPanel } from './types';

export type CustomerEditDeps = {
    setPins: Dispatch<SetStateAction<Pin[]>>;
    /** The open customer (usePanels). */
    setInfo: Dispatch<SetStateAction<Customer | null>>;
    setReturnPanel: Dispatch<SetStateAction<ReturnPanel>>;
    reload: () => Promise<void>;
    setError: (message: string) => void;
};

/**
 * Edit, delete and the Status pill for the open customer — reusing
 * AddCustomerModal and the /api/customers/:id routes exactly as
 * features/customers/list/PartnersSheet.tsx does, rather than building a second
 * edit form. Edit (PUT) checks manage_customers; delete (DELETE) needs
 * delete_customers — the same canEditCustomers / canDeleteCustomers rules as
 * the Customers page, gating the two actions separately in the panel.
 */
export function useCustomerEdit({ setPins, setInfo, setReturnPanel, reload, setError }: CustomerEditDeps) {
    const [editingCustomer, setEditingCustomer] = useState<Loose | null>(null);
    const [savingCustomerEdit, setSavingCustomerEdit] = useState(false);
    const [, setLoadingEditCustomer] = useState(false);

    // The Status pill in the shared panel — the same request the Customers tab sends.
    const changeStatus = async (id: string, status: string) => {
        try {
            const res = await authFetch(`${API_URL}/api/customers/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
            if (!res.ok) return false;
            setPins(prev => prev.map(p => (String(p._id) === String(id) ? { ...p, status } : p)));
            setInfo(prev => (prev && String(prev._id) === String(id) ? { ...prev, status } : prev));
            return true;
        } catch {
            return false;
        }
    };

    /**
     * /api/customers/map (what `pins`/`info` come from) flattens address into
     * top-level street/city/state and drops zipCode entirely — fine for
     * showing a pin, but AddCustomerModal expects the full nested
     * `address: {street, city, state, zipCode}` shape. Handing it the pin
     * object directly left street/state/zip blank in the form; saving that
     * as-is would have overwritten the customer's real zip with an empty
     * string. Fetching the full record first avoids that instead of just
     * papering over the gap with a reshaped partial object.
     */
    const openEditCustomer = async (customer: Loose) => {
        setLoadingEditCustomer(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/${customer._id}`);
            if (!res.ok) throw new Error('Could not load this customer’s full details for editing');
            setEditingCustomer(await res.json());
        } catch (err) {
            setError((err as Error).message || 'Could not load this customer’s full details for editing');
        } finally {
            setLoadingEditCustomer(false);
        }
    };

    /** AddCustomerModal's onSave(form, closeModal) — mirrors handleSavePartner in features/customers/list/PartnersSheet.tsx exactly. */
    const saveCustomerEdit = async (formData: Loose, closeModal: () => void) => {
        if (!editingCustomer) return;
        setSavingCustomerEdit(true);
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/${editingCustomer._id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    ...formData,
                    contactName: formData.customerName,
                    name: formData.customerName,
                    city: formData.address?.city || '',
                    quickNote: formData.notes
                })
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || 'Could not save this customer');
            }
            closeModal();
            setEditingCustomer(null);
            // info still holds the pre-edit fields — closing it rather than
            // patching it in place means the next click shows what's
            // actually on the server, not a guess at what changed.
            setInfo(null);
            setReturnPanel(null);
            await reload();
        } catch (err) {
            setError((err as Error).message || 'Could not save this customer');
        } finally {
            setSavingCustomerEdit(false);
        }
    };

    const deleteCustomer = async (customer: Customer) => {
        if (!window.confirm(`Delete ${nameOf(customer)}? This can't be undone.`)) return;
        setError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/${customer._id}`, { method: 'DELETE' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || 'Could not delete this customer');
            }
            setPins(prev => prev.filter(p => p._id !== customer._id));
            setInfo(null);
            setReturnPanel(null);
        } catch (err) {
            setError((err as Error).message || 'Could not delete this customer');
        }
    };

    return { editingCustomer, setEditingCustomer, savingCustomerEdit, changeStatus, openEditCustomer, saveCustomerEdit, deleteCustomer };
}
