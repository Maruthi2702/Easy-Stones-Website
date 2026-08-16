import React, { useMemo, useState } from 'react';
import { Search, Users, X } from 'lucide-react';
import { nameOf, real, searchCustomerPins } from './helpers';
import './CustomersPanel.css';

/**
 * "Customers" — a searchable directory of every customer on the map (name,
 * city, sales rep), reached from RunDrawer's Users icon. Unlike Tools'
 * "Selected customers" list (a lens on the current selection) or Schedule's
 * calendar (a lens on booked visits), this is a lens on the full `pins`
 * RoutePlannerV2 already loaded for the map — nothing here is filtered by
 * whatever Filter/Tools currently has active, since this is meant to find
 * *any* customer, including ones hidden by the map's own filters.
 *
 * Sorting/matching is searchCustomerPins (helpers.js) — kept pure and
 * tested there rather than inlined, same reasoning as every other
 * pure/testable bit in this tree (see CLAUDE.md).
 */
const CustomersPanel = ({ onClose, pins, onSelectCustomer }) => {
    const [query, setQuery] = useState('');
    const results = useMemo(() => searchCustomerPins(pins, query), [pins, query]);

    return (
        <div className="rpv2-panel" data-dialog="customers">
            <div className="rpv2-panel-head">
                <div className="rpv2-panel-head-top">
                    <Users size={16} />
                    <span className="rpv2-panel-head-title">Customers</span>
                    <button type="button" className="rpv2-panel-close" onClick={onClose} aria-label="Close">
                        <X size={18} />
                    </button>
                </div>

                <div className="rpv2-customers-search-row">
                    <Search size={14} className="rpv2-customers-search-icon" aria-hidden="true" />
                    <input
                        type="text"
                        className="rpv2-customers-search-input"
                        placeholder="Search by name, city, or sales rep"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoFocus
                        aria-label="Search customers by name, city, or sales rep"
                    />
                    {query && (
                        <button
                            type="button"
                            className="rpv2-customers-search-clear"
                            onClick={() => setQuery('')}
                            aria-label="Clear search text"
                        >
                            <X size={13} />
                        </button>
                    )}
                </div>
            </div>

            <div className="rpv2-panel-list rpv2-customers-list">
                {results.length === 0 && (
                    <p className="rpv2-panel-list-empty">
                        {query ? `No customers match "${query}".` : 'No customers to show.'}
                    </p>
                )}
                {results.map(pin => (
                    <div key={pin._id} className="rpv2-panel-list-row">
                        <div
                            className="rpv2-panel-list-body"
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectCustomer(pin)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectCustomer(pin); } }}
                        >
                            <span className="rpv2-panel-list-name">{nameOf(pin)}</span>
                            <span className="rpv2-panel-list-meta">
                                {[real(pin.city), real(pin.salesRepName)].filter(Boolean).join(' · ')}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default CustomersPanel;
