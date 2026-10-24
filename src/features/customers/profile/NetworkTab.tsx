import { Plus, Users } from 'lucide-react';
import { formatDate } from '../../../utils/dateUtils';
import type { Loose } from '../../../types/records';

export type NetworkTabProps = {
    customer: Loose;
    onOpenCustomer: (partner: Loose) => void;
    onUnlink: (partnerId: string, partnerName: string) => void;
    onLinkPartner: () => void;
};

/** Customer profile → Network: the fabricators, designers and builders linked to this customer. */
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
            <div className="tab-header">
                <div className="tab-header-left">
                    <h3>Partner Network</h3>
                    <p className="network-subtitle">Track and link fabricators, designers, and builders associated with this customer.</p>
                </div>
                <button className="add-btn" onClick={() => onLinkPartner()}>
                    <Plus size={18} /> Link Partner
                </button>
            </div>

            {partners.length === 0 ? (
                <div className="network-empty-state">
                    <div className="empty-icon-container">
                        <Users size={32} className="empty-icon" />
                    </div>
                    <h4>No associated partners linked yet</h4>
                    <p>Link this customer to fabricators, designers, or builders they work with to see mutual activity and share details.</p>
                    <button className="link-action-btn" onClick={() => onLinkPartner()}>
                        <Plus size={16} /> Link Your First Partner
                    </button>
                </div>
            ) : (
                <div className="network-sections">
                    {renderPartnerGrid(fabricators, "Associated Fabricators")}
                    {renderPartnerGrid(otherPartners, "Associated Designers & Builders")}
                </div>
            )}
        </div>
    );
}
