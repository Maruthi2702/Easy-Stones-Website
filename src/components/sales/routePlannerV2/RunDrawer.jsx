import React from 'react';
import { Target } from 'lucide-react';
import './RunDrawer.css';

/**
 * The left-edge nav bar: the Tools panel toggle, and whatever area controls
 * (back-to-classic, locate, filter, lead search) got relocated here from the
 * old floating top bar — every entry is a single icon in one vertical
 * column, not a mix of icons and text pills, so it reads as a dock rather
 * than a loose stack of floating buttons. Controls that need more than a
 * click (lead search) open a flyout beside their own icon instead of taking
 * up permanent width in the column.
 * A separate "browse the current selection" icon used to live here too
 * (MapCanvas's old showAreaList panel), but Tools already lists that exact
 * selection stop-ordered, with the same scheduling section — one place to
 * view/manage it, not two, so that icon and panel were removed rather than
 * kept as a duplicate route to the same information. The standalone recency
 * "flower" icon (RecencyFilterButton) went the same way — Filter's own
 * "Days since last visit" section already covers the same activeBuckets/
 * onToggleBucket toggle, so this was a duplicate route to it, not a second
 * capability.
 */
const RunDrawer = ({
    sidebarToggle,
    showToolsPanel, onToggleToolsPanel,
    areaControls
}) => (
    <nav className="rpv2-drawer" aria-label="Map controls">
        {/* The app-wide nav toggle — moved in here from its own spot in
            .rpv2-topbar so every floating control lives in the one column,
            rather than one lone icon sitting apart from the rest. Still the
            same shared SidebarToggleButton every other screen uses; only
            .rpv2-drawer's own CSS below adjusts its margin for this column,
            not the component itself. */}
        {sidebarToggle}

        {/* Opens the Tools panel — draw a Radius or Lasso to build up a
            selection, view/reorder it, and schedule or bulk-update it from
            the same place, rather than driving the day being planned from
            several separate surfaces. */}
        <button
            type="button"
            className={`rpv2-drawer-list-btn ${showToolsPanel ? 'is-on' : ''}`}
            onClick={onToggleToolsPanel}
            title="Selection tools — draw a radius to pick multiple customers"
            aria-label="Selection tools"
            aria-pressed={showToolsPanel}
        >
            <Target size={16} />
        </button>

        {areaControls}
    </nav>
);

export default RunDrawer;
