import { useEffect } from 'react';
import ErrorBoundary from '../../components/shared/ErrorBoundary';
import { CustomerProfile, getCustomerLevelLabel } from '../customers';
import type { CustomerActions, OpenCustomer } from '../customers';
import { requestEditCustomer, requestDeleteCustomer, CUSTOMER_SAVED } from '../customers/customerBridge';
import type { VisitEditor } from '../visits';
import type { ResourceEditor } from '../resources';
import type { Loose } from '../../types/records';
import CustomersList from './CustomersList';
import type { CustomersListProps } from './CustomersList';

export type CustomersViewProps = {
    open: OpenCustomer;
    actions: CustomerActions;
    visits: VisitEditor;
    resources: ResourceEditor;
    selectedCustomerId: string | null;
    activeTab: string;
    onTab: (tab: string) => void;
    onBack: () => void;
    onOpenCustomer: (customer: Loose) => void;
    currentUser: Loose | null;
    currentUserId: string | null;
    canAddVisits: boolean;
    customers: Loose[];
    onOpenGallery: (images: string[], index: number) => void;
    /** Kept by the page so they survive a tab change. */
    expandedResourceId: string | null;
    setExpandedResourceId: (id: string | null) => void;
    activeReactionMessageId: string | null;
    setActiveReactionMessageId: (id: string | null) => void;
    list: CustomersListProps;
};

/**
 * Sales → Customers: the open customer's profile over the list. The list stays
 * mounted (hidden) while a customer is open, so its filters survive.
 */
export default function CustomersView(p: CustomersViewProps) {
    const { open, actions, visits, resources, selectedCustomerId } = p;
    const { selectedCustomer, selectedCustomerDetail, customerCacheRef, visitsLoading, fetchSingleCustomer } = open;

    // The list's Edit customer form saved the open customer: load it again.
    useEffect(() => {
        const onSaved = (e: Event) => {
            const id = (e as CustomEvent).detail?.id;
            if (id && id === selectedCustomerId) fetchSingleCustomer(id, true);
        };
        window.addEventListener(CUSTOMER_SAVED, onSaved);
        return () => window.removeEventListener(CUSTOMER_SAVED, onSaved);
    }, [selectedCustomerId, fetchSingleCustomer]);

    return (
        <>
            {selectedCustomer && (
                <CustomerProfile
                    customerId={selectedCustomerId!}
                    customer={selectedCustomer}
                    detail={selectedCustomerDetail}
                    activeTab={p.activeTab}
                    onTab={p.onTab}
                    onBack={p.onBack}
                    onEditCustomer={() => requestEditCustomer(selectedCustomerDetail || selectedCustomer)}
                    onDeleteCustomer={(settled) => requestDeleteCustomer(selectedCustomerId!, settled)}
                    onStatusChanged={(status) => {
                        open.setSelectedCustomerDetail(prev => (prev ? { ...prev, status } : prev));
                        const cached = customerCacheRef.current[selectedCustomerId!];
                        if (cached) customerCacheRef.current[selectedCustomerId!] = { ...cached, status };
                    }}
                    currentUser={p.currentUser}
                    currentUserId={p.currentUserId}
                    visitsLoading={visitsLoading}
                    historyLoading={visitsLoading || (!selectedCustomerDetail?.visits && !customerCacheRef.current[selectedCustomerId!])}
                    levelLabel={getCustomerLevelLabel(selectedCustomer)}
                    canAddVisits={p.canAddVisits}
                    customers={p.customers}
                    loadingResourceId={resources.loadingResourceId}
                    quickNote={actions.quickNote}
                    onQuickNoteChange={actions.setQuickNote}
                    onSaveQuickNote={actions.handleSaveQuickNote}
                    savingNote={actions.isSavingNote}
                    accountStatus={actions.accountActionStatus}
                    onToggleActive={() => actions.handleToggleCustomerStatus(selectedCustomerDetail?._id, selectedCustomerDetail?.isActive ?? true)}
                    resetPassword={actions.resetPasswordValue}
                    onResetPasswordChange={actions.setResetPasswordValue}
                    onResetPassword={() => actions.handleResetCustomerPassword(selectedCustomerDetail?._id)}
                    onAddContact={actions.handleAddContact}
                    onEditContact={actions.handleEditContact}
                    onDeleteContact={actions.handleDeleteContact}
                    onAddVisit={visits.handleQuickAddVisit}
                    onAddResource={resources.handleAddResource}
                    onReaction={actions.handleReaction}
                    onEditVisit={visits.handleEditVisit}
                    onDeleteVisit={visits.handleDeleteVisit}
                    onViewResource={resources.handleViewResource}
                    onEditResource={resources.handleEditResource}
                    onDeleteResource={resources.handleDeleteResource}
                    onOpenGallery={p.onOpenGallery}
                    onOpenCustomer={p.onOpenCustomer}
                    expandedResourceId={p.expandedResourceId}
                    setExpandedResourceId={p.setExpandedResourceId}
                    activeReactionMessageId={p.activeReactionMessageId}
                    setActiveReactionMessageId={p.setActiveReactionMessageId}
                    onUnlinkPartner={actions.handleUnlinkPartner}
                    onLinkPartner={() => actions.setShowLinkPartnerModal(true)}
                />
            )}
            {/* Kept mounted at all times (hidden via CSS, not
                conditionally rendered) whenever a customer is open.
                This used to live in the ) : ( branch of the
                ErrorBoundary above, whose key changed with
                selectedCustomerId — deselecting a customer changed
                that key from the id back to 'no-customer', which
                force-remounted this list and wiped every filter/tab/
                search it held (reported: Partners tab + Type=Builder
                filter gone after opening and closing a customer). */}
            <div style={{ display: selectedCustomer ? 'none' : 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                <ErrorBoundary key="customers-list">
                    <div className="sales-dashboard-v2">
                        <CustomersList {...p.list} />
                    </div>
                </ErrorBoundary>
            </div>
        </>
    );
}
