import ErrorBoundary from '../../components/shared/ErrorBoundary';
import DashboardHeader from './DashboardHeader';
import DashboardStats from './components/DashboardStats';
import { CalendarPanel } from './calendar';
import { VisitsPanel } from './visits';
import { FollowUpsPanel } from './followUps';
import { ResourcesPanel } from './resources';
import type { DashboardData } from './useDashboardData';
import type { TeamFiles } from './teamFiles';
import type { Loose } from '../../types/records';

export type DashboardPageProps = {
    /** The dashboard's data (useDashboardData). */
    data: DashboardData;
    /** Team Files (useTeamFiles). */
    files: TeamFiles;
    currentUser: Loose | null;
    currentUserId: string | null;
    /** The Customers tab's first page — names for the Today panel. */
    customers: Loose[];
    customerSelection: Loose[];
    customerOptions: Loose[];
    isDropdownLoading: boolean;
    /** A tab's own loading view while its code loads. */
    fallback: React.ReactNode;
    /** The menu button shows when the side nav is closed or on a phone. */
    showMenuButton: boolean;
    onOpenSidebar: () => void;
    /** The visit or resource being opened for Edit / View (its buttons wait). */
    loadingVisitId: string | null;
    loadingResourceId: string | null;
    onOpenCalendarSync: () => void;
    onAddVisit: () => void;
    onAddResource: () => void;
    onViewVisit: (visit: Loose) => void;
    onEditVisit: (visit: Loose) => void;
    onDeleteVisit: (visitId: string, customerId?: string | null) => void;
    onOpenVisitCard: (visit: Loose) => void;
    onViewResource: (resource: Loose) => void;
    onEditResource: (resource: Loose) => void;
    onDeleteResource: (resourceId: string, customerId?: string | null) => void;
    onOpenGallery: (images: string[], index: number) => void;
    /** A customer's profile (the page leaves the dashboard). */
    onOpenCustomer: (customerId: string) => void;
    /** A customer's Resources tab (the page leaves the dashboard). */
    onOpenCustomerResources: (customerId: string) => void;
    /** The planner picked a customer. */
    onSelectCustomer: (customer: Loose) => void;
    /** The Leads tab is the Customers module's partner sheet. */
    renderLeads: () => React.ReactNode;
};

/**
 * The Sales dashboard: header, the four tiles and the tab the tiles pick —
 * Sales Visits, Resources, Follow-up or Calendar (MIGRATION_NOTES.md §4,
 * step A6). The tabs are modules of their own; this page only wires them to
 * the dashboard's data and hands changes back as callbacks.
 */
export default function DashboardPage({
    data, files, currentUser, currentUserId, customers, customerSelection, customerOptions, isDropdownLoading, fallback, showMenuButton,
    onOpenSidebar, loadingVisitId, loadingResourceId, onOpenCalendarSync, onAddVisit, onAddResource, onViewVisit, onEditVisit, onDeleteVisit,
    onOpenVisitCard, onViewResource, onEditResource, onDeleteResource, onOpenGallery, onOpenCustomer, onOpenCustomerResources,
    onSelectCustomer, renderLeads
}: DashboardPageProps) {
    const tab = data.activeDashboardTab;
    return (
        <ErrorBoundary key="dashboard-view">
            <div className="sales-dashboard-v2">
                {/* No skeleton gated on `loading` here: that flag is the Customers
                    list, which the dashboard doesn't render from (it has its own
                    /api/dashboard/* data, and its tables show "Loading…" until that
                    lands — see dashboardTableLoading). Waiting on it left the main
                    area blank for ~2s after login, after the dashboard data had arrived. */}
                <>
                    <DashboardHeader
                        activeTab={tab}
                        timeRange={data.dashboardTimeRange}
                        onTimeRangeChange={data.setDashboardTimeRange}
                        locationOptions={data.dashboardLocationOptions}
                        location={data.dashboardLocation}
                        onLocationChange={data.handleDashboardLocationChange}
                        currentUser={currentUser}
                        showMenuButton={showMenuButton}
                        onOpenSidebar={onOpenSidebar}
                        onExportVisits={() => data.handleExportVisits()}
                        onOpenCalendarSync={onOpenCalendarSync}
                        canAddVisits={data.canAddVisits}
                        onAddResource={onAddResource}
                        onAddVisit={onAddVisit}
                    />

                    <DashboardStats
                        stats={data.stats}
                        statsLoading={data.statsLoading}
                        dashboardTimeRange={data.dashboardTimeRange}
                        activeDashboardTab={tab}
                        setActiveDashboardTab={data.setActiveDashboardTab}
                        todayScheduleCount={data.todayScheduleCount}
                    />

                    {tab === 'planner' && (
                        <CalendarPanel
                            customerSelection={customerSelection}
                            customerOptions={customerOptions}
                            isDropdownLoading={isDropdownLoading}
                            currentUserId={currentUserId}
                            fallback={fallback}
                            onSelectCustomer={onSelectCustomer}
                            onScheduleChange={data.fetchSchedules}
                        />
                    )}

                    {tab === 'visits' && (
                        <VisitsPanel
                            pagedVisits={data.pagedDashboardVisits}
                            totalCount={data.memoizedFilteredVisits.length}
                            searchTerm={data.dashboardSearchTerm}
                            onSearchChange={data.setDashboardSearchTerm}
                            page={data.currentVisitsPage}
                            rowsPerPage={data.visitsPerPage}
                            onPageChange={data.setCurrentVisitsPage}
                            onRowsPerPageChange={data.handleVisitsPerPageChange}
                            tableLoading={data.dashboardTableLoading}
                            busyVisitId={loadingVisitId}
                            currentUser={currentUser}
                            currentUserId={currentUserId}
                            customers={customers}
                            schedules={data.allSchedules}
                            followUpPanel={data.followUpPanel}
                            followUpCount={data.stats.followUp}
                            onOpenTab={data.setActiveDashboardTab}
                            onOpenVisitCard={onOpenVisitCard}
                            onEditVisit={onEditVisit}
                            onDeleteVisit={onDeleteVisit}
                            onOpenGallery={onOpenGallery}
                            onOpenCustomer={onOpenCustomer}
                        />
                    )}

                    {tab === 'followups' && (
                        <FollowUpsPanel
                            rows={data.memoizedFollowups}
                            filter={data.followupFilter}
                            onFilterChange={(filter) => {
                                data.setFollowupFilter(filter);
                                data.setCurrentFollowUpPage(1);
                            }}
                            locationOptions={data.dashboardLocationOptions}
                            location={data.dashboardLocation}
                            onLocationChange={data.handleDashboardLocationChange}
                            currentUser={currentUser}
                            searchTerm={data.dashboardSearchTerm}
                            onSearchChange={data.setDashboardSearchTerm}
                            page={data.currentFollowUpPage}
                            rowsPerPage={data.visitsPerPage}
                            onPageChange={data.setCurrentFollowUpPage}
                            onRowsPerPageChange={data.handleVisitsPerPageChange}
                            tableLoading={data.dashboardTableLoading}
                            onExport={() => data.handleExportVisits(data.memoizedFilteredVisits.filter((v: Loose) => v && (v.nextAction || v.followUp)))}
                            onOpenPlanner={() => data.setActiveDashboardTab('planner')}
                            onViewVisit={onViewVisit}
                            onEditVisit={onEditVisit}
                            onOpenCustomer={onOpenCustomer}
                        />
                    )}

                    {tab === 'leads' && renderLeads()}

                    {tab === 'resources' && (
                        <ResourcesPanel
                            subTab={data.activeResourceSubTab as 'client' | 'team'}
                            onSubTabChange={data.setActiveResourceSubTab}
                            locationOptions={data.dashboardLocationOptions}
                            location={data.dashboardLocation}
                            onLocationChange={data.handleDashboardLocationChange}
                            currentUser={currentUser}
                            searchTerm={data.dashboardSearchTerm}
                            onSearchChange={data.setDashboardSearchTerm}
                            onExport={data.handleExportResources}
                            client={{
                                rows: data.memoizedFilteredResources,
                                tableLoading: data.dashboardTableLoading,
                                page: data.currentResourcesPage,
                                rowsPerPage: data.visitsPerPage,
                                onPageChange: data.setCurrentResourcesPage,
                                onRowsPerPageChange: data.handleVisitsPerPageChange,
                                loadingResourceId,
                                onOpenCustomerResources,
                                onViewResource,
                                onEditResource,
                                onDeleteResource,
                                onOpenGallery,
                                onDownload: files.handleDashboardDownload
                            }}
                            teamControls={{
                                folderPath: files.folderPath,
                                onGoHome: () => {
                                    files.setCurrentFolderId(null);
                                    files.setFolderPath([]);
                                    data.setDashboardSearchTerm('');
                                },
                                onBreadcrumbClick: files.handleBreadcrumbClick,
                                onRefresh: files.fetchDashboardResources,
                                onAddFolder: () => { files.setFolderName(''); files.setShowAddFolderModal(true); },
                                onUpload: () => {
                                    files.setDashboardUploadForm({ name: '', type: 'file', content: '', file: null });
                                    files.setEditingDashboardResource(null);
                                    files.setShowDashboardUploadModal(true);
                                }
                            }}
                            teamList={{
                                resources: files.salesResources,
                                folderPath: files.folderPath,
                                searchTerm: data.dashboardSearchTerm,
                                onBreadcrumbClick: files.handleBreadcrumbClick,
                                onResourceClick: files.handleResourceClick,
                                onEditResource: files.handleEditDashboardResource,
                                onDeleteResource: files.handleDeleteDashboardResource,
                                onOpenUpload: () => files.setShowDashboardUploadModal(true)
                            }}
                        />
                    )}
                </>
            </div>
        </ErrorBoundary>
    );
}
