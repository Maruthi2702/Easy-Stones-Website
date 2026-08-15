import React from 'react';
import { CalendarPlus } from 'lucide-react';
import './AreaScheduleTrigger.css';

/**
 * Gold "commit" icon beside Close in the area-customer-list panel header.
 * Toggles AreaScheduleSection, which MapCanvas renders as a normal block
 * below the panel head — this button only owns its own visual state
 * (open/closed, the stop-count badge), not the section's content, so the
 * two can live in separate parts of the DOM without one having to reach
 * into the other.
 */
const AreaScheduleTrigger = ({ isOpen, onToggle, count }) => (
    <button
        type="button"
        className={`rpv2-area-schedule-trigger ${isOpen ? 'is-open' : ''}`}
        onClick={onToggle}
        title="Schedule these stops"
        aria-label={`Schedule these stops${count ? ` (${count} ready)` : ''}`}
        aria-expanded={isOpen}
    >
        <CalendarPlus size={15} />
        {count > 0 && <span className="rpv2-area-schedule-badge">{count}</span>}
    </button>
);

export default AreaScheduleTrigger;
