import { CalendarSync, Download, Menu } from 'lucide-react';
import LocationFilter from '../../components/shared/LocationFilter';
import RowMenu from '../../components/shared/RowMenu';
import { DashboardRange, RangeFilterGroup } from './components/DashboardStats';
import PeopleField from './components/PeopleField';
import { VisitsViewSwitch } from './components/RepBreakdownTable';
import type { PeopleFilter } from './components/PeopleField';
import type { Loose } from '../../types/records';

export type DashboardHeaderProps = {
    activeTab: string;
    timeRange: string;
    /** Custom's days (YYYY-MM-DD). */
    rangeFrom?: string;
    rangeTo?: string;
    onTimeRangeChange: (id: string, from?: string, to?: string) => void;
    locationOptions: string[];
    location: string;
    onLocationChange: (value: string) => void;
    currentUser: Loose | null;
    /** The People filter, for anyone who can see more than their own; null otherwise. */
    people: PeopleFilter | null;
    /** Sales Visits' "List | By rep" switch, shown in the Filters panel; null hides it. */
    visitsView?: { value: 'list' | 'byRep'; onChange: (v: 'list' | 'byRep') => void } | null;
    /** The Calendar tab follows it too (Users & Roles → Visits → Team calendar). */
    showPeopleOnCalendar?: boolean;
    /** The menu button shows when the side nav is closed or on a phone. */
    showMenuButton: boolean;
    onOpenSidebar: () => void;
    onExportVisits: () => void;
    onOpenCalendarSync: () => void;
    /**
     * Where a tab puts its own Filters and ⋯ (Resources and Follow-ups keep their
     * filters' state, so they render them here through a portal).
     */
    onToolSlot: (el: HTMLElement | null) => void;
};

/** Tabs whose Filters and ⋯ are rendered by the tab itself, into the header's slot. */
const TABS_WITH_OWN_TOOLS = ['resources', 'followups'];

/**
 * The Dashboard's one header (owner, 2026-10-31; claude.ai artifact "Dashboard tabs —
 * Visits, Resources, Follow-ups, Calendar", section "One header"). The same on every
 * tab and size: title and date, the time range, then Filters (round icon) and ⋯ —
 * always in the same place; only what they hold changes with the tab. Desktop is one
 * row; under 1024px the range drops to its own row under title / Filters / ⋯, and on
 * a phone the Calendar tab has no range (it has its own Day / Week / Month).
 * Adding is the round + (DashboardAddButton), not header buttons.
 */
export default function DashboardHeader({
    activeTab, timeRange, rangeFrom = '', rangeTo = '', onTimeRangeChange, locationOptions, location, onLocationChange, currentUser, people, visitsView = null, showPeopleOnCalendar = false,
    showMenuButton, onOpenSidebar, onExportVisits, onOpenCalendarSync, onToolSlot
}: DashboardHeaderProps) {
    const rangeActive = timeRange === 'all' || timeRange === 'custom';
    const rangeGroup = <RangeFilterGroup value={timeRange} from={rangeFrom} to={rangeTo} onChange={onTimeRangeChange} />;
    const tabOwnsTools = TABS_WITH_OWN_TOOLS.includes(activeTab);
    const calendarPeople = activeTab === 'planner' && people && showPeopleOnCalendar ? people : null;
    return (
        <div className="dashboard-header-v2">
            <div className="dashboard-header-content dfx-head" data-tab={activeTab}>
                <div className="dashboard-left-section">
                    {showMenuButton && (
                        <button
                            onClick={() => onOpenSidebar()}
                            className="dashboard-sidebar-toggle"
                            title="Open Sidebar"
                        >
                            <Menu size={20} />
                        </button>
                    )}
                    <div className="dashboard-title-group">
                        <h1>Dashboard</h1>
                        <div className="dashboard-breadcrumbs">
                            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                            {people && <span className="dashboard-people-summary"> · Showing {people.summary}</span>}
                        </div>
                    </div>
                </div>

                {/* One range for every tab; Follow-ups reads it by due date. */}
                <div className="dfx-head-range">
                    <DashboardRange value={timeRange} from={rangeFrom} to={rangeTo} onChange={onTimeRangeChange} />
                </div>

                <div className="dfx-head-tools">
                    {/* Resources / Follow-ups put their Filters and ⋯ here. */}
                    <span className="dfx-head-slot" ref={onToolSlot} />
                    {activeTab === 'visits' && (
                        <>
                            <LocationFilter
                                options={locationOptions}
                                value={location}
                                onChange={onLocationChange}
                                user={currentUser}
                                active={Boolean(people?.active) || rangeActive}
                                onClear={people?.onReset}
                            >
                                {rangeGroup}
                                {visitsView && (
                                    <div className="lf-group" role="group" aria-label="Show visits as">
                                        <span className="lf-group-label">View</span>
                                        <VisitsViewSwitch value={visitsView.value} onChange={visitsView.onChange} />
                                    </div>
                                )}
                                {people ? <PeopleField {...people} /> : null}
                            </LocationFilter>
                            <RowMenu
                                label="More"
                                items={[{ key: 'export', label: 'Export this view to Excel', icon: Download, onClick: () => onExportVisits() }]}
                            />
                        </>
                    )}
                    {activeTab === 'planner' && (
                        <>
                            {calendarPeople ? (
                                <LocationFilter
                                    options={locationOptions}
                                    value={location}
                                    onChange={onLocationChange}
                                    user={currentUser}
                                    active={Boolean(calendarPeople.active) || rangeActive}
                                    onClear={calendarPeople.onReset}
                                >
                                    {rangeGroup}
                                    <PeopleField {...calendarPeople} />
                                </LocationFilter>
                            ) : (
                                <LocationFilter options={[]} value="" onChange={() => {}} user={currentUser} active={rangeActive}>
                                    {rangeGroup}
                                </LocationFilter>
                            )}
                            <RowMenu
                                label="More"
                                items={[{ key: 'sync', label: 'Sync calendar', icon: CalendarSync, onClick: () => onOpenCalendarSync() }]}
                            />
                        </>
                    )}
                    {!tabOwnsTools && activeTab !== 'visits' && activeTab !== 'planner' && (
                        <LocationFilter options={[]} value="" onChange={() => {}} user={currentUser} active={rangeActive}>
                            {rangeGroup}
                        </LocationFilter>
                    )}
                </div>
            </div>
        </div>
    );
}
