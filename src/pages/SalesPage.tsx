import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Filter, Loader, Link } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { Loose } from '../types/records';
import './SalesPage.css';
import './SalesPageChat.css';
import './SalesPageChatImage.css';
import './SalesPageDashboard.css';
import SearchableSelect from '../components/SearchableSelect';
import CustomerSidebar from '../components/sales/CustomerSidebar';
import PhoneTabBar from '../components/sales/PhoneTabBar';
import useIsPhone from '../components/shared/form/useIsPhone';
import usePinnedTabs from '../components/sales/usePinnedTabs';
import useNavOrder from '../components/sales/useNavOrder';
import { canAddCustomer } from '../utils/customerAccess';
import { useVisitEditor } from '../features/visits';
import { useResourceEditor } from '../features/resources';
import { useCustomerActions, useOpenCustomer, useCustomersPage, useCreateCustomer } from '../features/customers';
import ImageGallery from '../components/shared/ImageGallery';
import { useImageGallery } from '../components/shared/useImageGallery';
import { useDeleteCheck, makeConfirmDelete } from '../features/salesShell/deleteCheck';
import { useSalesTheme } from '../features/salesShell/useSalesTheme';
import { useSalesDirectory } from '../features/salesShell/useSalesDirectory';
import { useSalesLiveUpdates } from '../features/salesShell/useSalesLiveUpdates';
import SalesTabViews from '../features/salesShell/SalesTabViews';
import TabLoader from '../features/salesShell/TabLoader';
import SalesModals from '../features/salesShell/SalesModals';
import CustomersView from '../features/salesShell/CustomersView';
import CustomersList from '../features/salesShell/CustomersList';
import { useSidebarLayout } from '../features/salesShell/useSidebarLayout';
import { useSalesNavigation } from '../features/salesShell/useSalesNavigation';
import { useCalendarSync } from '../features/calendarSync';
import { useCheckInLog } from '../features/checkin';
import { DashboardPage, useDashboardData, useTeamFiles } from '../features/dashboard';
import { useCustomerOptions } from '../api/customerOptions';
import { toCustomerOptions } from '../utils/customerOptions';
import CartDrawer, { CartToast } from '../components/sales/holds/CartDrawer';
import { openHoldLink } from '../components/sales/holds/holdLink';
import { HOLD_VIEW_PERMISSIONS } from '../holds/permissions';


const SalesPage = () => {
    const { user: currentUser, loading: authLoading, logout } = useAuth();
    
    // Light / dark (src/features/salesShell/useSalesTheme.ts).
    const { theme, toggleTheme } = useSalesTheme();

    // The page's first page of customers (src/features/customers/useCustomersPage.ts).
    const { customers, fetchCustomers } = useCustomersPage({
        // Runs only from a timer, after the dashboard data below exists.
        onSearchChanged: () => { setCurrentVisitsPage(1); setCurrentFollowUpPage(1); setCurrentResourcesPage(1); }
    });
    // The side nav: docked on desktop, a drawer at 1024px and below (src/features/salesShell/useSidebarLayout.ts).
    const { isSidebarOpen, setIsSidebarOpen, isMobile } = useSidebarLayout();
    // Locations and sales reps (src/features/salesShell/useSalesDirectory.ts).
    const { locations, salesReps, fetchLocations, fetchSalesReps } = useSalesDirectory();
    const [customerRefreshTrigger] = useState(0);
    const [resourceRefreshTrigger, setResourceRefreshTrigger] = useState(0);
    const [inventoryAnalysisRefreshTrigger, setInventoryAnalysisRefreshTrigger] = useState(0);
    // The shared customer list behind every customer dropdown (src/api/customerOptions.js).
    const { records: allCustomersForSelection, options: sharedCustomerOptions, loading: isDropdownLoading } = useCustomerOptions();

    // Side nav pins (src/utils/navPins.js). The first one they can open is
    // their default page, ahead of the role-based order below.
    const { pinnedTabs, pinnedTabsRef, togglePin: togglePinnedTab, makeDefault: makeDefaultTab } = usePinnedTabs(currentUser);
    // The admin-set side nav order (Admin → Side Nav Order). One copy here so
    // the nav and that page always agree: a save shows in the nav at once.
    const { order: navOrder, saveOrder: saveNavOrder } = useNavOrder(!!currentUser);

    // Where the page is: the page showing, the open customer, the URL (src/features/salesShell/useSalesNavigation.ts).
    const {
        crmTab, showDashboard, setShowDashboard, selectedCustomerId, activeTab, routePlannerOpened, setRoutePlannerOpened,
        handleCrmTabChange, handleGoHome, handleActiveTabChange, handleSelectCustomer, handleBackToCustomersList
    } = useSalesNavigation({
        currentUser, pinnedTabsRef, isMobile, setIsSidebarOpen,
        // useOpenCustomer and the dashboard come below; these run only from a click or an effect.
        onShowCustomer: (customer) => showCustomerAtOnce(customer),
        onClearCustomer: () => clearCustomer(),
        onGoHomeTab: () => setActiveDashboardTab('visits')
    });
    // The Check-In Log tab: src/features/checkin (its list, filters, counts, export, view/edit/delete).
    const checkInLog = useCheckInLog({ active: crmTab === 'checkin', currentUser, locations, onUnauthorized: logout });

    // The socket handlers are registered once, so they cannot read the current
    // user out of state — on that first render it is still null, and the
    // handler would keep believing that for the rest of the session. Kept in
    // step by the effect next to the currentUserId state below.
    const currentUserIdRef = useRef<string | null>(null);
    // Set after fetchCheckIns below; read by the checkin_update handler.
    const refreshCheckInsRef = useRef(() => {});

    // Live updates from the server (src/features/salesShell/useSalesLiveUpdates.ts).
    useSalesLiveUpdates({
        refreshCheckInsRef,
        currentUserIdRef,
        onCustomersChanged: () => fetchCustomers(true),
        onResourcesChanged: () => setResourceRefreshTrigger(prev => prev + 1),
        onLocationsChanged: () => fetchLocations(),
        onInventoryChanged: () => setInventoryAnalysisRefreshTrigger(prev => prev + 1),
        onMySchedulesChanged: () => fetchSchedules(),
        onStart: () => { fetchLocations(); fetchSalesReps(); }
    });
    
    // A signed-in record always has id or _id; the type says so (the value is kept exactly as it was).
    const [currentUserId, setCurrentUserId] = useState<string | null>((currentUser?.id || currentUser?._id || null) as string | null);

    // Sync currentUserId when currentUser loads
    useEffect(() => {
        if (currentUser) {
            setCurrentUserId((currentUser.id || currentUser._id) as string);
        }
    }, [currentUser]);

    useEffect(() => {
        currentUserIdRef.current = currentUserId;
    }, [currentUserId]);
    const dashboardData = useDashboardData({ currentUser, locations, customers, currentUserId, customerRefreshTrigger, resourceRefreshTrigger });
    const {
        activeDashboardTab, setActiveDashboardTab, activeResourceSubTab, fetchDashboardStats, fetchDashboardData, fetchSchedules,
        canAddVisits, setCurrentVisitsPage, setCurrentFollowUpPage, setCurrentResourcesPage, patchDashboardVisit, removeDashboardVisit
    } = dashboardData;

    // "Plan route" from the customer list's selection bar: open Route Planner
    // with those customers already selected (RoutePlannerV2's preselect prop).
    const [routePreselect, setRoutePreselect] = useState<{ ids: string[]; nonce: number } | null>(null);
    const canPlanRoutes = !!currentUser?.permissions?.includes('view_route_planner');
    const handlePlanRoute = (rows: Loose[]) => {
        const ids = (rows || []).map(r => r?._id).filter(Boolean);
        if (!ids.length) return;
        setRoutePreselect({ ids, nonce: Date.now() });
        setRoutePlannerOpened(true);
        handleCrmTabChange('route_planner');
    };

    // The cart's "Hold #12 created · Open hold": that hold's page, for anyone
    // who may see holds (src/components/sales/holds/holdLink.js).
    const canSeeHolds = HOLD_VIEW_PERMISSIONS.some((p) => currentUser?.permissions?.includes(p));
    const openHoldFromCart = canSeeHolds ? (holdId: string | number) => {
        handleCrmTabChange('holds');
        openHoldLink(String(holdId));
    } : undefined;

    // What a live check-in update runs: always the current filters' fetch.
    refreshCheckInsRef.current = () => checkInLog.refresh(true);

    // Modal states
    const [showCalendarSyncModal, setShowCalendarSyncModal] = useState(false);
    // Google / iCloud sync and the .ics feed: src/features/calendarSync.
    const calendarSync = useCalendarSync({ open: showCalendarSyncModal, onSynced: fetchSchedules });

    // "New customer" in a dropdown — only for people the server lets create one
    // (POST /api/customers needs add_customers); undefined hides the option.
    const openNewCustomer = canAddCustomer(currentUser)
        ? () => setShowAddCustomerModal(true)
        : undefined;

    // Every customer dropdown on this page (Visit, Lost sale, Sales planner,
    // Resource, Delivery) reads this one list — names, sorting and the city
    // line come from src/utils/customerOptions.js. Until the shared list has
    // loaded, the page's own first page of customers stands in.
    const customerOptions = React.useMemo(
        () => (sharedCustomerOptions.length > 0 ? sharedCustomerOptions : toCustomerOptions(customers || [])),
        [sharedCustomerOptions, customers]
    );

    const [isSaving, setIsSaving] = useState(false);
    // Visit photos go up the moment they are picked, and Save is sent behind the
    // closed form (handleSaveVisit), so the form never waits on either.
    // The visit whose customer's basic card is open (dashboard Sales Visits).
    const [visitCardFor, setVisitCardFor] = useState<Loose | null>(null);
    // A short message at the bottom: "Visit saved", or why a save failed.
    const [saveToast, setSaveToast] = useState<{ id: number; text: string; kind: string } | null>(null);
    const showSaveToast = (text: string, kind = 'ok') => setSaveToast({ id: Date.now(), text, kind });
    const dismissSaveToast = useCallback(() => setSaveToast(null), []);
    const [isChatFullScreen] = useState(false);

    // Under 640px the bottom tab bar replaces the drawer (PhoneTabBar.jsx).
    const isPhone = useIsPhone();

    // Form states

    const [expandedResourceId, setExpandedResourceId] = useState<string | null>(null);
    // The full-screen photo / PDF viewer (ImageGallery).
    const gallery = useImageGallery();
    const { handleOpenGallery } = gallery;
    const [activeReactionMessageId, setActiveReactionMessageId] = useState<string | null>(null);

    // Sales Dashboard State

    const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
    // Values a new customer opens with (Permits → a contractor's "Create customer"); null for a blank form.
    const [customerPrefill, setCustomerPrefill] = useState<Loose | null>(null);

    // The one "Confirm Deletion" check (src/features/salesShell/deleteCheck.ts).
    const { deleteConfirmation, setDeleteConfirmation, cancelDelete } = useDeleteCheck();

    const teamFiles = useTeamFiles({ showDashboard, activeResourceSubTab, resourceRefreshTrigger, setIsSaving, fetchDashboardData, fetchDashboardStats, setDeleteConfirmation });
    const {
        fetchDashboardResources
    } = teamFiles;

    // Current user ID is managed directly via AuthContext (currentUser)

    // Add customer → Save (src/features/customers/useCreateCustomer.ts).
    const { handleCreateCustomer } = useCreateCustomer({
        setIsSaving, fetchCustomers,
        onCreated: (newCustomer) => {
            // Opened from the Visit form's "New customer": it's the visit's customer.
            if (showVisitModal && !isViewingVisit && newCustomer?._id) {
                setVisitForm(prev => ({ ...prev, customerId: newCustomer._id }));
            }
            handleSelectCustomer(newCustomer);
        }
    });

    const openCustomer = useOpenCustomer({
        currentUser, customers, selectedCustomerId,
        // The quick note and account fields are useCustomerActions' (below);
        // these run only once a customer loads, after this render.
        onOpening: () => { setResetPasswordValue(''); setAccountActionStatus(null); },
        onShown: (record) => setQuickNote(record.quickNote || '')
    });
    const {
        showCustomerAtOnce, clearCustomer, selectedCustomerDetail, setSelectedCustomerDetail, fetchSingleCustomer, selectedCustomer,
        patchOpenCustomerVisits, removeOpenCustomerVisit
    } = openCustomer;

    // Link a partner: the same customer options, minus this account and the
    // ones already linked, with the type in the line under the name.
    const linkableCustomerOptions = React.useMemo(() => {
        const linkedIds = new Set((selectedCustomer?.associatedCustomers || []).map((p: Loose) => String(p._id)));
        return customerOptions
            .filter(o => String(o.value) !== String(selectedCustomer?._id) && !linkedIds.has(String(o.value)))
            .map(o => ({ ...o, description: [o.customerType || 'Fabricator', o.city].filter(Boolean).join(' · ') }));
    }, [customerOptions, selectedCustomer]);

    // Filter resources (scoped to selected customer only)

    // Simplified resources (no search filtering)

    /**
     * What a save refreshes, run in the background and all at once.
     *
     * Saves used to await each of these one after another — the customer, then
     * three dashboard queries, then stats, then the schedule — before the form
     * could close, so a save that took the server a fraction of a second kept
     * its spinner going for several. The form now closes as soon as the server
     * confirms; these catch the screens up behind it.
     */
    const refreshAfterSave = (targetCustomerId: string, { dashboard = true, schedules = false } = {}) => {
        const jobs = [
            // Cached copy first (already showing, and patched for a visit),
            // then the server's — no loading state over the open customer.
            selectedCustomerId && targetCustomerId === selectedCustomerId
                ? fetchSingleCustomer(selectedCustomerId)
                : fetchCustomers(true)
        ];
        if (dashboard) jobs.push(fetchDashboardData(), fetchDashboardStats());
        if (schedules) jobs.push(fetchSchedules());
        Promise.allSettled(jobs).then(results => results.forEach(r => {
            if (r.status === 'rejected') console.error('[refreshAfterSave]', r.reason);
        }));
    };

    const visitEditor = useVisitEditor({ currentUser, selectedCustomerId, selectedCustomer, customers, customerOptions, patchOpenCustomerVisits, removeOpenCustomerVisit, patchDashboardVisit, removeDashboardVisit, setCurrentFollowUpPage, showSaveToast, refreshAfterSave, setDeleteConfirmation });
    const {
        showVisitModal, isViewingVisit, setVisitForm, loadingVisitId, handleEditVisit, handleViewVisit,
        handleQuickAddVisit, handleAddVisitForPin, handleDeleteVisit
    } = visitEditor;
    const resourceEditor = useResourceEditor({ selectedCustomerId, selectedCustomer, setIsSaving, refreshAfterSave, setDeleteConfirmation });
    const {
        loadingResourceId, handleQuickAddResource, handleAddResourceForPin, handleEditResource, handleViewResource, handleDeleteResource
    } = resourceEditor;
    const customerActions = useCustomerActions({ selectedCustomer, selectedCustomerId, selectedCustomerDetail, setSelectedCustomerDetail, fetchSingleCustomer, setIsSaving, refreshAfterSave, setDeleteConfirmation });
    const {
        setQuickNote, setResetPasswordValue, setAccountActionStatus
    } = customerActions;

    const confirmDelete = makeConfirmDelete({
        deleteConfirmation, setDeleteConfirmation, selectedCustomerId, activeDashboardTab,
        fetchDashboardResources, fetchDashboardData, fetchDashboardStats, fetchSingleCustomer
    });

    return (
        <div className="sales-container">
            {/* Sidebar Overlay */}
            {isMobile && isSidebarOpen && (
                <div
                    className="sidebar-overlay-backdrop"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <CustomerSidebar
                crmTab={crmTab}
                handleCrmTabChange={handleCrmTabChange}
                isSidebarOpen={isSidebarOpen}
                isMobile={isMobile}
                setIsSidebarOpen={setIsSidebarOpen}
                theme={theme}
                toggleTheme={toggleTheme}
                pinnedTabs={pinnedTabs}
                onTogglePin={togglePinnedTab}
                onMakeDefault={makeDefaultTab}
                navOrder={navOrder}
            />

            {/* Phones get the bottom tab bar instead of the drawer (PhoneTabBar.jsx). */}
            {isPhone && currentUser && (
                <PhoneTabBar
                    crmTab={crmTab}
                    onNavigate={handleCrmTabChange}
                    theme={theme}
                    toggleTheme={toggleTheme}
                    pinnedTabs={pinnedTabs}
                    navOrder={navOrder}
                />
            )}

            {/* The cart drawer (opened from the side rail) and its "added · Open cart" bar. */}
            <CartDrawer user={currentUser} onOpenHold={openHoldFromCart} />
            <CartToast onOpenHold={openHoldFromCart} />

            {/* Main Content */}
            <div
                className={`sales-main ${isChatFullScreen ? 'full-screen' : ''} ${!isSidebarOpen ? 'full-width' : ''}`}
                style={{
                    position: 'relative'
                }}
            >

                {/* Show a loading spinner while permissions are being fetched */}
                {(authLoading || !currentUser?.permissions) && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: '1rem' }}>
                        <Loader size={32} className="animate-spin" style={{ color: '#d4af37' }} />
                        <span style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 500 }}>Loading your workspace...</span>
                    </div>
                )}

                {/* Every page but the Dashboard and Customers (src/features/salesShell/SalesTabViews.tsx). */}
                <SalesTabViews
                    ready={Boolean(!authLoading && currentUser?.permissions)}
                    crmTab={crmTab}
                    currentUser={currentUser}
                    theme={theme}
                    isSidebarOpen={isSidebarOpen}
                    isMobile={isMobile}
                    onOpenSidebar={() => setIsSidebarOpen(true)}
                    onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                    checkInLog={checkInLog}
                    locations={locations}
                    fetchLocations={fetchLocations}
                    customersList={allCustomersForSelection.length > 0 ? allCustomersForSelection : (customers || [])}
                    customerOptions={customerOptions}
                    isDropdownLoading={isDropdownLoading}
                    inventoryRefreshSignal={inventoryAnalysisRefreshTrigger}
                    navOrder={navOrder}
                    onSaveNavOrder={saveNavOrder}
                    canSeeHolds={canSeeHolds}
                    routePlannerOpened={routePlannerOpened}
                    routePreselect={routePreselect}
                    canAddVisits={canAddVisits}
                    onGoHome={handleGoHome}
                    onOpenCustomer={(id, origin) => handleSelectCustomer({ _id: id }, origin)}
                    onCreateCustomer={openNewCustomer}
                    onCreatePrefilledCustomer={openNewCustomer ? (values) => { setCustomerPrefill(values); setShowAddCustomerModal(true); } : null}
                    onAddVisitForPin={handleAddVisitForPin}
                    onAddResourceForPin={handleAddResourceForPin}
                />

                {!authLoading && currentUser?.permissions && crmTab === 'customers' && currentUser.permissions.includes('view_customers') && (
                    <CustomersView
                        open={openCustomer}
                        actions={customerActions}
                        visits={visitEditor}
                        resources={resourceEditor}
                        selectedCustomerId={selectedCustomerId}
                        activeTab={activeTab}
                        onTab={handleActiveTabChange}
                        onBack={handleBackToCustomersList}
                        onGoHome={handleGoHome}
                        onOpenCustomer={handleSelectCustomer}
                        currentUser={currentUser}
                        currentUserId={currentUserId}
                        canAddVisits={canAddVisits}
                        customers={customers}
                        onOpenGallery={handleOpenGallery}
                        expandedResourceId={expandedResourceId}
                        setExpandedResourceId={setExpandedResourceId}
                        activeReactionMessageId={activeReactionMessageId}
                        setActiveReactionMessageId={setActiveReactionMessageId}
                        list={{
                            onSelectCustomer: handleSelectCustomer,
                            onOpenSidebar: () => setIsSidebarOpen(true),
                            isSidebarOpen,
                            customerRefreshTrigger,
                            onPlanRoute: canPlanRoutes ? handlePlanRoute : undefined
                        }}
                    />
                )}

            {!authLoading && currentUser?.permissions && crmTab === 'dashboard' && currentUser.permissions.includes('view_dashboard') && (
            <DashboardPage
                data={dashboardData}
                files={teamFiles}
                currentUser={currentUser}
                currentUserId={currentUserId}
                customers={customers}
                customerSelection={allCustomersForSelection}
                customerOptions={customerOptions}
                isDropdownLoading={isDropdownLoading}
                fallback={<TabLoader />}
                showMenuButton={!isSidebarOpen || isMobile}
                onOpenSidebar={() => setIsSidebarOpen(true)}
                loadingVisitId={loadingVisitId}
                loadingResourceId={loadingResourceId}
                onOpenCalendarSync={() => setShowCalendarSyncModal(true)}
                onAddVisit={handleQuickAddVisit}
                onAddResource={handleQuickAddResource}
                onViewVisit={handleViewVisit}
                onEditVisit={handleEditVisit}
                onDeleteVisit={handleDeleteVisit}
                onOpenVisitCard={setVisitCardFor}
                onViewResource={handleViewResource}
                onEditResource={handleEditResource}
                onDeleteResource={handleDeleteResource}
                onOpenGallery={handleOpenGallery}
                onOpenCustomer={(customerId) => {
                    handleSelectCustomer({ _id: customerId });
                    setShowDashboard(false);
                }}
                onOpenCustomerResources={(customerId) => {
                    handleSelectCustomer({ _id: customerId });
                    handleActiveTabChange('resources');
                    setShowDashboard(false);
                }}
                onSelectCustomer={handleSelectCustomer}
                renderLeads={() => (
                    <CustomersList
                        onSelectCustomer={handleSelectCustomer}
                        onOpenSidebar={() => setIsSidebarOpen(true)}
                        isSidebarOpen={isSidebarOpen}
                        customerRefreshTrigger={customerRefreshTrigger}
                        onPlanRoute={canPlanRoutes ? handlePlanRoute : undefined}
                    />
                )}
            />
            )}

                {/* Every pop-up, in its stacking order (src/features/salesShell/SalesModals.tsx). */}
                <SalesModals
                    currentUser={currentUser}
                    currentUserId={currentUserId}
                    selectedCustomer={selectedCustomer}
                    customers={customers}
                    customerOptions={customerOptions}
                    linkableCustomerOptions={linkableCustomerOptions}
                    isDropdownLoading={isDropdownLoading}
                    isSaving={isSaving}
                    salesReps={salesReps}
                    locations={locations}
                    onCreateNew={openNewCustomer}
                    visits={visitEditor}
                    resources={resourceEditor}
                    actions={customerActions}
                    teamFiles={teamFiles}
                    gallery={gallery}
                    checkInLog={checkInLog}
                    toast={{ toast: saveToast, onDismiss: dismissSaveToast }}
                    visitCard={{
                        visit: visitCardFor,
                        onClose: () => setVisitCardFor(null),
                        onOpenProfile: (c) => {
                            setVisitCardFor(null);
                            handleSelectCustomer({ _id: c._id });
                            setShowDashboard(false);
                        }
                    }}
                    calendar={{ open: showCalendarSyncModal, sync: calendarSync, onClose: () => setShowCalendarSyncModal(false) }}
                    addCustomer={{
                        show: showAddCustomerModal,
                        prefill: customerPrefill,
                        onClose: () => { setShowAddCustomerModal(false); setCustomerPrefill(null); },
                        onSave: handleCreateCustomer
                    }}
                    deleteCheck={{ request: deleteConfirmation, onConfirm: confirmDelete, onCancel: cancelDelete }}
                />
            </div >
        </div >
    );
};

export default SalesPage;
