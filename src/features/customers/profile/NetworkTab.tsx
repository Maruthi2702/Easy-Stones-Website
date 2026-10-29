import { Users } from 'lucide-react';
import { TabEmpty } from './TabStates';
import { formatDate } from '../../../utils/dateUtils';
import type { Loose } from '../../../types/records';

export type NetworkTabProps = {
    customer: Loose;
    onOpenCustomer: (partner: Loose) => void;
    onUnlink: (partnerId: string, partnerName: string) => void;
    onLinkPartner: () => void;
};

/**
 * Customer profile → Network: the fabricators, designers and builders linked to this
 * customer. The Link partner button is the header's (2026-10-29); the empty tab holds its own.
 */
export default function NetworkTab({ customer, onOpenCustomer, onUnlink, onLinkPartner }: NetworkTabProps) {
    const partners: Loose[] = customer.associatedCustomers || [];

    // Group partners
    const fabricators = partners.filter(p => p.customerType === 'Fabricator');
    const otherPartners = partners.filter(p => p.customerType !== 'Fabricator');

    const renderPartnerGrid = (list: Loose[], title: string) => {
        if (list.length === 0) return null;
        return (
            <div className="network-category-section">
                <h4 className="network-category-title">{title} ({list.length})</h4>
                <div className="network-grid">
                    {list.map(partner => (
                        <div className="partner-card" key={partner._id}>
                            <div className="partner-card-header">
                                <div className="partner-avatar">
                                    {partner.company ? partner.company[0].toUpperCase() : partner.contactName[0].toUpperCase()}
                                </div>
                                <div className="partner-info-meta">
                                    <h5 className="partner-company" onClick={() => onOpenCustomer(partner)}>
                                        {partner.company || 'Private Contractor'}
                                    </h5>
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                                        <span className={`partner-badge ${partner.status?.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}>
                                            {partner.status || 'Active'}
                                        </span>
                                        <span className="partner-badge type-badge">
                                            {partner.customerType || 'Fabricator'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="partner-card-body">
                                <div className="partner-field">
                                    <span className="field-label">Contact</span>
                                    <span className="field-value">{partner.contactName}</span>
                                </div>
                                {partner.phone && (
                                    <div className="partner-field">
                                        <span className="field-label">Phone</span>
                                        <span className="field-value">{partner.phone}</span>
                                    </div>
                                )}
                                <div className="partner-field">
                                    <span className="field-label">Last Visited</span>
                                    <span className="field-value highlight">
                                        {partner.lastVisitDate ? formatDate(partner.lastVisitDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never'}
                                    </span>
                                </div>
                            </div>
                            <div className="partner-card-actions">
                                <button 
                                    className="partner-action-btn view-btn"
                                    onClick={() => onOpenCustomer(partner)}
                                >
                                    View Profile
                                </button>
                                <button 
                                    className="partner-action-btn unlink-btn"
                                    onClick={() => onUnlink(partner._id, partner.company || partner.contactName)}
                                >
                                    Unlink
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="network-tab-container">
            {partners.length === 0 ? (
                <TabEmpty
                    icon={<Users size={28} aria-hidden="true" />}
                    title="No partners linked yet"
                    text="Link the designers and builders this customer works with."
                    actionLabel="Link partner"
                    onAction={onLinkPartner}
                />
            ) : (
                <div className="network-sections">
                    {renderPartnerGrid(fabricators, "Associated Fabricators")}
                    {renderPartnerGrid(otherPartners, "Associated Designers & Builders")}
                </div>
            )}
        </div>
    );
}
