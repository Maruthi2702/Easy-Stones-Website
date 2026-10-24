import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import {
    Calendar, MapPin, Phone, Mail, Clock, Plus, Search,
    Filter, X, Upload, Home, ArrowLeft,
    CheckCircle, MessageSquare, Heart, ThumbsUp, Send, User, Users, UserCheck, Building, Menu,
    Edit, Trash2, Download, Share2, Pin, PinOff, ChevronLeft, ChevronRight,
    Info, DollarSign, ShieldCheck, FileText, Eye, Paperclip, Loader,
    CreditCard, Edit2, Hash, Smile, UserPlus, FolderPlus, Folder, Link,
    LayoutDashboard, Pencil, FileImage, File, MoreVertical, RefreshCw, FileSearch, ExternalLink,
    Monitor, BookOpen, Lock, Globe, BookUser
} from 'lucide-react';

import { API_URL } from '../config/api';
import { authFetch } from '../api/authFetch';
import { useAuth } from '../context/AuthContext';
import './SalesPage.css';
import './SalesPageChat.css';
import './SalesPageChatImage.css';
import './SalesPageDashboard.css';
import SearchableSelect from '../components/SearchableSelect';
import { formatDate } from '../utils/dateUtils';
import CustomerSidebar from '../components/sales/CustomerSidebar';
import PhoneTabBar from '../components/sales/PhoneTabBar';
import useIsPhone from '../components/shared/form/useIsPhone';
import usePinnedTabs from '../components/sales/usePinnedTabs';
import useNavOrder from '../components/sales/useNavOrder';
import { canAddCustomer, canViewCustomerProfile } from '../utils/customerAccess';
import { NAV_ORDER } from '../utils/usersAccess';
import { CHECKIN_PERMISSIONS } from '../utils/checkInAccess';
import VisitPostCard from '../components/sales/VisitPostCard';
import { useVisitEditor } from '../features/visits';
import { useResourceEditor } from '../features/resources';
import { CustomerProfile, ContactModal, LinkPartnerModal, useCustomerActions, useOpenCustomer, useCustomersPage, getCustomerLevelLabel } from '../features/customers';
import ImageGallery from '../components/shared/ImageGallery';
import { useImageGallery } from '../components/shared/useImageGallery';
import DeleteConfirmModal from '../components/shared/DeleteConfirmModal';
import { useDeleteCheck, makeConfirmDelete } from '../features/salesShell/deleteCheck';
import { useSalesTheme } from '../features/salesShell/useSalesTheme';
import { useSalesDirectory } from '../features/salesShell/useSalesDirectory';
import { useSalesLiveUpdates } from '../features/salesShell/useSalesLiveUpdates';
import SalesTabViews from '../features/salesShell/SalesTabViews';
import TabLoader from '../features/salesShell/TabLoader';
import { useSidebarLayout } from '../features/salesShell/useSidebarLayout';
import { useSalesNavigation } from '../features/salesShell/useSalesNavigation';
import VisitCustomerCard from '../components/sales/VisitCustomerCard';
import Toast from '../components/shared/Toast';
import { CalendarSyncModal, useCalendarSync } from '../features/calendarSync';
import { CheckInLogTab, CheckInDetailModal, useCheckInLog } from '../features/checkin';
import { DashboardPage, useDashboardData, useTeamFiles, TeamFilePreview, TeamFileUploadModal, AddFolderModal } from '../features/dashboard';
import VisitModal from '../components/sales/VisitModal';
import ResourceModal from '../components/sales/ResourceModal';
import AddCustomerModal from '../components/sales/AddCustomerModal';
import UserProfileTab from '../components/sales/UserProfileTab';
import Pagination from '../components/shared/Pagination';
import { DEFAULT_ROWS_PER_PAGE } from '../components/shared/paginationConfig';
import SidebarToggleButton from '../components/shared/SidebarToggleButton';
import LocationFilter from '../components/shared/LocationFilter';
import RowMenu from '../components/shared/RowMenu';
import LocationPicker from '../components/shared/form/LocationPicker';
import CustomerProfileHeader from '../components/sales/customerList/CustomerProfileHeader';
import CustomerDetailsTab from '../components/sales/customerList/CustomerDetailsTab';
import CustomerContactsTab from '../components/sales/customerList/CustomerContactsTab';
import { canDeleteVisit } from '../utils/visitAccess';
import { lazyRetry } from '../utils/lazyRetry';
import { useCustomerOptions, refreshCustomers, addCustomerRecord } from '../api/customerOptions';
import { toCustomerOptions } from '../utils/customerOptions';

import ErrorBoundary from '../components/shared/ErrorBoundary';
import CartDrawer, { CartToast } from '../components/sales/holds/CartDrawer';
import { openHoldLink } from '../components/sales/holds/holdLink';
import { HOLD_VIEW_PERMISSIONS } from '../holds/permissions';
import { PERMITS } from '../permits/permissions';

// Loaded when the Customers list (or Dashboard → Leads) first shows; the other
// pages load the same way in src/features/salesShell/SalesTabViews.tsx.
const PartnersSheet = lazyRetry(() => import('../components/sales/PartnersSheet'));

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
    const currentUserIdRef = useRef(null);
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
    
    const [currentUserId, setCurrentUserId] = useState(currentUser?.id || currentUser?._id || null);

    // Sync currentUserId when currentUser loads
    useEffect(() => {
        if (currentUser) {
            setCurrentUserId(currentUser.id || currentUser._id);
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
    const [routePreselect, setRoutePreselect] = useState(null);
    const canPlanRoutes = !!currentUser?.permissions?.includes('view_route_planner');
    const handlePlanRoute = (rows) => {
        const ids = (rows || []).map(r => r?._id).filter(Boolean);
        if (!ids.length) return;
        setRoutePreselect({ ids, nonce: Date.now() });
        setRoutePlannerOpened(true);
        handleCrmTabChange('route_planner');
    };


    // The cart's "Hold #12 created · Open hold": that hold's page, for anyone
    // who may see holds (src/components/sales/holds/holdLink.js).
    const canSeeHolds = HOLD_VIEW_PERMISSIONS.some((p) => currentUser?.permissions?.includes(p));
    const openHoldFromCart = canSeeHolds ? (holdId) => {
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
    const [visitCardFor, setVisitCardFor] = useState(null);
    // A short message at the bottom: "Visit saved", or why a save failed.
    const [saveToast, setSaveToast] = useState(null);
    const showSaveToast = (text, kind = 'ok') => setSaveToast({ id: Date.now(), text, kind });
    const dismissSaveToast = useCallback(() => setSaveToast(null), []);
    const [isChatFullScreen] = useState(false);


    // Under 640px the bottom tab bar replaces the drawer (PhoneTabBar.jsx).
    const isPhone = useIsPhone();

    // Form states


    const [expandedResourceId, setExpandedResourceId] = useState(null);
    // The full-screen photo / PDF viewer (ImageGallery).
    const { fullScreenImage, setFullScreenImage, fullScreenIndex, galleryCount, handleOpenGallery, handleNextImage, handlePrevImage, closeGallery } = useImageGallery();
    const [activeReactionMessageId, setActiveReactionMessageId] = useState(null);

    // Sales Dashboard State


    const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
    // Values a new customer opens with (Permits → a contractor's "Create customer"); null for a blank form.
    const [customerPrefill, setCustomerPrefill] = useState(null);

    // The one "Confirm Deletion" check (src/features/salesShell/deleteCheck.ts).
    const { deleteConfirmation, setDeleteConfirmation, cancelDelete } = useDeleteCheck();



    const resourceTypes = [
        "Moda Tower 2024 version 2",
        "Moda Tabletop 2024 version 1",
        "Ascale Tower 2023 version1",
        "Ascale Tabletop 2023 version 1",
        "Ascale A&D Box 2023 version 1",
        "Radianz Tower 2023 version 1",
        "Radianz Tabletop 2023 version 1",
        "Moda Tower 2023 version 1",
        "Moda Misc. Samples",
        "Radianz Misc. Samples",
        "Ascale Misc. Samples",
        "Moda Sample Binder SouthV1 12",
        "Moda Sample Binder SouthEast V1 12",
        "Moda Sample Binder NorthWest V1 12",
        "2025V3 Moda Tower Updated 24>25",
        "2025V3 Moda Tower"
    ];
    const teamFiles = useTeamFiles({ showDashboard, activeResourceSubTab, resourceRefreshTrigger, setIsSaving, fetchDashboardData, fetchDashboardStats, setDeleteConfirmation });
    const {
        fetchDashboardResources, handleDashboardDownload
    } = teamFiles;

    // Current user ID is managed directly via AuthContext (currentUser)






    const handleCreateCustomer = async (formData, closeModal) => {
        try {
            setIsSaving(true);

            // Smart Retry Logic for cold-starts/stale connections
            let response;
            let lastError;
            const maxRetries = 1;

            for (let i = 0; i <= maxRetries; i++) {
                try {
                    response = await authFetch(`${API_URL}/api/customers`, {
                        method: 'POST',
                        body: JSON.stringify(formData)
                    });

                    if (response.ok) break;

                    const errorJson = await response.json().catch(() => ({}));
                    lastError = new Error(errorJson.message || 'Failed to create customer');
                } catch (err) {
                    lastError = err;
                }

                if (i < maxRetries) {
                    console.warn(`[Retry] Customer creation attempt ${i + 1} failed. Retrying once...`);
                    await new Promise(resolve => setTimeout(resolve, 1500)); // wait 1.5s
                }
            }

            if (!response || !response.ok) {
                throw lastError || new Error('Failed to create customer');
            }

            const newCustomer = await response.json();
            // silent=true: fetchCustomers' own cache has no bearing on
            // whether the customer we JUST created shows up — skip straight
            // to a fresh fetch instead of possibly redisplaying the
            // pre-create cached page.
            // In the shared dropdown list at once, so the form that asked for it
            // can show it selected; the refetch then brings everything else.
            addCustomerRecord(newCustomer);
            await Promise.all([fetchCustomers(true), refreshCustomers()]);
            closeModal();
            // Opened from the Visit form's "New customer": it's the visit's customer.
            if (showVisitModal && !isViewingVisit && newCustomer?._id) {
                setVisitForm(prev => ({ ...prev, customerId: newCustomer._id }));
            }
            handleSelectCustomer(newCustomer);
        } catch (error) {
            console.error('Error creating customer:', error);
            alert(error.message || 'Failed to create customer');
        } finally {
            setIsSaving(false);
        }
    };




    const {
        showCustomerAtOnce, clearCustomer,
        selectedCustomerDetail, setSelectedCustomerDetail, visitsLoading, customerCacheRef, fetchSingleCustomer,
        selectedCustomer, patchOpenCustomerVisits, removeOpenCustomerVisit
    } = useOpenCustomer({
        currentUser, customers, selectedCustomerId,
        // The quick note and account fields are useCustomerActions' (below);
        // these run only once a customer loads, after this render.
        onOpening: () => { setResetPasswordValue(''); setAccountActionStatus(null); },
        onShown: (record) => setQuickNote(record.quickNote || '')
    });

    // Link a partner: the same customer options, minus this account and the
    // ones already linked, with the type in the line under the name.
    const linkableCustomerOptions = React.useMemo(() => {
        const linkedIds = new Set((selectedCustomer?.associatedCustomers || []).map(p => String(p._id)));
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
    const refreshAfterSave = (targetCustomerId, { dashboard = true, schedules = false } = {}) => {
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

    const {
        showVisitModal, editingVisit, isViewingVisit, visitForm, setVisitForm, visitUploading,
        loadingVisitId, handleEditVisit, handleViewVisit, handleCloseVisitModal, handleSaveVisit, handleQuickAddVisit,
        handleAddVisitForPin, handleDeleteVisit, handleVisitImageUpload, handleRemoveVisitImage
    } = useVisitEditor({ currentUser, selectedCustomerId, selectedCustomer, customers, customerOptions, patchOpenCustomerVisits, removeOpenCustomerVisit, patchDashboardVisit, removeDashboardVisit, setCurrentFollowUpPage, showSaveToast, refreshAfterSave, setDeleteConfirmation });
    const {
        showResourceModal, setShowResourceModal, editingResource, isViewingResource, resourceForm, setResourceForm,
        loadingResourceId, handleQuickAddResource, handleAddResourceForPin, handleAddResource, handleEditResource, handleViewResource,
        handleSaveResource, handleDeleteResource, handleResourceImageUpload, handleRemoveResourceImage
    } = useResourceEditor({ selectedCustomerId, selectedCustomer, setIsSaving, refreshAfterSave, setDeleteConfirmation });
    const {
        showContactModal, setShowContactModal, editingContact, showLinkPartnerModal, setShowLinkPartnerModal, linkingPartnerId,
        setLinkingPartnerId, isLinkingInProgress, handleLinkPartner, handleUnlinkPartner, quickNote, setQuickNote,
        isSavingNote, resetPasswordValue, setResetPasswordValue, accountActionStatus, setAccountActionStatus, contactForm,
        setContactForm, handleAddContact, handleEditContact, handleSaveContact, handleDeleteContact, handleSaveQuickNote,
        handleToggleCustomerStatus, handleResetCustomerPassword, handleReaction
    } = useCustomerActions({ selectedCustomer, selectedCustomerId, selectedCustomerDetail, setSelectedCustomerDetail, fetchSingleCustomer, setIsSaving, refreshAfterSave, setDeleteConfirmation });



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
                    <>
                    {selectedCustomer && (
                        <CustomerProfile
                            customerId={selectedCustomerId}
                            customer={selectedCustomer}
                            detail={selectedCustomerDetail}
                            activeTab={activeTab}
                            onTab={handleActiveTabChange}
                            onBack={handleBackToCustomersList}
                            onGoHome={handleGoHome}
                            onStatusChanged={(status) => {
                                setSelectedCustomerDetail(prev => (prev ? { ...prev, status } : prev));
                                const cached = customerCacheRef.current[selectedCustomerId];
                                if (cached) customerCacheRef.current[selectedCustomerId] = { ...cached, status };
                            }}
                            currentUser={currentUser}
                            currentUserId={currentUserId}
                            visitsLoading={visitsLoading}
                            historyLoading={visitsLoading || (!selectedCustomerDetail?.visits && !customerCacheRef.current[selectedCustomerId])}
                            levelLabel={getCustomerLevelLabel(selectedCustomer)}
                            canAddVisits={canAddVisits}
                            customers={customers}
                            loadingResourceId={loadingResourceId}
                            quickNote={quickNote}
                            onQuickNoteChange={setQuickNote}
                            onSaveQuickNote={handleSaveQuickNote}
                            savingNote={isSavingNote}
                            accountStatus={accountActionStatus}
                            onToggleActive={() => handleToggleCustomerStatus(selectedCustomerDetail?._id, selectedCustomerDetail?.isActive ?? true)}
                            resetPassword={resetPasswordValue}
                            onResetPasswordChange={setResetPasswordValue}
                            onResetPassword={() => handleResetCustomerPassword(selectedCustomerDetail?._id)}
                            onAddContact={handleAddContact}
                            onEditContact={handleEditContact}
                            onDeleteContact={handleDeleteContact}
                            onAddVisit={handleQuickAddVisit}
                            onAddResource={handleAddResource}
                            onReaction={handleReaction}
                            onEditVisit={handleEditVisit}
                            onDeleteVisit={handleDeleteVisit}
                            onViewResource={handleViewResource}
                            onEditResource={handleEditResource}
                            onDeleteResource={handleDeleteResource}
                            onOpenGallery={handleOpenGallery}
                            onOpenCustomer={handleSelectCustomer}
                        expandedResourceId={expandedResourceId}
                        setExpandedResourceId={setExpandedResourceId}
                        activeReactionMessageId={activeReactionMessageId}
                        setActiveReactionMessageId={setActiveReactionMessageId}
                            onUnlinkPartner={handleUnlinkPartner}
                            onLinkPartner={() => setShowLinkPartnerModal(true)}
                        />
                    )}
                    {/* Kept mounted at all times (hidden via CSS, not
                        conditionally rendered) whenever a customer is open.
                        This used to live in the ) : ( branch of the
                        ErrorBoundary above, whose key changed with
                        selectedCustomerId — deselecting a customer changed
                        that key from the id back to 'no-customer', which
                        force-remounted this list and wiped every filter/tab/
                        search it held (reported: Partners tab + Type=Builder
                        filter gone after opening and closing a customer). */}
                    <div style={{ display: selectedCustomer ? 'none' : 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                        <ErrorBoundary key="customers-list">
                            <div className="sales-dashboard-v2">
                                <Suspense fallback={<TabLoader />}>
                                <PartnersSheet
                                    onSelectCustomer={handleSelectCustomer}
                                    onToggleSidebar={() => setIsSidebarOpen(true)}
                                    isSidebarOpen={isSidebarOpen}
                                    customerRefreshTrigger={customerRefreshTrigger}
                                    onPlanRoute={canPlanRoutes ? handlePlanRoute : undefined}
                                />
                                </Suspense>
                            </div>
                        </ErrorBoundary>
                    </div>
                    </>
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
                                            <Suspense fallback={<TabLoader />}>
                                            <PartnersSheet
                                                onSelectCustomer={handleSelectCustomer}
                                                onToggleSidebar={() => setIsSidebarOpen(true)}
                                                isSidebarOpen={isSidebarOpen}
                                                customerRefreshTrigger={customerRefreshTrigger}
                                                onPlanRoute={canPlanRoutes ? handlePlanRoute : undefined}
                                             />
                                            </Suspense>
                )}
            />
            )}

                {/* Dashboard Resource Preview Modal */}
                {teamFiles.previewDashboardResource && (
                    <TeamFilePreview
                        resource={teamFiles.previewDashboardResource}
                        onClose={() => teamFiles.setPreviewDashboardResource(null)}
                        onDownload={teamFiles.handleDashboardDownload}
                    />
                )}

                {/* Contact Modal */}
                {showContactModal && (
                    <ContactModal
                        form={contactForm}
                        onChange={setContactForm}
                        isEditing={Boolean(editingContact)}
                        isSaving={isSaving}
                        onSave={handleSaveContact}
                        onClose={() => setShowContactModal(false)}
                    />
                )}

                <Toast toast={saveToast} onDismiss={dismissSaveToast} />
                {/* Visit Modal, and the basic card from a dashboard visit's customer name */}
                {visitCardFor && (
                    <VisitCustomerCard
                        visit={visitCardFor}
                        canProfile={canViewCustomerProfile(currentUser)}
                        onClose={() => setVisitCardFor(null)}
                        onOpenProfile={(c) => {
                            setVisitCardFor(null);
                            handleSelectCustomer({ _id: c._id });
                            setShowDashboard(false);
                        }}
                    />
                )}
                <VisitModal
                    showVisitModal={showVisitModal}
                    isViewingVisit={isViewingVisit}
                    handleCloseVisitModal={handleCloseVisitModal}
                    editingVisit={editingVisit}
                    visitForm={visitForm}
                    setVisitForm={setVisitForm}
                    customerOptions={customerOptions}
                    isDropdownLoading={isDropdownLoading}
                    isSaving={isSaving}
                    handleSaveVisit={handleSaveVisit}
                    handleVisitImageUpload={handleVisitImageUpload}
                    visitUploading={visitUploading}
                    handleRemoveVisitImage={handleRemoveVisitImage}
                    selectedCustomer={selectedCustomer}
                    customers={customers}
                    handleDashboardDownload={handleDashboardDownload}
                    setFullScreenImage={setFullScreenImage}
                    handleOpenGallery={handleOpenGallery}
                    onCreateNew={openNewCustomer}
                    suspended={showAddCustomerModal}
                    // Users & Roles → Visits → Delete own / branch / all (visitAccess.js).
                    canDelete={Boolean(editingVisit?._id) && canDeleteVisit(
                        { ...currentUser, id: currentUserId },
                        editingVisit,
                        editingVisit?.location || (selectedCustomer?._id === editingVisit?.customerId ? selectedCustomer?.location : undefined)
                    )}
                    // The form closes first: the delete check is a page modal and
                    // would otherwise open underneath it.
                    onDelete={() => {
                        const { _id, customerId } = editingVisit;
                        handleCloseVisitModal();
                        handleDeleteVisit(_id, customerId);
                    }}
                />

                {/* Calendar Sync Modal (src/features/calendarSync) */}
                {showCalendarSyncModal && (
                    <CalendarSyncModal sync={calendarSync} userId={currentUserId} onClose={() => setShowCalendarSyncModal(false)} />
                )}

                {/* Link Partner Modal */}
                {showLinkPartnerModal && (
                    <LinkPartnerModal
                        options={linkableCustomerOptions}
                        value={linkingPartnerId}
                        onChange={setLinkingPartnerId}
                        loading={isDropdownLoading}
                        linking={isLinkingInProgress}
                        onSubmit={handleLinkPartner}
                        onClose={() => { setShowLinkPartnerModal(false); setLinkingPartnerId(''); }}
                    />
                )}

                <ResourceModal
                    showResourceModal={showResourceModal}
                    setShowResourceModal={setShowResourceModal}
                    editingResource={editingResource}
                    isViewingResource={isViewingResource}
                    resourceForm={resourceForm}
                    setResourceForm={setResourceForm}
                    customerOptions={customerOptions}
                    isDropdownLoading={isDropdownLoading}
                    customers={customers}
                    resourceTypes={resourceTypes}
                    formatDate={formatDate}
                    API_URL={API_URL}
                    isSaving={isSaving}
                    handleSaveResource={handleSaveResource}
                    handleResourceImageUpload={handleResourceImageUpload}
                    handleRemoveResourceImage={handleRemoveResourceImage}
                    handleDashboardDownload={handleDashboardDownload}
                    setFullScreenImage={setFullScreenImage}
                    handleOpenGallery={handleOpenGallery}
                    onCreateNew={openNewCustomer}
                />

                {fullScreenImage && (
                    <ImageGallery image={fullScreenImage} index={fullScreenIndex} count={galleryCount} onPrev={handlePrevImage} onNext={handleNextImage} onClose={closeGallery} />
                )}


                <AddCustomerModal
                    show={showAddCustomerModal}
                    onClose={() => { setShowAddCustomerModal(false); setCustomerPrefill(null); }}
                    prefill={customerPrefill}
                    onSave={handleCreateCustomer}
                    isSaving={isSaving}
                    salesReps={salesReps}
                    locations={locations.map(loc => loc.name).filter(Boolean)}
                    currentUser={currentUser}
                />

                {/* Dashboard Upload Modal */}
                {teamFiles.showDashboardUploadModal && (
                    <TeamFileUploadModal
                        form={teamFiles.dashboardUploadForm}
                        onChange={teamFiles.setDashboardUploadForm}
                        onUpload={teamFiles.handleDashboardUpload}
                        onClose={() => teamFiles.setShowDashboardUploadModal(false)}
                    />
                )}

                {/* Add Folder Modal */}
                {teamFiles.showAddFolderModal && (
                    <AddFolderModal
                        name={teamFiles.folderName}
                        onNameChange={teamFiles.setFolderName}
                        onCreate={teamFiles.handleCreateFolder}
                        onClose={() => teamFiles.setShowAddFolderModal(false)}
                    />
                )}

                {/* Custom Delete Confirmation Modal */}
                {deleteConfirmation.isOpen && (
                    <DeleteConfirmModal request={deleteConfirmation} onConfirm={confirmDelete} onCancel={cancelDelete} />
                )}

                {/* Check-In Detail/Edit Modal (src/features/checkin) */}
                <CheckInDetailModal log={checkInLog} locations={locations} currentUser={currentUser} />
            </div >
        </div >
    );
};

export default SalesPage;
