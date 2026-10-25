import { Download, Menu } from 'lucide-react';
import LocationFilter from '../../components/shared/LocationFilter';
import RowMenu from '../../components/shared/RowMenu';
import { DashboardRange } from './components/DashboardStats';
import type { Loose } from '../../types/records';

export type DashboardHeaderProps = {
    activeTab: string;
    timeRange: string;
    onTimeRangeChange: (id: string) => void;
    locationOptions: string[];
    location: string;
    onLocationChange: (value: string) => void;
    currentUser: Loose | null;
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
    activeTab: activeDashboardTab, timeRange, onTimeRangeChange, locationOptions, location, onLocationChange, currentUser,
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
                            />
                            <RowMenu
                                label="More"
                                items={[{ key: 'export', label: 'Export to Excel', icon: Download, onClick: () => onExportVisits() }]}
                            />
                        </>
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
