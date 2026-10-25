// What the Customers list writes: save / delete / status on one customer, and
// the selection bar's bulk changes, bulk Delete and its Undo.
import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { emailListFor } from '../../../utils/customerList';
import { deletedMessage, restoredMessage } from '../../../utils/customerBulkDelete';
import { copyText } from './uiHelpers';
import { clearListCache } from './listOptions';
import type { Loose } from '../../../types/records';

type Selection = Map<string, Loose>;

export type CustomerWritesDeps = {
    editingPartner: Loose | null;
    setEditingPartner: Dispatch<SetStateAction<Loose | null>>;
    setViewingPartner: Dispatch<SetStateAction<Loose | null>>;
    openCustomer: Loose | null;
    setOpenCustomer: Dispatch<SetStateAction<Loose | null>>;
    setSelected: Dispatch<SetStateAction<Selection>>;
    setPartners: Dispatch<SetStateAction<Loose[]>>;
    setCountsNonce: Dispatch<SetStateAction<number>>;
    refreshAll: () => void;
};

/** Add / Edit customer's save, Delete, and the drawer's status picker. */
export function useCustomerWrites(d: CustomerWritesDeps) {
    const { editingPartner, setEditingPartner, setViewingPartner, openCustomer, setOpenCustomer, setSelected, setPartners, setCountsNonce, refreshAll } = d;
    const [isSaving, setIsSaving] = useState(false);

    const handleSavePartner = async (formData: Loose, closeModal: () => void) => {
        setIsSaving(true);
        try {
            const method = editingPartner ? 'PUT' : 'POST';
            const url = editingPartner ? `${API_URL}/api/customers/${editingPartner._id}` : `${API_URL}/api/customers`;
            const leadData = {
                ...formData,
                contactName: formData.customerName,
                name: formData.customerName,
                city: formData.address?.city || '',
                quickNote: formData.notes
            };
            const response = await authFetch(url, { method, body: JSON.stringify(leadData) });
            if (response.ok) {
                const saved = await response.json().catch(() => null);
                refreshAll();
                closeModal();
                setEditingPartner(null);
                setViewingPartner(null);
                if (saved && openCustomer && saved._id === openCustomer._id) setOpenCustomer(saved);
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.error('Server error saving lead:', errorData);
                alert(errorData.message || 'Failed to save customer');
            }
        } catch (error) {
            console.error('Error saving lead:', error);
            alert('Failed to save customer. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    // Resolves true once the customer is gone (the Edit form closes on that).
    const handleDeletePartner = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this customer?')) return false;
        try {
            const response = await authFetch(`${API_URL}/api/customers/${id}`, { method: 'DELETE' });
            if (response.ok) {
                if (openCustomer?._id === id) setOpenCustomer(null);
                setSelected(prev => { const next = new Map(prev); next.delete(id); return next; });
                refreshAll();
                return true;
            }
            const errorData = await response.json().catch(() => ({}));
            alert(errorData.message || 'Failed to delete customer');
        } catch (error) {
            console.error('Error deleting customer:', error);
            alert('An error occurred while deleting the customer');
        }
        return false;
    };

    const handleStatusChange = async (id: string, status: string) => {
        try {
            const res = await authFetch(`${API_URL}/api/customers/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
            if (!res.ok) return false;
            setPartners(list => list.map(p => (p._id === id ? { ...p, status } : p)));
            setOpenCustomer(c => (c && c._id === id ? { ...c, status } : c));
            clearListCache();
            setCountsNonce(n => n + 1);
            return true;
        } catch {
            return false;
        }
    };

    return { isSaving, handleSavePartner, handleDeletePartner, handleStatusChange };
}

export type BulkActionsDeps = {
    selected: Selection;
    selectedRows: Loose[];
    setSelected: Dispatch<SetStateAction<Selection>>;
    setBulkMessage: Dispatch<SetStateAction<string>>;
    openCustomer: Loose | null;
    setOpenCustomer: Dispatch<SetStateAction<Loose | null>>;
    refreshAll: () => void;
};

/** The selection bar: Assign rep / Set status, Copy emails, and Delete with Undo. */
export function useBulkActions(d: BulkActionsDeps) {
    const { selected, selectedRows, setSelected, setBulkMessage, openCustomer, setOpenCustomer, refreshAll } = d;
    const [bulkBusy, setBulkBusy] = useState(false);
    // Bulk Delete: the confirmation (its rows while open), and the last delete's Undo.
    const [bulkDelete, setBulkDelete] = useState<{ rows: Loose[] } | null>(null);
    const [bulkDeleteSaving, setBulkDeleteSaving] = useState(false);
    const [bulkDeleteError, setBulkDeleteError] = useState('');
    const [lastDelete, setLastDelete] = useState<{ batchId: string | null; message: string; busy: boolean } | null>(null);

    const bulkPatch = async (body: Loose, describe: (n: number) => string) => {
        setBulkBusy(true);
        try {
            const res = await authFetch(`${API_URL}/api/customers/bulk`, {
                method: 'PATCH',
                body: JSON.stringify({ ids: [...selected.keys()], ...body })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { alert(data.message || 'Could not update the selected customers'); return; }
            setBulkMessage(describe(data.modified ?? selected.size));
            refreshAll();
        } catch {
            alert('Could not update the selected customers');
        } finally {
            setBulkBusy(false);
        }
    };

    const bulkCopyEmails = async () => {
        const list = emailListFor(selectedRows);
        if (!list) { setBulkMessage('No email addresses on the selected customers'); return; }
        await copyText(list);
        setBulkMessage(`Copied ${list.split('; ').length} emails`);
    };

    // Bulk Delete: confirm (BulkDeleteDialog), one request for the whole
    // selection, then the bar stays up with Undo (src/routes/customerBulkDelete.js
    // saves every customer whole before removing it).
    const confirmBulkDelete = async () => {
        const ids = bulkDelete!.rows.map(r => r._id);
        setBulkDeleteSaving(true);
        setBulkDeleteError('');
        try {
            const res = await authFetch(`${API_URL}/api/customers/bulk-delete`, { method: 'POST', body: JSON.stringify({ ids }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { setBulkDeleteError(data.message || 'Could not delete the customers.'); return; }
            setBulkDelete(null);
            setSelected(new Map());
            if (openCustomer && ids.includes(openCustomer._id)) setOpenCustomer(null);
            setLastDelete({ batchId: data.batchId, message: deletedMessage(data.deleted), busy: false });
            refreshAll();
        } catch {
            setBulkDeleteError('Couldn’t reach the server. Refresh the list to see whether they were deleted before trying again.');
        } finally {
            setBulkDeleteSaving(false);
        }
    };

    const undoBulkDelete = async () => {
        const { batchId } = lastDelete!;
        setLastDelete(d => ({ ...d!, busy: true }));
        try {
            const res = await authFetch(`${API_URL}/api/customers/bulk-delete/undo`, { method: 'POST', body: JSON.stringify({ batchId }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                // 409: already undone (another tab) — nothing left to offer.
                setLastDelete({ batchId: res.status === 409 ? null : batchId, message: data.message || 'Undo failed — try again.', busy: false });
                return;
            }
            // Any that couldn't come back stay saved, so Undo stays offered.
            setLastDelete({ batchId: data.failed?.length ? batchId : null, message: restoredMessage(data), busy: false });
            refreshAll();
        } catch {
            setLastDelete({ batchId, message: 'Couldn’t reach the server — try Undo again.', busy: false });
        }
    };

    /** Delete on the bar: open the confirmation for the selection. */
    const startBulkDelete = () => { setBulkDeleteError(''); setBulkDelete({ rows: selectedRows }); };

    return {
        bulkBusy, bulkDelete, setBulkDelete, bulkDeleteSaving, bulkDeleteError, lastDelete, setLastDelete,
        bulkPatch, bulkCopyEmails, confirmBulkDelete, undoBulkDelete, startBulkDelete
    };
}
