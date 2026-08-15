import React from 'react';
import './FilterButton.css';

/**
 * The funnel icon in the top bar — opens FilterPanel in the fixed right
 * column (same slot as the customer detail/lead/area-list panels), rather
 * than the single-select CustomSelect popover this used to wrap. `active`
 * reflects whether any type/recency/rep filter has actually narrowed the
 * pin set, independent of whether the panel itself is currently open.
 */
const FilterButton = ({ open, active, onClick }) => (
    <button
        type="button"
        className={`rpv2-filter-btn ${active ? 'is-filtered' : ''}`}
        onClick={onClick}
        aria-expanded={open}
        aria-label="Filter customers"
        title="Filter customers"
    >
        <span className="rpv2-filter-bars" aria-hidden="true">
            <span />
            <span />
            <span />
        </span>
        {active && <span className="rpv2-filter-dot" aria-hidden="true" />}
    </button>
);

export default FilterButton;
