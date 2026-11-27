import { useEffect, useState } from 'react';
import { Search, Loader2, UserPlus, X } from 'lucide-react';
import { LEAD_PIN_COLOR } from '../helpers';
import type { Lead, SelectionShape } from '../types';

/** The lead search the Tools panel's Leads list runs inside the drawn shape. */
export type AreaLeadSearch = {
    query: string;
    onQueryChange: (value: string) => void;
    onSearch: (query: string, area?: SelectionShape | null) => Promise<void> | void;
    searching: boolean;
    recent: string[];
    onRemoveRecent: (term: string) => void;
};

export type AreaLeadsProps = {
    /** The Radius / Lasso that was drawn, or null when none has been. */
    shape: SelectionShape | null;
    /** Found leads that sit inside it (leadsInShape). */
    leads: Lead[];
    search: AreaLeadSearch;
    onSelect: (lead: Lead) => void;
    onSave: (lead: Lead) => void;
    saving: boolean;
    canSave: boolean;
};

const nice = (type: string) => type.replace(/_/g, ' ');
const metaOf = (lead: Lead) => [lead.types.slice(0, 2).map(nice).join(', '), lead.addressParts?.city].filter(Boolean).join(' · ');

/**
 * The Tools panel's "Leads in area": businesses found by a lead search (Google
 * Places, not customers yet) that sit inside the drawn Radius or Lasso. A search
 * here looks inside that shape only. A row opens the lead; the + saves it as a
 * New Lead customer.
 */
const AreaLeads = ({ shape, leads, search, onSelect, onSave, saving, canSave }: AreaLeadsProps) => {
    const { query, onQueryChange, onSearch, searching, recent, onRemoveRecent } = search;
    // What was last searched here, so an empty answer can say so — cleared by the
    // next draw, since it was about the old shape.
    const [searched, setSearched] = useState('');
    useEffect(() => { setSearched(''); }, [shape]);

    const run = async (term?: string) => {
        const q = (term ?? query).trim();
        if (!q || !shape || searching) return;
        if (term) onQueryChange(term);
        await onSearch(q, shape);
        setSearched(q);
    };

    return (
        <>
            <div className="rpv2-tools-body rpv2-tools-leads-search">
                {!shape ? (
                    <p className="rpv2-tools-hint">Draw a Radius or Lasso on the map to list the leads inside it, and to search just that area.</p>
                ) : (
                    <>
                        <div className="rpv2-lead-row">
                            <Search size={14} className="rpv2-lead-icon" aria-hidden="true" />
                            <input
                                type="text"
                                className="rpv2-lead-input no-capitalize"
                                placeholder="Find leads here (e.g. countertops)"
                                value={query}
                                onChange={(e) => onQueryChange(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
                                aria-label="Search for leads inside the drawn area"
                            />
                            <button
                                type="button"
                                className="rpv2-tools-leads-go"
                                onClick={() => run()}
                                disabled={searching || !query.trim()}
                            >
                                {searching ? <Loader2 size={14} className="rpv2-lead-spin" /> : 'Search'}
                            </button>
                        </div>
                        {recent.length > 0 && (
                            <div className="rpv2-tools-leads-recent">
                                {recent.map(term => (
                                    <span key={term} className="rpv2-tools-leads-chip">
                                        <button type="button" onClick={() => run(term)}>{term}</button>
                                        <button type="button" onClick={() => onRemoveRecent(term)} aria-label={`Remove "${term}" from recent searches`}>
                                            <X size={11} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            <div className="rpv2-panel-list rpv2-tools-list">
                {shape && leads.length === 0 && (
                    <p className="rpv2-panel-list-empty">
                        {searched ? `No “${searched}” found inside this area.` : 'No leads in this area yet. Search above to find some.'}
                    </p>
                )}
                {leads.map(lead => (
                    <div key={lead.placeId} className="rpv2-panel-list-row">
                        <span className="rpv2-panel-list-dot" style={{ background: LEAD_PIN_COLOR }} aria-hidden="true" />
                        <div
                            className="rpv2-panel-list-body"
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelect(lead)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(lead); } }}
                        >
                            <span className="rpv2-panel-list-name">{lead.name}</span>
                            <span className="rpv2-panel-list-meta">{metaOf(lead) || lead.address}</span>
                        </div>
                        {canSave && (
                            <button
                                type="button"
                                className="rpv2-panel-icon-btn"
                                onClick={() => onSave(lead)}
                                disabled={saving}
                                title="Save as lead"
                                aria-label={`Save ${lead.name} as a lead`}
                            >
                                <UserPlus size={15} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </>
    );
};

export default AreaLeads;
