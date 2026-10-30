import { useState } from 'react';
import type { FormEvent } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import type { Loose } from '../../types/records';
import type { DeleteRequest } from '../teamFiles/useTeamFiles';

/** What the page gives the customer actions (MIGRATION_NOTES.md §4, step A5). */
export type CustomerActionsDeps = {
    selectedCustomer: Loose | null;
    selectedCustomerId: string | null;
    /** The full record loaded in the background (quick note, active flag). */
    selectedCustomerDetail: Loose | null;
    setSelectedCustomerDetail: (detail: Loose | null) => void;
    fetchSingleCustomer: (customerId: string, skipCache?: boolean) => Promise<unknown>;
    setIsSaving: (saving: boolean) => void;
    /** Reload what a save changes (customer, dashboard, schedules). */
    refreshAfterSave: (customerId: string, options?: { dashboard?: boolean; schedules?: boolean }) => void;
    setDeleteConfirmation: (request: DeleteRequest) => void;
};

/** A contact's form. */
export type ContactForm = { name: string; phone: string; email: string; role: string; notes: string };

/**
 * What can be done to an open customer from their profile: add / edit /
 * delete a contact, link and unlink partners, the quick note, the website
 * account (active, password) and reactions on a visit. Moved out of SalesPage
 * unchanged (2026-10-23).
 */
export function useCustomerActions({ selectedCustomer, selectedCustomerId, selectedCustomerDetail, setSelectedCustomerDetail, fetchSingleCustomer, setIsSaving, refreshAfterSave, setDeleteConfirmation }: CustomerActionsDeps) {
    const [showContactModal, setShowContactModal] = useState(false);

    const [editingContact, setEditingContact] = useState<Loose | null>(null);

    // Partner Network States
    const [showLinkPartnerModal, setShowLinkPartnerModal] = useState(false);
    const [linkingPartnerId, setLinkingPartnerId] = useState('');
    const [isLinkingInProgress, setIsLinkingInProgress] = useState(false);

    const handleLinkPartner = async (e?: FormEvent) => {
        if (e) e.preventDefault();
        if (!linkingPartnerId) return;

        setIsLinkingInProgress(true);
        try {
            const res = await authFetch(`${API_URL}/api/customers/${selectedCustomer!._id}/associations`, {
                method: 'POST',
                body: JSON.stringify({ partnerId: linkingPartnerId })
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || data.error || `Failed to establish link (Status ${res.status})`);
            }

            // Re-fetch customer details to update state
            await fetchSingleCustomer(selectedCustomer!._id);
            setShowLinkPartnerModal(false);
            setLinkingPartnerId('');
        } catch (err) {
            console.error('Error linking partner:', err);
            alert((err as Error).message || 'Failed to link partner');
        } finally {
            setIsLinkingInProgress(false);
        }
    };

    const handleUnlinkPartner = async (partnerId: string, partnerName: string) => {
        if (!window.confirm(`Are you sure you want to remove the connection with "${partnerName}"?`)) {
            return;
        }

        try {
            const res = await authFetch(`${API_URL}/api/customers/${selectedCustomer!._id}/associations/${partnerId}`, {
                method: 'DELETE'
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || data.error || `Failed to remove link (Status ${res.status})`);
            }

            // Re-fetch customer details to update state
            await fetchSingleCustomer(selectedCustomer!._id);
        } catch (err) {
            console.error('Error unlinking partner:', err);
            alert((err as Error).message || 'Failed to remove partner connection');
        }
    };

    const [quickNote, setQuickNote] = useState('');
    const [isSavingNote, setIsSavingNote] = useState(false);
    const [resetPasswordValue, setResetPasswordValue] = useState('');
    const [accountActionStatus, setAccountActionStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const [contactForm, setContactForm] = useState<ContactForm>({
        name: '',
        phone: '',
        email: '',
        role: '',
        notes: ''
    });

    // Contact CRUD operations
    const handleAddContact = () => {
        setEditingContact(null);
        setContactForm({
            name: '',
            phone: '',
            email: '',
            role: '',
            notes: ''
        });
        setShowContactModal(true);
    };

    const handleEditContact = (contact: Loose) => {
        setEditingContact(contact);
        setContactForm({
            name: contact.name || '',
            phone: contact.phone || '',
            email: contact.email || '',
            role: contact.role || '',
            notes: contact.notes || ''
        });
        setShowContactModal(true);
    };

    const handleSaveContact = async () => {
        try {
            setIsSaving(true);
            const url = editingContact
                ? `${API_URL}/api/customers/${selectedCustomerId}/contacts/${editingContact._id}`
                : `${API_URL}/api/customers/${selectedCustomerId}/contacts`;

            const method = editingContact ? 'PUT' : 'POST';

            const response = await authFetch(url, {
                method,
                body: JSON.stringify(contactForm)
            });

            if (response.ok) {
                setShowContactModal(false);
                refreshAfterSave(selectedCustomerId!, { dashboard: false });
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to save contact');
            }
        } catch (error) {
            console.error('Error saving contact:', error);
            alert('Failed to save contact');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteContact = async (contactId: string) => {
        setDeleteConfirmation({
            isOpen: true,
            type: 'contact',
            id: contactId,
            message: 'Are you sure you want to delete this contact?'
        });
    };

    const handleSaveQuickNote = async () => {
        if (!selectedCustomerId) return;

        setIsSavingNote(true);
        try {
            const response = await authFetch(`${API_URL}/api/customers/${selectedCustomerId}/quick-note`, {
                method: 'PATCH',
                body: JSON.stringify({ quickNote })
            });

            if (response.ok) {
                const data = await response.json();
                // Update local state so UI reflects the saved note immediately
                if (selectedCustomerDetail) {
                    setSelectedCustomerDetail({ ...selectedCustomerDetail, quickNote: data.quickNote });
                }

            } else {
                console.error('Failed to save quick note');
            }
        } catch (error) {
            console.error('Error saving quick note:', error);
        } finally {
            setIsSavingNote(false);
        }
    };

    const handleToggleCustomerStatus = async (id: string, currentStatus: boolean) => {
        const newStatus = !currentStatus;
        const action = newStatus ? 'activate' : 'deactivate';
        if (!window.confirm(`Are you sure you want to ${action} this customer?`)) return;

        try {
            const response = await authFetch(`${API_URL}/api/customers/${id}/active`, {
                method: 'PATCH',
                body: JSON.stringify({ isActive: newStatus })
            });

            if (response.ok) {
                if (selectedCustomerDetail?._id === id) {
                    setSelectedCustomerDetail({ ...selectedCustomerDetail, isActive: newStatus });
                }
                setAccountActionStatus({ type: 'success', message: `Customer ${action}d successfully` });
            } else {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.message || `Failed to ${action} customer`);
            }
        } catch (error) {
            console.error(`Error ${action}ing customer:`, error);
            setAccountActionStatus({ type: 'error', message: `Failed to ${action} customer: ${(error as Error).message}` });
        }
    };

    /**
     * Admin-only capability, gated behind manage_customer_accounts. Goes through
     * its own route, /api/customers/:id/password, which updates via
     * customer.save() so the schema's pre('save') bcrypt hook runs. The
     * ordinary edit route (PUT /api/customers/:id) refuses a password
     * outright: it uses findByIdAndUpdate, which skips that hook.
     */
    const handleResetCustomerPassword = async (id: string) => {
        if (!resetPasswordValue.trim()) return;
        if (!window.confirm("Reset this customer's password?")) return;
        try {
            const response = await authFetch(`${API_URL}/api/customers/${id}/password`, {
                method: 'PUT',
                body: JSON.stringify({ password: resetPasswordValue })
            });
            if (response.ok) {
                setResetPasswordValue('');
                setAccountActionStatus({ type: 'success', message: 'Password reset successfully' });
            } else {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.message || 'Failed to reset password');
            }
        } catch (error) {
            console.error('Error resetting password:', error);
            setAccountActionStatus({ type: 'error', message: (error as Error).message });
        }
    };

    // Reaction handler
    const handleReaction = async (visitId: string, type: string) => {

        if (!selectedCustomerId || !visitId) {
            console.error('Missing required IDs for reaction:', { selectedCustomerId, visitId });
            return;
        }

        try {
            const response = await authFetch(`${API_URL}/api/customers/${selectedCustomerId}/visits/${visitId}/react`, {
                method: 'POST',
                body: JSON.stringify({ type })
            });

            if (response.ok) {
                // Refresh data to show new reaction
                // Using fetchSingleCustomer for now, could be optimized to local state update
                await response.json();

                // Optimistic update or just simpler refetch
                await fetchSingleCustomer(selectedCustomerId);
            } else {
                console.error('Failed to update reaction');
            }
        } catch (error) {
            console.error('Error updating reaction:', error);
        }
    };

    return {
        showContactModal,
        setShowContactModal,
        editingContact,
        showLinkPartnerModal,
        setShowLinkPartnerModal,
        linkingPartnerId,
        setLinkingPartnerId,
        isLinkingInProgress,
        handleLinkPartner,
        handleUnlinkPartner,
        quickNote,
        setQuickNote,
        isSavingNote,
        resetPasswordValue,
        setResetPasswordValue,
        accountActionStatus,
        setAccountActionStatus,
        contactForm,
        setContactForm,
        handleAddContact,
        handleEditContact,
        handleSaveContact,
        handleDeleteContact,
        handleSaveQuickNote,
        handleToggleCustomerStatus,
        handleResetCustomerPassword,
        handleReaction,
    };
}

/** What the hook returns. */
export type CustomerActions = ReturnType<typeof useCustomerActions>;
