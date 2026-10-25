import { MapPin, Phone, X, Sparkles } from 'lucide-react';
import { LEAD_PIN_COLOR } from '../helpers';
import type { Lead } from '../types';

export type LeadPanelProps = {
    lead: Lead;
    onClose: () => void;
    onSave: (place: Lead) => void;
    saving: boolean;
    canSave: boolean;
};

/**
 * A lead from the map search, in the same fixed right-column shell as the
 * customer panel — a lead result isn't a Customer yet, so it gets its own
 * lightweight variant.
 */
const LeadPanel = ({ lead, onClose, onSave, saving, canSave }: LeadPanelProps) => (
        <div className="rpv2-panel" data-dialog="lead">
            <div className="rpv2-panel-head" style={{ background: LEAD_PIN_COLOR }}>
                <Sparkles size={14} />
                <span className="rpv2-panel-head-title">New lead</span>
                <button type="button" className="rpv2-panel-close" onClick={onClose} aria-label="Close">
                    <X size={18} />
                </button>
            </div>

            <div className="rpv2-panel-body">
                <strong className="rpv2-panel-name">{lead.name}</strong>
                {lead.types?.length > 0 && (
                    <div className="rpv2-panel-sub">
                        {lead.types.slice(0, 3).map(t => t.replace(/_/g, ' ')).join(' · ')}
                    </div>
                )}

                <div className="rpv2-panel-contact">
                    {lead.address ? (
                        <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <MapPin size={14} />
                            <span>{lead.address}</span>
                        </a>
                    ) : (
                        <span className="rpv2-panel-muted"><MapPin size={14} /> No address on record</span>
                    )}
                    {lead.phone && (
                        <a href={`tel:${lead.phone}`}><Phone size={14} /><span>{lead.phone}</span></a>
                    )}
                </div>

                <p className="rpv2-panel-sub" style={{ marginTop: '0.85rem' }}>
                    Not in your CRM yet — from a map search, not a saved account.
                </p>
            </div>

            {canSave && (
                <div className="rpv2-panel-actions">
                    <button className="is-primary" disabled={saving} onClick={() => onSave(lead)}>
                        {saving ? 'Saving…' : 'Save as lead'}
                    </button>
                </div>
            )}
        </div>
);

export default LeadPanel;
