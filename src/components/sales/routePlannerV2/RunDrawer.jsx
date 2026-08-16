import React from 'react';
import { Target, Calendar, Users } from 'lucide-react';
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
    filterControl,
    showToolsPanel, onToggleToolsPanel,
    showCustomersPanel, onToggleCustomersPanel,
    showSchedulePanel, onToggleSchedulePanel,
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

        {/* FilterButton, pulled out of areaControls so it sits second in the
            column/row (Dashboard, Filter, Tools, Customers, Calendar) instead
            of after Tools/Calendar where areaControls used to render it. */}
        {filterControl}

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

        {/* Opens Customers — a searchable directory of every customer on
            the map (name, city, sales rep), not just whatever's currently
            selected or filtered in Tools. A second lens onto the same pins
            the map already has, same relationship ToolsPanel/SchedulePanel
            have to their own underlying data. */}
        <button
            type="button"
            className={`rpv2-drawer-list-btn ${showCustomersPanel ? 'is-on' : ''}`}
            onClick={onToggleCustomersPanel}
            title="Customers — search every customer by name, city, or rep"
            aria-label="Customers"
            aria-pressed={showCustomersPanel}
        >
            <Users size={16} />
        </button>

        {/* Opens Schedule — a month calendar plus that day's scheduled
            visits, a read-only lens on the same /api/schedule data Tools
            writes to. On every screen size, unlike the map's own Lasso/
            locate shortcuts (MapCanvas's .rpv2-map-fabs, mobile only) —
            this is a nav item in its own right, not a shortcut for
            something already one click away elsewhere. */}
        <button
            type="button"
            className={`rpv2-drawer-list-btn ${showSchedulePanel ? 'is-on' : ''}`}
            onClick={onToggleSchedulePanel}
            title="Schedule — your calendar and scheduled visits"
            aria-label="Schedule"
            aria-pressed={showSchedulePanel}
        >
            <Calendar size={16} />
        </button>

        {areaControls}
    </nav>
);

export default RunDrawer;
