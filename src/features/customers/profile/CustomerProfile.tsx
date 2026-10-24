import ErrorBoundary from '../../../components/shared/ErrorBoundary';
import CustomerProfileHeader from '../list/CustomerProfileHeader';
import CustomerDetailsTab from '../list/CustomerDetailsTab';
import CustomerContactsTab from '../list/CustomerContactsTab';
import VisitsTab from './VisitsTab';
import ResourcesTab from './ResourcesTab';
import NetworkTab from './NetworkTab';
import type { Loose } from '../../../types/records';

export type CustomerProfileProps = {
    customerId: string;
    customer: Loose;
    /** The full record being loaded in the background (quick note, active flag). */
    detail: Loose | null;
    activeTab: string;
    onTab: (tab: string) => void;
    onBack: () => void;
    onGoHome: () => void;
    /** The header's status picker saved: show it on the open record at once. */
    onStatusChanged: (status: string) => void;
    currentUser: Loose | null;
    currentUserId: string | null;
    /** The header shows it is loading the customer. */
    visitsLoading: boolean;
    /** The Visits tab has no history to show yet. */
    historyLoading: boolean;
    levelLabel: string;
    canAddVisits: boolean;
    /** The Customers tab's first page — a resource's client name. */
    customers: Loose[];
    loadingResourceId: string | null;
    // Details tab: quick note and the customer's website account.
    quickNote: string;
    onQuickNoteChange: (value: string) => void;
    onSaveQuickNote: () => void;
    savingNote: boolean;
    accountStatus: { type: string; message: string } | null;
    onToggleActive: () => void;
    resetPassword: string;
    onResetPasswordChange: (value: string) => void;
    onResetPassword: () => void;
    // Contacts
    onAddContact: () => void;
    onEditContact: (contact: Loose) => void;
    onDeleteContact: (contactId: string) => void;
    // Visits and resources
    onAddVisit: () => void;
    onAddResource: () => void;
    onReaction: (visitId: string, type: string) => void;
    onEditVisit: (visit: Loose) => void;
    onDeleteVisit: (visitId: string, customerId?: string | null) => void;
    onViewResource: (resource: Loose) => void;
    onEditResource: (resource: Loose) => void;
    onDeleteResource: (resourceId: string, customerId?: string | null) => void;
    onOpenGallery: (images: string[], index: number) => void;
    expandedResourceId: string | null;
    setExpandedResourceId: (id: string | null) => void;
    activeReactionMessageId: string | null;
    setActiveReactionMessageId: (id: string | null) => void;
    // Network
    onOpenCustomer: (customer: Loose) => void;
    onUnlinkPartner: (partnerId: string, partnerName: string) => void;
    onLinkPartner: () => void;
};

/**
 * An open customer: the header (who they are, status, summary, tabs) and the
 * tab it picks — Details, Contacts, Visits, Resources or Network
 * (MIGRATION_NOTES.md §4, step A5). Everything arrives as props; changes go
 * back as on… callbacks.
 */
export default function CustomerProfile(p: CustomerProfileProps) {
    const { customer, detail, activeTab, currentUser, currentUserId } = p;
    return (
        <ErrorBoundary key={p.customerId}>
            <>
                {/* Customer header: who they are, status, actions, summary, tabs. */}
                <div className="cl-ph-wrap">
                    <CustomerProfileHeader
                        customer={customer}
                        loading={p.visitsLoading}
                        activeTab={activeTab}
                        onTab={p.onTab}
                        onBack={p.onBack}
                        onGoHome={p.onGoHome}
                        canEdit={!!currentUser?.permissions?.includes('manage_customers')}
                        onStatusChanged={p.onStatusChanged}
                    />
                </div>

                <div className="tab-content">
                    {activeTab === 'details' && (
                        // tab-section: on a phone/iPad the tab area only scrolls
                        // inside one (SalesPage.css), so without it the bottom
                        // of the tab — the admin card — was cut off.
                        <div className="tab-section details-tab">
                            <CustomerDetailsTab
                                customer={customer}
                                detail={detail}
                                levelLabel={p.levelLabel}
                                quickNote={p.quickNote}
                                onQuickNoteChange={p.onQuickNoteChange}
                                onSaveQuickNote={p.onSaveQuickNote}
                                savingNote={p.savingNote}
                                noteSaved={Boolean(detail?.quickNote) && p.quickNote === detail!.quickNote}
                                canManageAccount={!!currentUser?.permissions?.includes('manage_customer_accounts')}
                                accountStatus={p.accountStatus}
                                onToggleActive={p.onToggleActive}
                                resetPassword={p.resetPassword}
                                onResetPasswordChange={p.onResetPasswordChange}
                                onResetPassword={p.onResetPassword}
                            />
                        </div>
                    )}

                    {activeTab === 'contacts' && (
                        <div className="tab-section contacts-tab">
                            <CustomerContactsTab
                                customer={customer}
                                onAdd={p.onAddContact}
                                onEdit={p.onEditContact}
                                onDelete={p.onDeleteContact}
                            />
                        </div>
                    )}

                    {activeTab === 'visits' && (
                        <VisitsTab
                            visits={customer.visits || []}
                            loading={p.historyLoading}
                            customerLocation={customer.location}
                            currentUser={currentUser}
                            currentUserId={currentUserId}
                            canAddVisits={p.canAddVisits}
                            onAddContact={p.onAddContact}
                            onAddResource={p.onAddResource}
                            onAddVisit={p.onAddVisit}
                            onReaction={p.onReaction}
                            onEditVisit={p.onEditVisit}
                            onDeleteVisit={p.onDeleteVisit}
                            onOpenGallery={p.onOpenGallery}
                            activeReactionMessageId={p.activeReactionMessageId}
                            setActiveReactionMessageId={p.setActiveReactionMessageId}
                        />
                    )}

                    {activeTab === 'resources' && (
                        <ResourcesTab
                            resources={customer.resources || []}
                            customers={p.customers}
                            customerLocation={customer.location}
                            currentUser={currentUser}
                            currentUserId={currentUserId}
                            loadingResourceId={p.loadingResourceId}
                            canAddVisits={p.canAddVisits}
                            onAddResource={p.onAddResource}
                            onViewResource={p.onViewResource}
                            onEditResource={p.onEditResource}
                            onDeleteResource={p.onDeleteResource}
                            onOpenGallery={p.onOpenGallery}
                            expandedResourceId={p.expandedResourceId}
                            setExpandedResourceId={p.setExpandedResourceId}
                        />
                    )}
                    {activeTab === 'network' && (
                        <div className="tab-section network-tab">
                            <NetworkTab
                                customer={customer}
                                onOpenCustomer={p.onOpenCustomer}
                                onUnlink={p.onUnlinkPartner}
                                onLinkPartner={p.onLinkPartner}
                            />
                        </div>
                    )}
                </div>
            </>
        </ErrorBoundary>
    );
}
