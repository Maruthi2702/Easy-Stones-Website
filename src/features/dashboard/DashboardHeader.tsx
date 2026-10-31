import { Download, Menu } from 'lucide-react';
import LocationFilter from '../../components/shared/LocationFilter';
import RowMenu from '../../components/shared/RowMenu';
import { DashboardRange } from './components/DashboardStats';
import PeopleField from './components/PeopleField';
import type { PeopleFilter } from './components/PeopleField';
import type { Loose } from '../../types/records';

export type DashboardHeaderProps = {
    activeTab: string;
    timeRange: string;
    onTimeRangeChange: (id: string) => void;
    locationOptions: string[];
    location: string;
    onLocationChange: (value: string) => void;
    currentUser: Loose | null;
    /** The People filter, for anyone who can see more than their own; null otherwise. */
    people: PeopleFilter | null;
    /** The Calendar tab follows it too (Users & Roles → Visits → Team calendar). */
    showPeopleOnCalendar?: boolean;
    /** The menu button shows when the side nav is closed or on a phone. */
    showMenuButton: boolean;
    onOpenSidebar: () => void;
    onExportVisits: () => void;
    onOpenCalendarSync: () => void;
    canAddVisits: boolean;
    onAddResource: () => void;
    onAddVisit: () => void;
};

/** The Dashboard's title, date and actions (time range, branch, export, calendar sync, add). */
export default function DashboardHeader({
    activeTab: activeDashboardTab, timeRange, onTimeRangeChange, locationOptions, location, onLocationChange, currentUser, people, showPeopleOnCalendar = false,
    showMenuButton, onOpenSidebar, onExportVisits, onOpenCalendarSync, canAddVisits, onAddResource, onAddVisit
}: DashboardHeaderProps) {
    return (
        <div className="dashboard-header-v2">
            <div className="dashboard-header-content">
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
                <div className="dashboard-actions">
                    <DashboardRange value={timeRange} onChange={onTimeRangeChange} />
                    {activeDashboardTab === 'visits' && (
                        <>
                            <LocationFilter
                                options={locationOptions}
                                value={location}
                                onChange={onLocationChange}
                                user={currentUser}
                                active={Boolean(people?.active)}
                                onClear={people?.onReset}
                            >
                                {people ? <PeopleField {...people} /> : null}
                            </LocationFilter>
                            <RowMenu
                                label="More"
                                items={[{ key: 'export', label: 'Export to Excel', icon: Download, onClick: () => onExportVisits() }]}
                            />
                        </>
                    )}
                    {activeDashboardTab === 'planner' && people && showPeopleOnCalendar && (
                        <LocationFilter
                            options={locationOptions}
                            value={location}
                            onChange={onLocationChange}
                            user={currentUser}
                            active={Boolean(people.active)}
                            onClear={people.onReset}
                        >
                            <PeopleField {...people} />
                        </LocationFilter>
                    )}
                    {activeDashboardTab === 'planner' && (
                        <button 
                            className="btn-secondary" 
                            onClick={() => onOpenCalendarSync()} 
                            title="Sync to Apple / Google Calendar"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            📅 Sync Calendar
                        </button>
                    )}
                    {canAddVisits && (
                        <>
                            <button className="btn-secondary" onClick={onAddResource} title="Add Resource for any Client">
                                + Add Resource
                            </button>
                            <button className="btn-primary" onClick={onAddVisit} title="Add Visit for any Client">
                                + Add Visit
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
