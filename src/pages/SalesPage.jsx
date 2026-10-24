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

import { io } from 'socket.io-client';
import { getCachedData, setCachedData, isCacheValid, expireCacheKeys } from '../utils/dataCache';
import { API_URL } from '../config/api';
import { authFetch } from '../api/authFetch';
import { getAuthToken } from '../api/authToken';
import { useAuth } from '../context/AuthContext';
import './SalesPage.css';
import './SalesPageChat.css';
import './SalesPageChatImage.css';
import './SalesPageDashboard.css';
import SearchableSelect from '../components/SearchableSelect';
import { formatForDateInput, formatDate } from '../utils/dateUtils';
import DashboardStats, { DashboardRange } from '../features/dashboard/components/DashboardStats';
import DashboardAside from '../features/dashboard/components/DashboardAside';
import CustomerSidebar from '../components/sales/CustomerSidebar';
import PhoneTabBar from '../components/sales/PhoneTabBar';
import useIsPhone from '../components/shared/form/useIsPhone';
import usePinnedTabs from '../components/sales/usePinnedTabs';
import useNavOrder from '../components/sales/useNavOrder';
import { pinnedDefaultTab, navItem } from '../utils/navPins';
import { canAddCustomer, canViewCustomerProfile } from '../utils/customerAccess';
import { canOpenUsersPage } from '../utils/teamAccess';
import { canOpenArea, can, NAV_ORDER } from '../utils/usersAccess';
import { CHECKIN_PERMISSIONS, canViewCheckInLog } from '../utils/checkInAccess';
import VisitPostCard from '../components/sales/VisitPostCard';
import { newVisitId } from '../utils/visitForm';
import VisitCustomerCard from '../components/sales/VisitCustomerCard';
import Toast from '../components/shared/Toast';
import { CalendarSyncModal, useCalendarSync } from '../features/calendarSync';
import { CheckInLogTab, CheckInDetailModal, useCheckInLog } from '../features/checkin';
import { useDashboardData } from '../features/dashboard/useDashboardData';
import { useTeamFiles } from '../features/dashboard/teamFiles/useTeamFiles';
import VisitModal from '../components/sales/VisitModal';
import ResourceModal from '../components/sales/ResourceModal';
import AddCustomerModal from '../components/sales/AddCustomerModal';
import UserProfileTab from '../components/sales/UserProfileTab';
import Pagination from '../components/shared/Pagination';
import { DEFAULT_ROWS_PER_PAGE } from '../components/shared/paginationConfig';
import SidebarToggleButton from '../components/shared/SidebarToggleButton';
import { formatPhoneInput } from '../utils/phoneUtils';
import { isPdfSource } from '../utils/attachments';
import { openPdfInline } from '../utils/packingList';
import VisitsFocusList from '../features/dashboard/components/VisitsFocusList';
import LocationFilter from '../components/shared/LocationFilter';
import RowMenu from '../components/shared/RowMenu';
import LocationPicker from '../components/shared/form/LocationPicker';
import CustomerProfileHeader from '../components/sales/customerList/CustomerProfileHeader';
import CustomerDetailsTab from '../components/sales/customerList/CustomerDetailsTab';
import CustomerContactsTab from '../components/sales/customerList/CustomerContactsTab';
import { canModifyVisit, canDeleteVisit } from '../utils/visitAccess';
import { clearInventoryCache } from '../api/inventoryAnalysisCache';
import { toSalesRepList } from '../utils/salesReps';
import { lazyRetry } from '../utils/lazyRetry';
import { useCustomerOptions, refreshCustomers, addCustomerRecord } from '../api/customerOptions';
import { toCustomerOptions } from '../utils/customerOptions';

import ErrorBoundary from '../components/shared/ErrorBoundary';
import CartDrawer, { CartToast } from '../components/sales/holds/CartDrawer';
import { cartActions } from '../components/sales/holds/cartStore';
import { openHoldLink } from '../components/sales/holds/holdLink';
import { HOLD_VIEW_PERMISSIONS } from '../holds/permissions';
import { PERMITS } from '../permits/permissions';

// This page eagerly imported every tab it can show — Route Planner's Google
// Maps code, Users & Roles, Price List, all of it — into one bundle loaded
// the moment ANY user opens ANY tab, even Delivery Schedule alone. Only one
// tab is ever on screen at a time (all gated behind crmTab === '…' below),
// so each now loads only once its own tab is actually opened, the same
// lazyRetry pattern src/App.jsx already uses per page route.
const SalesPlannerTab = lazyRetry(() => import('../components/SalesPlannerTab'));
const RoutePlannerV2 = lazyRetry(() => import('../components/sales/routePlannerV2/RoutePlannerV2'));
const PartnersSheet = lazyRetry(() => import('../components/sales/PartnersSheet'));
const PriceListPanel = lazyRetry(() => import('../components/sales/PriceListPanel'));
const UsersRolesTab = lazyRetry(() => import('../components/sales/UsersRolesTab'));
const NavOrderTab = lazyRetry(() => import('../components/sales/NavOrderTab'));
const LostSalesTab = lazyRetry(() => import('../components/sales/LostSalesTab'));
const CrossoverSheetTab = lazyRetry(() => import('../components/sales/CrossoverSheetTab'));
const InventoryAnalysisTab = lazyRetry(() => import('../components/sales/InventoryAnalysisTab'));
const DeliveryScheduleTab = lazyRetry(() => import('../components/sales/DeliveryScheduleTab'));
const DailyReportTab = lazyRetry(() => import('../components/sales/dailyreport/DailyReportTab'));
const FreightTab = lazyRetry(() => import('../components/sales/freight/FreightTab'));
const HoldsTab = lazyRetry(() => import('../components/sales/holds/HoldsTab'));
const PermitsTab = lazyRetry(() => import('../components/sales/permits/PermitsTab'));

// One small, inline fallback rather than a full-page spinner — App.jsx's
// <PageLoader/> is sized for a blank page, and using it here would flash the
// whole dashboard chrome (sidebar, header) to nothing while a single tab's
// chunk loads.
const TabLoader = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
        <Loader size={28} className="animate-spin" style={{ color: '#d4af37' }} />
    </div>
);

const SalesPage = () => {
    const { user: currentUser, loading: authLoading, logout } = useAuth();
    
    const [theme, setTheme] = useState(() => {
        try {
            const saved = localStorage.getItem('checkin_theme');
            return saved === 'dark' ? 'dark' : 'light';
        } catch {
            return 'light';
        }
    });

    useEffect(() => {
        const handleThemeChange = () => {
            try {
                const saved = localStorage.getItem('checkin_theme');
                setTheme(saved === 'dark' ? 'dark' : 'light');
            } catch { /* not fatal — carry on */ }
        };
        window.addEventListener('storage', handleThemeChange);
        window.addEventListener('checkin_theme_changed', handleThemeChange);
        return () => {
            window.removeEventListener('storage', handleThemeChange);
            window.removeEventListener('checkin_theme_changed', handleThemeChange);
        };
    }, []);

    const toggleTheme = () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        try {
            localStorage.setItem('checkin_theme', newTheme);
            setTheme(newTheme);
            window.dispatchEvent(new Event('checkin_theme_changed'));
        } catch (e) {
            console.error('Failed to save theme setting', e);
        }
    };

    useEffect(() => {
        if (theme === 'light') {
            document.body.classList.add('light-theme-active');
        } else {
            document.body.classList.remove('light-theme-active');
        }
        return () => {
            document.body.classList.remove('light-theme-active');
        };
    }, [theme]);

    const [customers, setCustomers] = useState([]);
    const [customerRefreshTrigger] = useState(0);
    const [resourceRefreshTrigger, setResourceRefreshTrigger] = useState(0);
    const [inventoryAnalysisRefreshTrigger, setInventoryAnalysisRefreshTrigger] = useState(0);
    const [locations, setLocations] = useState([]);
    const [salesReps, setSalesReps] = useState([]);
    const [searchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);
    const [selectedCustomerDetail, setSelectedCustomerDetail] = useState(null);
    const [customerOriginTab, setCustomerOriginTab] = useState(null);
    // The shared customer list behind every customer dropdown (src/api/customerOptions.js).
    const { records: allCustomersForSelection, options: sharedCustomerOptions, loading: isDropdownLoading } = useCustomerOptions();
    // Latches on the first visit to the route planner and never clears, so the
    // map it builds survives navigating away and back. See where it renders.
    const [routePlannerOpened, setRoutePlannerOpened] = useState(false);
    const [, setLoading] = useState(true);
    const [, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('visits');

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [, setTotalPages] = useState(1);
    const [, setTotalCustomers] = useState(0);
    const customersPerPage = 50;

    
    // Side nav pins (src/utils/navPins.js). The first one they can open is
    // their default page, ahead of the role-based order below.
    const { pinnedTabs, pinnedTabsRef, togglePin: togglePinnedTab, makeDefault: makeDefaultTab } = usePinnedTabs(currentUser);
    // The admin-set side nav order (Admin → Side Nav Order). One copy here so
    // the nav and that page always agree: a save shows in the nav at once.
    const { order: navOrder, saveOrder: saveNavOrder } = useNavOrder(!!currentUser);

    const getDefaultTab = () => {
        const searchParams = new URLSearchParams(window.location.search);
        const tabParam = searchParams.get('tab');
        if (tabParam) return tabParam;

        const pinned = currentUser ? pinnedDefaultTab(currentUser, pinnedTabsRef.current) : null;
        if (pinned) return pinned;

        const perms = currentUser?.permissions || [];
        if (perms.includes('view_dashboard')) return 'dashboard';
        if (perms.includes(CHECKIN_PERMISSIONS.VIEW_LOG)) return 'checkin';
        if (perms.includes('view_pricelist')) return 'pricelist';
        if (perms.includes('view_customers')) return 'customers';
        if (perms.includes('view_lost_sales')) return 'lost_sales';
        if (perms.includes('view_crossover_sheet')) return 'crossover_sheet';
        if (perms.includes('view_delivery_schedule')) return 'delivery_schedule';
        return 'checkin'; // safe fallback
    };
    const [crmTab, setCrmTab] = useState(getDefaultTab); // 'dashboard', 'customers', 'checkin', 'pricelist', 'delivery_schedule'
    // The Check-In Log tab: src/features/checkin (its list, filters, counts, export, view/edit/delete).
    const checkInLog = useCheckInLog({ active: crmTab === 'checkin', currentUser, locations, onUnauthorized: logout });

    // Staff who can own a customer account, for the Add Customer form's Sales Rep
    // picker. Who qualifies is decided in utils/salesReps.js, so this and the
    // customer list cannot drift apart on it.
    async function fetchSalesReps() {
        try {
            const response = await authFetch(`${API_URL}/api/salesreps`);
            if (!response.ok) return;
            setSalesReps(toSalesRepList(await response.json()));
        } catch (error) {
            console.error('❌ [FETCH] Error fetching sales reps:', error);
        }
    }

    async function fetchLocations() {
        try {
            const response = await authFetch(`${API_URL}/api/admin/locations`);
            if (response.ok) {
                const data = await response.json();
                setLocations(data);
            }
        } catch (error) {
            console.error('❌ [FETCH] Error fetching locations:', error);
        }
    }

    // The socket handlers are registered once, so they cannot read the current
    // user out of state — on that first render it is still null, and the
    // handler would keep believing that for the rest of the session. Kept in
    // step by the effect next to the currentUserId state below.
    const currentUserIdRef = useRef(null);
    // Set after fetchCheckIns below; read by the checkin_update handler.
    const refreshCheckInsRef = useRef(() => {});

    useEffect(() => {
        const socket = io(API_URL || window.location.origin, {
            transports: ['websocket', 'polling'],
            withCredentials: true
        });

        // checkin_update is scoped to the viewer's own assigned location(s)
        // (mirrors join_delivery_rooms for delivery_update) rather than
        // broadcast to every connected socket — this proves who the socket
        // is so the server knows which room(s) to put it in. Re-sent on
        // every reconnect, since a fresh connection joins no rooms until
        // this fires again.
        socket.on('connect', () => {
            const token = getAuthToken();
            if (token) socket.emit('join_checkin_rooms', { token });
        });

        // Through a ref: this handler is registered once, and calling
        // fetchCheckIns directly ran the first render's copy — its page,
        // search, month and branch — so a live update swapped the filtered
        // list for an unfiltered one while the filters still showed. Same
        // fix as the /checkin-log page.
        socket.on('checkin_update', () => {
            expireCacheKeys('checkins_');
            refreshCheckInsRef.current();
        });

        socket.on('customer_update', () => {
            fetchCustomers(true);
            // Every customer dropdown, for a change made by anyone, anywhere.
            refreshCustomers();
        });

        socket.on('resource_update', () => {
            setResourceRefreshTrigger(prev => prev + 1);
        });

        socket.on('location_update', () => {
            fetchLocations();
        });

        // Fired by src/routes/inventoryAnalysis.js after a stock/sales import.
        // Without this, only the importer's own browser (via the modal's
        // onComplete callback) ever saw the new data — everyone else's open
        // Inventory Analysis tab stayed on the pre-import snapshot.
        // Slabs held, released or carted by anyone (src/holds/router.js):
        // the cart and any screen showing slab locks refresh.
        socket.on('slab_reservations_changed', (payload) => {
            cartActions.reservationsChanged(payload?.slabKeys || []);
        });

        socket.on('inventory_analysis_update', () => {
            // Forget remembered Inventory Analysis answers even while that tab
            // isn't open, so the next visit shows the new import, not the old.
            clearInventoryCache();
            setInventoryAnalysisRefreshTrigger(prev => prev + 1);
        });

        // Keeps the Calendar tile honest when a stop is added from another
        // device or pulled in by the Google sync. The planner grid updates
        // itself through the schedule cache; this is only the count above it.
        socket.on('schedule_update', (payload) => {
            const mine = !payload?.userId
                || !currentUserIdRef.current
                || String(payload.userId) === String(currentUserIdRef.current);
            if (mine) fetchSchedules();
        });

        fetchLocations();
        fetchSalesReps();

        return () => {
            socket.disconnect();
        };
    }, []);
    
    const [showDashboard, setShowDashboard] = useState(true);
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
    const {
        dashboardTimeRange, setDashboardTimeRange, dashboardLocationOptions, dashboardLocation, dashboardSearchTerm, setDashboardSearchTerm,
        activeDashboardTab, setActiveDashboardTab, followupFilter, setFollowupFilter, todayScheduleCount, stats,
        statsLoading, followUpPanel, allSchedules, activeResourceSubTab, setActiveResourceSubTab, fetchDashboardStats,
        fetchDashboardData, dashboardTableLoading, fetchSchedules, canAddVisits, memoizedFilteredVisits, memoizedFilteredResources,
        memoizedFollowups, currentVisitsPage, setCurrentVisitsPage, currentFollowUpPage, setCurrentFollowUpPage, currentResourcesPage,
        setCurrentResourcesPage, visitsPerPage, pagedDashboardVisits, handleVisitsPerPageChange, handleDashboardLocationChange, patchDashboardVisit,
        removeDashboardVisit, handleExportVisits, handleExportResources
    } = useDashboardData({ currentUser, locations, customers, currentUserId, customerRefreshTrigger, resourceRefreshTrigger });
    // A dashboard table with no rows yet while its data is still on the way says so.
    const renderDashboardLoadingRow = (colSpan) => (
        <tr>
            <td colSpan={colSpan} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                <Loader size={16} className="animate-spin" style={{ verticalAlign: 'middle', marginRight: 8, color: '#d4af37' }} />
                Loading…
            </td>
        </tr>
    );

    // Sync active CRM tab from URL query params on page refresh
    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const tabParam = searchParams.get('tab');
        if (tabParam) {
            setCrmTab(tabParam);
            if (tabParam === 'dashboard') {
                setShowDashboard(true);
            } else {
                setShowDashboard(false);
            }
        }
    }, []);


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

    const handleCrmTabChange = (tabName) => {
        // A nav entry that's a link elsewhere (Live Inventory) opens in a new
        // tab and leaves this page where it is.
        const href = navItem(tabName)?.href;
        if (href) {
            window.open(href, '_blank', 'noopener,noreferrer');
            if (isMobile) setIsSidebarOpen(false);
            return;
        }
        setCrmTab(tabName);
        setCustomerOriginTab(null);
        setSelectedCustomerId(null);
        setSelectedCustomerDetail(null);
        if (tabName === 'dashboard') {
            setShowDashboard(true);
        } else {
            setShowDashboard(false);
        }
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('tab', tabName);
        newUrl.searchParams.delete('customer');
        newUrl.searchParams.delete('view');
        newUrl.searchParams.delete('hold');
        window.history.pushState({ tab: tabName }, '', newUrl);

        if (isMobile) {
            setIsSidebarOpen(false);
        }
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
    const [showContactModal, setShowContactModal] = useState(false);
    const [showVisitModal, setShowVisitModal] = useState(false);
    const [showResourceModal, setShowResourceModal] = useState(false);
    const [showCalendarSyncModal, setShowCalendarSyncModal] = useState(false);
    // Google / iCloud sync and the .ics feed: src/features/calendarSync.
    const calendarSync = useCalendarSync({ open: showCalendarSyncModal, onSynced: fetchSchedules });
    const [editingContact, setEditingContact] = useState(null);
    const [editingVisit, setEditingVisit] = useState(null);
    const [editingResource, setEditingResource] = useState(null);


    // Partner Network States
    const [showLinkPartnerModal, setShowLinkPartnerModal] = useState(false);
    const [linkingPartnerId, setLinkingPartnerId] = useState('');
    const [isLinkingInProgress, setIsLinkingInProgress] = useState(false);

    const handleLinkPartner = async (e) => {
        if (e) e.preventDefault();
        if (!linkingPartnerId) return;

        setIsLinkingInProgress(true);
        try {
            const res = await authFetch(`${API_URL}/api/customers/${selectedCustomer._id}/associations`, {
                method: 'POST',
                body: JSON.stringify({ partnerId: linkingPartnerId })
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || data.error || `Failed to establish link (Status ${res.status})`);
            }

            // Re-fetch customer details to update state
            await fetchSingleCustomer(selectedCustomer._id);
            setShowLinkPartnerModal(false);
            setLinkingPartnerId('');
        } catch (err) {
            console.error('Error linking partner:', err);
            alert(err.message || 'Failed to link partner');
        } finally {
            setIsLinkingInProgress(false);
        }
    };

    const handleUnlinkPartner = async (partnerId, partnerName) => {
        if (!window.confirm(`Are you sure you want to remove the connection with "${partnerName}"?`)) {
            return;
        }

        try {
            const res = await authFetch(`${API_URL}/api/customers/${selectedCustomer._id}/associations/${partnerId}`, {
                method: 'DELETE'
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || data.error || `Failed to remove link (Status ${res.status})`);
            }

            // Re-fetch customer details to update state
            await fetchSingleCustomer(selectedCustomer._id);
        } catch (err) {
            console.error('Error unlinking partner:', err);
            alert(err.message || 'Failed to remove partner connection');
        }
    };

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

    const [isViewingResource, setIsViewingResource] = useState(false);
    const [isViewingVisit, setIsViewingVisit] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    // Visit photos go up the moment they are picked, and Save is sent behind the
    // closed form (handleSaveVisit), so the form never waits on either.
    // The visit whose customer's basic card is open (dashboard Sales Visits).
    const [visitCardFor, setVisitCardFor] = useState(null);
    // A short message at the bottom: "Visit saved", or why a save failed.
    const [saveToast, setSaveToast] = useState(null);
    const showSaveToast = (text, kind = 'ok') => setSaveToast({ id: Date.now(), text, kind });
    const dismissSaveToast = useCallback(() => setSaveToast(null), []);
    const [visitUploading, setVisitUploading] = useState(false);
    const visitUploadsRef = useRef(new Set());   // uploads still going
    const visitUploadedRef = useRef(new Map());  // picked photo data → stored link
    const visitSavesInFlight = useRef(0);        // saves sent and not yet answered
    const visitModalOpenRef = useRef(false);
    const [isChatFullScreen] = useState(false);
    const [quickNote, setQuickNote] = useState('');
    const [isSavingNote, setIsSavingNote] = useState(false);
    const [resetPasswordValue, setResetPasswordValue] = useState('');
    const [accountActionStatus, setAccountActionStatus] = useState(null);


    // Sidebar State. On desktop the side nav is always docked (it collapses to
    // its section rail instead of hiding — CustomerSidebar.jsx); below 1024px
    // it's a drawer opened by each tab's SidebarToggleButton.
    const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);
    // Under 640px the bottom tab bar replaces the drawer (PhoneTabBar.jsx).
    const isPhone = useIsPhone();

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 1024);
            if (window.innerWidth > 1024) {
                setIsSidebarOpen(true);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Form states
    const [contactForm, setContactForm] = useState({
        name: '',
        phone: '',
        email: '',
        role: '',
        notes: ''
    });

    const [visitForm, setVisitForm] = useState({
        date: '',
        purpose: 'Scheduled in Person Sales Meeting',
        notes: '',
        outcome: '',
        followUp: '',
        followUpDate: '',
        nextAction: '',
        image: [] // Array of strings
    });

    const [resourceForm, setResourceForm] = useState({
        title: '',
        date: formatForDateInput(new Date()),
        customerId: '', // Added to track actual customer ID
        customer: '',
        location: '',
        resourceType: '',
        image: [], // Array of strings
        description: '',
        notes: '',
        status: 'Active',
        url: '',
        uploadedBy: ''
    });


    const [expandedResourceId, setExpandedResourceId] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [fullScreenImage, setFullScreenImage] = useState(null);
    const [fullScreenGallery, setFullScreenGallery] = useState([]);
    const [fullScreenIndex, setFullScreenIndex] = useState(0);
    const [activeReactionMessageId, setActiveReactionMessageId] = useState(null);
    const [visitsLoading, setVisitsLoading] = useState(false);

    // Sales Dashboard State


    const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
    // Values a new customer opens with (Permits → a contractor's "Create customer"); null for a blank form.
    const [customerPrefill, setCustomerPrefill] = useState(null);
    const [loadingVisitId, setLoadingVisitId] = useState(null);
    const [loadingResourceId, setLoadingResourceId] = useState(null);

    // Custom Delete Confirmation Modal
    const [deleteConfirmation, setDeleteConfirmation] = useState({
        isOpen: false,
        isDeleting: false,
        type: '', // 'contact', 'visit', 'resource'
        id: null,
        customerId: null,
        message: ''
    });



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
    const {
        showAddFolderModal, setShowAddFolderModal, folderName, setFolderName, salesResources, showDashboardUploadModal,
        setShowDashboardUploadModal, dashboardUploadForm, setDashboardUploadForm, setEditingDashboardResource, previewDashboardResource, setPreviewDashboardResource,
        setCurrentFolderId, folderPath, setFolderPath, fetchDashboardResources, handleDashboardUpload, handleDashboardDownload,
        handleCreateFolder, handleEditDashboardResource, handleDeleteDashboardResource, handleBreadcrumbClick, handleResourceClick
    } = useTeamFiles({ showDashboard, activeResourceSubTab, resourceRefreshTrigger, setIsSaving, fetchDashboardData, fetchDashboardStats, setDeleteConfirmation });

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

    const handleGoHome = () => {
        setSelectedCustomerId(null);
        setSelectedCustomerDetail(null);
        handleCrmTabChange('dashboard');
        setActiveDashboardTab('visits');
        if (isMobile) {
            setIsSidebarOpen(false);
        }
    };


    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchTerm !== debouncedSearch) {
                setDebouncedSearch(searchTerm); // Fixed: was called twice (bug)
                setCurrentPage(1);
                setCurrentVisitsPage(1);
                setCurrentFollowUpPage(1);
                setCurrentResourcesPage(1);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm, debouncedSearch]);

    const fetchCustomers = useCallback(async (silent = false) => {
        const cacheKey = `customers_${currentPage}_${customersPerPage}_${debouncedSearch}`;
        const cached = getCachedData(cacheKey);

        if (cached && !silent) {
            setCustomers(cached.customers);
            setTotalPages(cached.totalPages);
            setTotalCustomers(cached.totalCustomers);
            setLoading(false);
            if (isCacheValid(cacheKey, 120000)) return;
        } else if (!cached && !silent) {
            setLoading(true);
        }

        try {
            const response = await authFetch(`${API_URL}/api/customers?page=${currentPage}&limit=${customersPerPage}&search=${encodeURIComponent(debouncedSearch)}`);

            if (response.ok) {
                const data = await response.json();
                const custList = data.customers || [];
                const pages = data.pages || 1;
                const total = data.total || 0;

                setCustomers(custList);
                setTotalPages(pages);
                setTotalCustomers(total);

                setCachedData(cacheKey, { customers: custList, totalPages: pages, totalCustomers: total });
            } else {
                if (response.status === 401) {
                    window.location.href = '/login';
                    return;
                }
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to fetch customers');
            }
        } catch (error) {
            console.error('Error fetching customers:', error);
            setError(error.message);
        } finally {
            setLoading(false);
        }
    }, [currentPage, customersPerPage, debouncedSearch]);

    useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers]);

    // In-memory customer cache for instant rendering
    const customerCacheRef = React.useRef({});

    // Optimized function to fetch only the selected customer with instant cache hydration
    const fetchSingleCustomer = async (customerId, skipCache = false) => {
        if (!customerId) return;

        // 1. Instant Cache Hydration: Serve cached data in 0ms if available
        setResetPasswordValue('');
        setAccountActionStatus(null);

        if (!skipCache && customerCacheRef.current[customerId]) {
            const cachedData = customerCacheRef.current[customerId];
            setSelectedCustomerDetail(cachedData);
            setQuickNote(cachedData.quickNote || '');
            setVisitsLoading(false);
        } else {
            setVisitsLoading(true);
        }

        try {
            const response = await authFetch(`${API_URL}/api/customers/${customerId}`);

            if (response.ok) {
                const data = await response.json();
                customerCacheRef.current[customerId] = data; // Update memory cache
                setSelectedCustomerDetail(data);
                setQuickNote(data.quickNote || '');
                return data;
            }
        } catch (error) {
            console.error('Error fetching customer details:', error);
        } finally {
            setVisitsLoading(false);
        }
    };

    // Use selectedCustomerDetail for the main view, fallback to list item (which might be partial)
    // The full profile (visits, resources, contacts, network, details) is Full
    // profile's; without it every way of opening one — the list, a link, the
    // dashboard, the route planner — lands on the customer list instead.
    const selectedCustomer = !canViewCustomerProfile(currentUser)
        ? null
        : (selectedCustomerDetail || customers.find(c => c._id === selectedCustomerId) || (selectedCustomerId ? { _id: selectedCustomerId } : null));

    // Link a partner: the same customer options, minus this account and the
    // ones already linked, with the type in the line under the name.
    const linkableCustomerOptions = React.useMemo(() => {
        const linkedIds = new Set((selectedCustomer?.associatedCustomers || []).map(p => String(p._id)));
        return customerOptions
            .filter(o => String(o.value) !== String(selectedCustomer?._id) && !linkedIds.has(String(o.value)))
            .map(o => ({ ...o, description: [o.customerType || 'Fabricator', o.city].filter(Boolean).join(' · ') }));
    }, [customerOptions, selectedCustomer]);

    // Filter resources (scoped to selected customer only)
    const customerResources = selectedCustomer ? (selectedCustomer.resources || []) : [];

    // Simplified resources (no search filtering)
    const customerFilteredResources = customerResources;

    const handleActiveTabChange = (tabName) => {
        setActiveTab(tabName);
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('view', tabName);
        window.history.replaceState({}, '', newUrl);
    };

    useEffect(() => {
        const handlePopState = () => {
            const params = new URLSearchParams(window.location.search);
            const tabParam = params.get('tab');
            const customerId = params.get('customer');
            const viewParam = params.get('view');
            
            const perms = currentUser?.permissions || [];
            const tabPermMap = {
                dashboard: 'view_dashboard',
                customers: 'view_customers',
                checkin: CHECKIN_PERMISSIONS.VIEW_LOG,
                pricelist: 'view_pricelist',
                users: 'manage_users',
                roles: 'manage_users',
                locations: 'manage_users'
            };

            const state = window.history.state;
            if (state && state.originTab) {
                setCustomerOriginTab(state.originTab);
            }

            if (tabParam && ['dashboard', 'customers', 'checkin', 'pricelist', 'users', 'roles', 'locations', 'profile'].includes(tabParam)) {
                // Only switch to the tab if the user has permission for it
                if (!tabPermMap[tabParam] || (tabParam === 'users' ? canOpenUsersPage(currentUser) : ['roles', 'locations'].includes(tabParam) ? canOpenArea(currentUser, tabParam) : perms.includes(tabPermMap[tabParam]))) {
                    setCrmTab(tabParam);
                    if (tabParam === 'dashboard') {
                        setShowDashboard(true);
                    } else {
                        setShowDashboard(false);
                    }
                } else {
                    // Force fallback if user doesn't have permission for the requested tab
                    setCrmTab(getDefaultTab());
                }
            } else if (!tabParam && currentUser) {
                // Land on their default tab if no tab parameter is supplied in the URL
                setCrmTab(getDefaultTab());
            }

            if (customerId) {
                if (perms.includes('view_customers')) {
                    setSelectedCustomerId(customerId);
                    setCrmTab('customers');
                } else {
                    setSelectedCustomerId(null);
                    setSelectedCustomerDetail(null);
                    setCustomerOriginTab(null);
                }
            } else {
                setSelectedCustomerId(null);
                setSelectedCustomerDetail(null);
                setCustomerOriginTab(null);
            }
            if (viewParam && ['visits', 'resources', 'contacts', 'network', 'details'].includes(viewParam)) {
                setActiveTab(viewParam);
            }
        };

        // Run once on mount / when currentUser loads
        handlePopState();

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [currentUser]);

    useEffect(() => {
        if (selectedCustomerId) {
            fetchSingleCustomer(selectedCustomerId);
        }
    }, [selectedCustomerId]);

    useEffect(() => {
        if (crmTab === 'route_planner') setRoutePlannerOpened(true);
    }, [crmTab]);

    const handleSelectCustomer = (customer, explicitOrigin) => {
        if (customer) {
            // Track origin tab from which customer was opened
            const currentTab = crmTab;
            const origin = customerOriginTab || explicitOrigin || (currentTab !== 'customers' ? currentTab : 'customers');
            setCustomerOriginTab(origin);

            const isShell = !customer.company && !customer.contactName && !customer.email && !customer.name;
            const cached = customerCacheRef.current[customer._id];
            if (isShell) {
                if (selectedCustomerId !== customer._id) {
                    setSelectedCustomerDetail(null); // Clear previous details to show loading/fallback
                }
                setVisitsLoading(true);
            } else {
                // Populate selected customer details immediately to transition instantly
                setSelectedCustomerDetail(cached || customer);
                if (!cached || !cached.visits) {
                    setVisitsLoading(true);
                }
            }
            setSelectedCustomerId(customer._id);
            
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('tab', 'customers');
            newUrl.searchParams.set('customer', customer._id);
            newUrl.searchParams.set('view', 'visits'); // Default to visits view on select
            window.history.pushState({ originTab: origin, fromDashboard: origin === 'dashboard' }, '', newUrl);
            
            setCrmTab('customers');

            // On mobile, close sidebar (list view) to show details
            if (isMobile) {
                setIsSidebarOpen(false);
            }
            // fetchSingleCustomer is triggered by useEffect
            setActiveTab('visits');
            window.scrollTo(0, 0);
        }
    };

    const handleBackToCustomersList = () => {
        const state = window.history.state;
        const targetTab = customerOriginTab || (state && state.originTab) || (state && state.fromDashboard ? 'dashboard' : 'customers');

        setSelectedCustomerId(null);
        setSelectedCustomerDetail(null);
        setCustomerOriginTab(null);

        const newUrl = new URL(window.location);
        newUrl.searchParams.delete('customer');
        newUrl.searchParams.delete('view');
        newUrl.searchParams.set('tab', targetTab);

        // Replace history entry to prevent back button loops between opened customer cards
        window.history.replaceState({ tab: targetTab }, '', newUrl);

        setCrmTab(targetTab);
        if (targetTab === 'dashboard') {
            setShowDashboard(true);
        } else {
            setShowDashboard(false);
        }

        if (isMobile) {
            setIsSidebarOpen(false);
        }
    };

    const getPriceLevelLabel = (level) => {
        const labels = {
            1: 'Level 1 (10% Margin)',
            2: 'Level 2 (20% Margin)',
            3: 'Level 3 (30% Margin)',
            4: 'Level 4 (40% Margin)'
        };
        return labels[level] || 'Level 1 (10% Margin)';
    };

    const getCustomerLevelLabel = (customer) => {
        if (!customer) return 'Level 1 (10% Margin)';
        if (customer.level) {
            const match = customer.level.match(/\d+/);
            if (match) {
                const val = parseInt(match[0], 10);
                const labels = {
                    1: 'Level 1 (10% Margin)',
                    2: 'Level 2 (20% Margin)',
                    3: 'Level 3 (30% Margin)',
                    4: 'Level 4 (40% Margin)'
                };
                return labels[val] || customer.level;
            }
            return customer.level;
        }
        return getPriceLevelLabel(customer.priceLevel);
    };

    // Contact CRUD operations
    const handleAddContact = () => {
        setEditingContact(null);
        setContactForm({
            name: '',
            phone: '',
            email: '',
            role: '',
            notes: ''
        });
        setShowContactModal(true);
    };

    const handleEditContact = (contact) => {
        setEditingContact(contact);
        setContactForm({
            name: contact.name || '',
            phone: contact.phone || '',
            email: contact.email || '',
            role: contact.role || '',
            notes: contact.notes || ''
        });
        setShowContactModal(true);
    };

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

    // Show a saved visit on the open customer straight away, rather than only
    // once the background refresh lands. Kept in the detail cache too, so the
    // cached copy shown while that refresh runs isn't the pre-save one.
    const patchOpenCustomerVisits = (customerId, visit) => {
        if (!visit?._id || customerId !== selectedCustomerId) return;
        setSelectedCustomerDetail(prev => {
            if (!prev || prev._id !== customerId) return prev;
            const visits = prev.visits || [];
            const exists = visits.some(v => v._id === visit._id);
            const next = {
                ...prev,
                visits: exists ? visits.map(v => (v._id === visit._id ? { ...v, ...visit } : v)) : [...visits, visit]
            };
            customerCacheRef.current[customerId] = next;
            return next;
        });
    };

    // The other way: take a visit that was shown ahead of its save back off.
    const removeOpenCustomerVisit = (customerId, visitId) => {
        if (!visitId || customerId !== selectedCustomerId) return;
        setSelectedCustomerDetail(prev => {
            if (!prev || prev._id !== customerId) return prev;
            const next = { ...prev, visits: (prev.visits || []).filter(v => v._id !== visitId) };
            customerCacheRef.current[customerId] = next;
            return next;
        });
    };


    const handleSaveContact = async () => {
        try {
            setIsSaving(true);
            const url = editingContact
                ? `${API_URL}/api/customers/${selectedCustomerId}/contacts/${editingContact._id}`
                : `${API_URL}/api/customers/${selectedCustomerId}/contacts`;

            const method = editingContact ? 'PUT' : 'POST';

            const response = await authFetch(url, {
                method,
                body: JSON.stringify(contactForm)
            });

            if (response.ok) {
                setShowContactModal(false);
                refreshAfterSave(selectedCustomerId, { dashboard: false });
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to save contact');
            }
        } catch (error) {
            console.error('Error saving contact:', error);
            alert('Failed to save contact');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteContact = async (contactId) => {
        setDeleteConfirmation({
            isOpen: true,
            type: 'contact',
            id: contactId,
            message: 'Are you sure you want to delete this contact?'
        });
    };

    const confirmDelete = async () => {
        const { type, id, customerId } = deleteConfirmation;
        // Use the customerId from state, or fallback to selectedCustomerId for legacy calls
        const targetCustomerId = customerId || selectedCustomerId;

        setDeleteConfirmation(prev => ({ ...prev, isDeleting: true }));

        if (!targetCustomerId && type !== 'dashboardResource') {
            console.error('No customer ID provided for deletion');
            alert(`Failed to delete ${type}: Missing customer information`);
            return;
        }

        try {
            let response;

            if (type === 'contact') {
                response = await authFetch(`${API_URL}/api/customers/${targetCustomerId}/contacts/${id}`, {
                    method: 'DELETE'
                });
            } else if (type === 'visit') {
                response = await authFetch(`${API_URL}/api/customers/${targetCustomerId}/visits/${id}`, {
                    method: 'DELETE'
                });
            } else if (type === 'resource') {
                response = await authFetch(`${API_URL}/api/customers/${targetCustomerId}/resources/${id}`, {
                    method: 'DELETE'
                });
            } else if (type === 'dashboardResource') {
                response = await authFetch(`${API_URL}/api/sales-dashboard/resources/${id}`, {
                    method: 'DELETE'
                });
            }

            if (response && response.ok) {
                // If we're on the Dashboard view (dashboard tabs), refresh dashboard data
                const isDashboardView = activeDashboardTab === 'visits' || activeDashboardTab === 'resources' || activeDashboardTab === 'followups' || activeDashboardTab === 'leads';

                // Close first, refresh behind it — same reasoning as refreshAfterSave.
                setDeleteConfirmation({ isOpen: false, isDeleting: false, type: '', id: null, customerId: null, message: '' });
                if (type === 'dashboardResource') {
                    fetchDashboardResources();
                } else if (!selectedCustomerId && isDashboardView) {
                    Promise.allSettled([fetchDashboardData(), fetchDashboardStats()]);
                } else {
                    // Otherwise, refresh the selected customer's data
                    fetchSingleCustomer(targetCustomerId);
                }
            } else {
                setDeleteConfirmation(prev => ({ ...prev, isDeleting: false }));
                const reason = response ? (await response.json().catch(() => ({}))).message : '';
                alert(reason || `Failed to delete ${type}`);
            }
        } catch (error) {
            console.error(`Error deleting ${type}:`, error);
            setDeleteConfirmation(prev => ({ ...prev, isDeleting: false }));
            alert(`Failed to delete ${type}`);
        }
    };

    const cancelDelete = () => {
        setDeleteConfirmation({ isOpen: false, type: '', id: null, customerId: null, message: '' });
    };

    const handleSaveQuickNote = async () => {
        if (!selectedCustomerId) return;

        setIsSavingNote(true);
        try {
            const response = await authFetch(`${API_URL}/api/customers/${selectedCustomerId}/quick-note`, {
                method: 'PATCH',
                body: JSON.stringify({ quickNote })
            });

            if (response.ok) {
                const data = await response.json();
                // Update local state so UI reflects the saved note immediately
                if (selectedCustomerDetail) {
                    setSelectedCustomerDetail({ ...selectedCustomerDetail, quickNote: data.quickNote });
                }

            } else {
                console.error('Failed to save quick note');
            }
        } catch (error) {
            console.error('Error saving quick note:', error);
        } finally {
            setIsSavingNote(false);
        }
    };

    const handleToggleCustomerStatus = async (id, currentStatus) => {
        const newStatus = !currentStatus;
        const action = newStatus ? 'activate' : 'deactivate';
        if (!window.confirm(`Are you sure you want to ${action} this customer?`)) return;

        try {
            const response = await authFetch(`${API_URL}/api/customers/${id}/active`, {
                method: 'PATCH',
                body: JSON.stringify({ isActive: newStatus })
            });

            if (response.ok) {
                if (selectedCustomerDetail?._id === id) {
                    setSelectedCustomerDetail({ ...selectedCustomerDetail, isActive: newStatus });
                }
                setAccountActionStatus({ type: 'success', message: `Customer ${action}d successfully` });
            } else {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.message || `Failed to ${action} customer`);
            }
        } catch (error) {
            console.error(`Error ${action}ing customer:`, error);
            setAccountActionStatus({ type: 'error', message: `Failed to ${action} customer: ${error.message}` });
        }
    };

    /**
     * Admin-only capability, gated behind manage_customer_accounts. Goes through
     * its own route, /api/customers/:id/password, which updates via
     * customer.save() so the schema's pre('save') bcrypt hook runs. The
     * ordinary edit route (PUT /api/customers/:id) refuses a password
     * outright: it uses findByIdAndUpdate, which skips that hook.
     */
    const handleResetCustomerPassword = async (id) => {
        if (!resetPasswordValue.trim()) return;
        if (!window.confirm("Reset this customer's password?")) return;
        try {
            const response = await authFetch(`${API_URL}/api/customers/${id}/password`, {
                method: 'PUT',
                body: JSON.stringify({ password: resetPasswordValue })
            });
            if (response.ok) {
                setResetPasswordValue('');
                setAccountActionStatus({ type: 'success', message: 'Password reset successfully' });
            } else {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.message || 'Failed to reset password');
            }
        } catch (error) {
            console.error('Error resetting password:', error);
            setAccountActionStatus({ type: 'error', message: error.message });
        }
    };


    



    const handleEditVisit = async (visit) => {
        if (!visit?.customerId || !visit?._id) {
            setEditingVisit(visit);
            setIsViewingVisit(false);
            setVisitForm({
                date: visit.date ? formatForDateInput(visit.date) : '',
                purpose: visit.purpose || '',
                notes: visit.notes || '',
                outcome: visit.outcome || '',
                followUp: visit.followUp || visit.nextAction || '',
                followUpDate: visit.followUpDate ? formatForDateInput(visit.followUpDate) : '',
                managerComment: visit.managerComment || '',
                headquartersComment: visit.headquartersComment || '',
                image: Array.isArray(visit.image) ? visit.image : (visit.image ? [visit.image] : []),
                customerId: visit.customerId || selectedCustomerId || ''
            });
            setShowVisitModal(true);
            return;
        }

        setLoadingVisitId(visit._id);
        try {
            const response = await authFetch(`${API_URL}/api/customers/${visit.customerId}/visits/${visit._id}`);
            const data = await response.json();

            if (data && data.visit) {
                const formattedVisit = {
                    ...data.visit,
                    customerId: visit.customerId, // Preserve customerId
                    date: formatForDateInput(data.visit.date),
                    followUpDate: data.visit.followUpDate ? formatForDateInput(data.visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                // The dashboard's row knows the customer's branch; the form's
                // Delete needs it for branch-level delete permission.
                setEditingVisit({ ...formattedVisit, location: visit.location });
            } else {
                const formattedVisit = {
                    ...visit,
                    date: formatForDateInput(visit.date),
                    followUpDate: visit.followUpDate ? formatForDateInput(visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                setEditingVisit(formattedVisit);
            }
            setIsViewingVisit(false);
            setShowVisitModal(true);
        } catch (error) {
            console.error('Error fetching visit details for edit:', error);
            setVisitForm(visit);
            setEditingVisit(visit);
            setIsViewingVisit(false);
            setShowVisitModal(true);
        } finally {
            setLoadingVisitId(null);
        }
    };

    const handleViewVisit = async (visit) => {
        if (!visit?.customerId || !visit?._id) {
            setVisitForm(visit || {});
            setEditingVisit(visit);
            setShowVisitModal(true);
            setIsViewingVisit(true);
            return;
        }

        setLoadingVisitId(visit._id);
        try {
            const response = await authFetch(`${API_URL}/api/customers/${visit.customerId}/visits/${visit._id}`);
            const data = await response.json();


            if (data && data.visit) {
                const formattedVisit = {
                    ...data.visit,
                    customerId: visit.customerId, // Preserve customerId
                    date: formatForDateInput(data.visit.date),
                    followUpDate: data.visit.followUpDate ? formatForDateInput(data.visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                setEditingVisit(formattedVisit);
            } else {
                const formattedVisit = {
                    ...visit,
                    date: formatForDateInput(visit.date),
                    followUpDate: visit.followUpDate ? formatForDateInput(visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                setEditingVisit(formattedVisit);
            }
            setShowVisitModal(true);
            setIsViewingVisit(true);
        } catch (error) {
            console.error('Error fetching visit details:', error);
            setVisitForm(visit);
            setEditingVisit(visit);
            setShowVisitModal(true);
            setIsViewingVisit(true);
        } finally {
            setLoadingVisitId(null);
        }
    };

    useEffect(() => { visitModalOpenRef.current = showVisitModal; }, [showVisitModal]);

    // A visit that is still being sent is lost if the tab closes now.
    useEffect(() => {
        const onBeforeUnload = (e) => {
            if (visitSavesInFlight.current > 0) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, []);

    const handleCloseVisitModal = () => {
        setVisitForm({
            date: '',
            purpose: 'Scheduled in Person Sales Meeting',
            notes: '',
            outcome: '',
            followUp: '',
            followUpDate: '',
            image: []
        });
        setEditingVisit(null);
        setIsViewingVisit(false);
        setShowVisitModal(false);
    };

    // VisitForm passes what to save (hidden follow-up fields already cleared —
    // visitValuesToSave); anything else, such as a click event, means the form state.
    //
    // The form closes and the visit shows on the customer at once; the request
    // goes behind it. A new visit carries its own id, so the retry below (or a
    // lost answer) can't add it twice — the server answers a repeat with the
    // visit it already has. If the save fails, the visit is taken back off the
    // screen and the form reopens with everything that was typed.
    const handleSaveVisit = async (values) => {
        const form = values && typeof values === 'object' && !values.nativeEvent ? values : visitForm;
        const targetCustomerId = form.customerId || selectedCustomerId;
        if (!targetCustomerId || !form.date || !form.purpose) {
            alert('Please fill in all mandatory fields (Customer, Date, Visit Type)');
            return;
        }

        const editing = editingVisit;
        const visitId = editing ? editing._id : newVisitId();
        const url = editing
            ? `${API_URL}/api/customers/${targetCustomerId}/visits/${editing._id}`
            : `${API_URL}/api/customers/${targetCustomerId}/visits`;
        const payload = {
            ...form,
            date: form.date, // Send as-is, backend will handle with ensureDateString
            followUpDate: form.followUpDate || ''
        };
        if (!editing) payload._id = visitId;

        patchOpenCustomerVisits(
            targetCustomerId,
            editing
                ? { ...editing, ...payload, _id: visitId }
                : { ...payload, createdBy: currentUser?._id || currentUser?.id, createdByName: currentUser?.displayName || currentUser?.username }
        );
        // The dashboard's list needs the customer's name and branch (the form
        // only has an id), from whatever is already loaded.
        const known = (selectedCustomer && String(selectedCustomer._id) === String(targetCustomerId) && selectedCustomer)
            || customers.find(c => String(c._id) === String(targetCustomerId)) || {};
        const optionLabel = (customerOptions || []).find(o => o.value === targetCustomerId)?.label || '';
        patchDashboardVisit(
            editing
                ? { ...payload, _id: visitId, _saving: true }
                : {
                    ...payload,
                    customerId: targetCustomerId,
                    company: known.company || known.contactName || optionLabel,
                    contactName: known.company ? (known.contactName || '') : '',
                    location: known.location || '',
                    createdByName: currentUser?.displayName || currentUser?.username,
                    _saving: true
                },
            !editing
        );
        setCurrentFollowUpPage(1);
        handleCloseVisitModal();

        visitSavesInFlight.current += 1;
        try {
            // Photos still going up finish first; one that failed to upload is
            // sent here as it was picked, and the server stores it.
            await Promise.allSettled([...visitUploadsRef.current]);
            const stored = visitUploadedRef.current;
            const linkOf = (img) => (typeof img === 'string' && stored.get(img)) || img;
            const body = {
                ...payload,
                image: Array.isArray(payload.image) ? payload.image.map(linkOf) : payload.image ? linkOf(payload.image) : payload.image
            };

            // Smart Retry Logic for cold-starts/stale connections
            let response;
            let lastError;
            const maxRetries = 1;

            for (let i = 0; i <= maxRetries; i++) {
                try {
                    response = await authFetch(url, {
                        method: editing ? 'PUT' : 'POST',
                        body: JSON.stringify(body)
                    });

                    if (response.ok) break;

                    const errorJson = await response.json().catch(() => ({}));
                    lastError = new Error(errorJson.message || 'Failed to save visit');
                    lastError.fromServer = true;
                    // Refused or invalid (403, 400…): retrying can't change the answer.
                    if (response.status >= 400 && response.status < 500) break;
                } catch (err) {
                    lastError = err;
                }

                if (i < maxRetries) {
                    console.warn(`[Retry] Visit save attempt ${i + 1} failed. Retrying once...`);
                    await new Promise(resolve => setTimeout(resolve, 1500)); // wait 1.5s
                }
            }

            if (!response || !response.ok) {
                throw lastError || new Error('Failed to save visit');
            }

            // Both answer with the stored visit (image links and all).
            const saved = await response.json().catch(() => null);
            if (saved?.visit) patchOpenCustomerVisits(targetCustomerId, saved.visit);
            patchDashboardVisit({ ...(saved?.visit || {}), _id: visitId, _saving: false }, false);
            showSaveToast('Visit saved');
            (Array.isArray(payload.image) ? payload.image : [payload.image]).forEach(img => stored.delete(img));

            // Logging a visit can add a drop-in to the calendar, hence schedules.
            refreshAfterSave(targetCustomerId, { schedules: true });
        } catch (error) {
            console.error('[Visit Save Exception] Details:', {
                message: error.message,
                url,
                payload: form
            });
            // Take the visit back off the screen and give the form back.
            if (editing) {
                patchOpenCustomerVisits(targetCustomerId, editing);
                patchDashboardVisit({ ...editing, _saving: false }, false);
            } else {
                removeOpenCustomerVisit(targetCustomerId, visitId);
                removeDashboardVisit(visitId);
            }
            if (!visitModalOpenRef.current) {
                setVisitForm(form);
                setEditingVisit(editing);
                setIsViewingVisit(false);
                setShowVisitModal(true);
            }
            const why = error.fromServer ? error.message : 'Check your connection and try again.';
            showSaveToast(`Couldn’t save the visit — ${why}${visitModalOpenRef.current ? '' : ' Your entries are back in the form.'}`, 'error');
        } finally {
            visitSavesInFlight.current -= 1;
        }
    };

    const handleQuickAddVisit = () => {
        setEditingVisit(null);
        setIsViewingVisit(false);

        const localDate = formatForDateInput(new Date());

        setVisitForm({
            date: localDate,
            purpose: 'Scheduled in Person Sales Meeting',
            notes: '',
            outcome: '',
            followUp: '',
            followUpDate: '',
            managerComment: '',
            headquartersComment: '',
            image: [],
            customerId: selectedCustomerId || '' // Default to selected customer if available
        });
        setShowVisitModal(true);
    };
    const handleQuickAddResource = () => {
        setEditingResource(null);
        setIsViewingResource(false);

        const localDate = formatForDateInput(new Date());

        setResourceForm({
            title: '',
            date: localDate,
            customerId: '',
            customer: '',
            location: '',
            resourceType: '',
            image: [],
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
        setShowResourceModal(true);
    };

    // Route planner's info panel triggers these for whichever pin is open.
    // Takes the pin itself (company/contactName included) rather than just
    // an id — `customers` here is the Customers tab's current page, not the
    // full directory, so looking a route-planner pin up in it would miss
    // most customers and silently blank the resource's Client label.
    const handleAddVisitForPin = (pin) => {
        setEditingVisit(null);
        setIsViewingVisit(false);

        const localDate = formatForDateInput(new Date());

        setVisitForm({
            date: localDate,
            purpose: 'Scheduled in Person Sales Meeting',
            notes: '',
            outcome: '',
            followUp: '',
            followUpDate: '',
            managerComment: '',
            headquartersComment: '',
            image: [],
            customerId: pin?._id || ''
        });
        setShowVisitModal(true);
    };
    const handleAddResourceForPin = (pin) => {
        setEditingResource(null);
        setIsViewingResource(false);
        setImagePreview(null);

        setResourceForm({
            title: '',
            date: formatForDateInput(new Date()),
            customerId: pin?._id || '',
            customer: pin ? (pin.company || pin.contactName || '') : '',
            location: '',
            resourceType: '',
            image: [],
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
        setShowResourceModal(true);
    };


    const handleDeleteVisit = async (visitId, customerId = null) => {
        setDeleteConfirmation({
            isOpen: true,
            type: 'visit',
            id: visitId,
            customerId: customerId || selectedCustomerId,
            message: 'Are you sure you want to delete this visit?'
        });
    };

    // Resource CRUD operations
    const handleCloseResourceModal = () => {
        setShowResourceModal(false);
        setEditingResource(null);
        setIsViewingResource(false);
        setResourceForm({
            title: '',
            date: formatForDateInput(new Date()),
            customerId: selectedCustomer ? selectedCustomer._id : '',
            customer: selectedCustomer ? (selectedCustomer.company || selectedCustomer.contactName) : '',
            location: '',
            resourceType: '',
            image: [],
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
    };

    const handleAddResource = () => {
        setEditingResource(null);
        setIsViewingResource(false);
        setImagePreview(null);
        setResourceForm({
            title: '',
            date: formatForDateInput(new Date()),
            customerId: selectedCustomer ? selectedCustomer._id : '',
            customer: selectedCustomer ? (selectedCustomer.company || selectedCustomer.contactName) : '',
            location: '',
            resourceType: '',
            image: [],
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
        setShowResourceModal(true);
    };


    const handleEditResource = async (resource) => {
        if (!resource?.customerId || !resource?._id) {
            setEditingResource(resource);
            setIsViewingResource(false);
            setImagePreview(Array.isArray(resource.image) && resource.image.length > 0 ? resource.image[0] : (resource.image || null));
            setResourceForm({
                title: resource.title || '',
                date: resource.date ? formatForDateInput(resource.date) : formatForDateInput(new Date()),
                customerId: resource.customerId || selectedCustomerId, // Fallback to current if missing
                customer: resource.customer || '',
                location: resource.location || '',
                resourceType: resource.resourceType || '',
                image: Array.isArray(resource.image) ? resource.image : (resource.image ? [resource.image] : []),
                description: resource.description || '',
                notes: resource.notes || '',
                status: resource.status || 'Active',
                url: resource.url || '',
                uploadedBy: resource.uploadedBy || ''
            });
            setShowResourceModal(true);
            return;
        }

        setLoadingResourceId(resource._id);
        try {
            const response = await authFetch(`${API_URL}/api/customers/${resource.customerId}/resources/${resource._id}`);
            const data = await response.json();

            if (data && data.resource) {
                const formattedResource = {
                    ...data.resource,
                    customerId: resource.customerId, // Preserve customerId
                    date: formatForDateInput(data.resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);
                setImagePreview(Array.isArray(data.resource.image) && data.resource.image.length > 0 ? data.resource.image[0] : (data.resource.image || null));
            } else {
                const formattedResource = {
                    ...resource,
                    date: formatForDateInput(resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);
                setImagePreview(Array.isArray(resource.image) && resource.image.length > 0 ? resource.image[0] : (resource.image || null));
            }
            setIsViewingResource(false);
            setShowResourceModal(true);
        } catch (error) {
            console.error('Error fetching resource details for edit:', error);
            setResourceForm(resource);
            setEditingResource(resource);
            setIsViewingResource(false);
            setShowResourceModal(true);
        } finally {
            setLoadingResourceId(null);
        }
    };

    const handleViewResource = async (resource) => {
        if (!resource?.customerId || !resource?._id) {
            setResourceForm(resource || {});
            setEditingResource(resource);
            setImagePreview(Array.isArray(resource.image) && resource.image.length > 0 ? resource.image[0] : (resource.image || null));
            setShowResourceModal(true);
            setIsViewingResource(true);
            return;
        }

        setLoadingResourceId(resource._id);
        try {
            const response = await authFetch(`${API_URL}/api/customers/${resource.customerId}/resources/${resource._id}`);
            const data = await response.json();

            if (data && data.resource) {
                const formattedResource = {
                    ...data.resource,
                    customerId: resource.customerId, // Preserve customerId
                    date: formatForDateInput(data.resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);
                const getFirstImage = (imgData) => {
                    if (!imgData) return null;
                    if (Array.isArray(imgData)) return imgData[0];
                    if (typeof imgData === 'string') {
                        if (imgData.startsWith('[') && imgData.endsWith(']')) {
                            try { return JSON.parse(imgData)[0]; } catch { /* not fatal — carry on */ }
                        }
                        return imgData.split(',')[0].trim();
                    }
                    return null;
                };

                const firstImg = getFirstImage(data.resource.image);
                setImagePreview(firstImg);
            } else {
                const formattedResource = {
                    ...resource,
                    date: formatForDateInput(resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);

                const getFirstImage = (imgData) => {
                    if (!imgData) return null;
                    if (Array.isArray(imgData)) return imgData[0];
                    if (typeof imgData === 'string') {
                        if (imgData.startsWith('[') && imgData.endsWith(']')) {
                            try { return JSON.parse(imgData)[0]; } catch { /* not fatal — carry on */ }
                        }
                        return imgData.split(',')[0].trim();
                    }
                    return null;
                };
                setImagePreview(getFirstImage(resource.image));
            }
            setShowResourceModal(true);
            setIsViewingResource(true);
        } catch (error) {
            console.error('Error fetching resource details:', error);
            setResourceForm(resource);
            setEditingResource(resource);
            setShowResourceModal(true);
            setIsViewingResource(true);
        } finally {
            setLoadingResourceId(null);
        }
    };

    const handleSaveResource = async () => {
        try {
            setIsSaving(true);
            // Use the selected customer ID from the form, or fallback to the currently selected customer
            const targetCustomerId = resourceForm.customerId || selectedCustomerId;

            if (!targetCustomerId) {
                alert('Please select a client');
                setIsSaving(false);
                return;
            }

            const url = editingResource
                ? `${API_URL}/api/customers/${targetCustomerId}/resources/${editingResource._id}`
                : `${API_URL}/api/customers/${targetCustomerId}/resources`;

            const method = editingResource ? 'PUT' : 'POST';


            const response = await authFetch(url, {
                method,
                body: JSON.stringify(resourceForm)
            });

            if (response.ok) {
                handleCloseResourceModal();
                // A placement writes its own visit, which can add a drop-in
                // to the calendar — hence schedules.
                refreshAfterSave(targetCustomerId, { schedules: true });
            } else {
                const data = await response.json();
                console.error('Save resource failed:', data);
                alert(`Failed to save resource: ${data.message || 'Unknown server error'}`);
            }
        } catch (error) {
            console.error('Error saving resource:', error);
            alert(`Failed to save resource: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteResource = async (resourceId, customerId = null) => {
        setDeleteConfirmation({
            isOpen: true,
            type: 'resource',
            id: resourceId,
            customerId: customerId || selectedCustomerId,
            message: 'Are you sure you want to delete this resource?'
        });
    };

    // Reaction handler
    const handleReaction = async (visitId, type) => {

        if (!selectedCustomerId || !visitId) {
            console.error('Missing required IDs for reaction:', { selectedCustomerId, visitId });
            return;
        }

        try {
            const response = await authFetch(`${API_URL}/api/customers/${selectedCustomerId}/visits/${visitId}/react`, {
                method: 'POST',
                body: JSON.stringify({ type })
            });

            if (response.ok) {
                // Refresh data to show new reaction
                // Using fetchSingleCustomer for now, could be optimized to local state update
                await response.json();

                // Optimistic update or just simpler refetch
                await fetchSingleCustomer(selectedCustomerId);
            } else {
                console.error('Failed to update reaction');
            }
        } catch (error) {
            console.error('Error updating reaction:', error);
        }
    };

    // Image compression utility
    const compressImage = async (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const MAX_WIDTH = 1200;
                    const MAX_HEIGHT = 1200;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Compress to JPEG with 0.7 quality
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    resolve(dataUrl);
                };
                img.onerror = (error) => reject(error);
            };
            reader.onerror = (error) => reject(error);
        });
    };

    // Generic file to Base64 utility for PDFs
    const fileToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = (error) => reject(error);
        });
    };

    const handleVisitImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const newFiles = [];
        for (const file of files) {
            if (file.size > 25 * 1024 * 1024) {
                alert(`File ${file.name} is too large. Limit is 25MB.`);
                continue;
            }
            try {
                let processedFile;
                if (file.type.startsWith('image/')) {
                    processedFile = await compressImage(file);
                } else if (file.type === 'application/pdf') {
                    processedFile = await fileToBase64(file);
                } else {
                    alert(`Unsupported file type: ${file.name}`);
                    continue;
                }
                newFiles.push(processedFile);
            } catch (error) {
                console.error(`Error processing ${file.name}:`, error);
                alert(`Failed to process file ${file.name}`);
            }
        }

        setVisitForm(prev => ({
            ...prev,
            image: prev.image ? (Array.isArray(prev.image) ? [...prev.image, ...newFiles] : [prev.image, ...newFiles]) : newFiles
        }));
        newFiles.forEach(uploadVisitAttachment);
    };

    // Sends one picked photo/PDF to the server right away; the form keeps the
    // tile (with a spinner) and swaps in the stored link when it lands. If it
    // fails nothing is lost — Save sends the photo itself, as it always did.
    const uploadVisitAttachment = (dataUrl) => {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return;
        const job = (async () => {
            try {
                const res = await authFetch(`${API_URL}/api/customers/visit-attachments`, {
                    method: 'POST',
                    body: JSON.stringify({ data: dataUrl })
                });
                if (!res.ok) return;
                const { url } = await res.json();
                if (!url) return;
                visitUploadedRef.current.set(dataUrl, url);
                setVisitForm(prev => {
                    const list = Array.isArray(prev.image) ? prev.image : prev.image ? [prev.image] : [];
                    return list.includes(dataUrl) ? { ...prev, image: list.map(i => (i === dataUrl ? url : i)) } : prev;
                });
            } catch (err) {
                console.warn('[Visit photo] early upload failed; it will be sent with Save.', err);
            }
        })().finally(() => {
            visitUploadsRef.current.delete(job);
            setVisitUploading(visitUploadsRef.current.size > 0);
        });
        visitUploadsRef.current.add(job);
        setVisitUploading(true);
    };

    const handleRemoveVisitImage = (index) => {
        setVisitForm(prev => ({
            ...prev,
            image: prev.image.filter((_, i) => i !== index)
        }));
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!fullScreenImage) return;
            if (e.key === 'ArrowRight') handleNextImage();
            if (e.key === 'ArrowLeft') handlePrevImage();
            if (e.key === 'Escape') setFullScreenImage(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [fullScreenImage, fullScreenIndex, fullScreenGallery]);

    const handleOpenGallery = (images, index) => {
        const imageList = Array.isArray(images) ? images : [images];
        setFullScreenGallery(imageList);
        setFullScreenIndex(index);
        setFullScreenImage(imageList[index]);
    };

    const handleNextImage = () => {
        if (fullScreenGallery.length <= 1) return;
        const nextIndex = (fullScreenIndex + 1) % fullScreenGallery.length;
        setFullScreenIndex(nextIndex);
        setFullScreenImage(fullScreenGallery[nextIndex]);
    };

    const handlePrevImage = () => {
        if (fullScreenGallery.length <= 1) return;
        const prevIndex = (fullScreenIndex - 1 + fullScreenGallery.length) % fullScreenGallery.length;
        setFullScreenIndex(prevIndex);
        setFullScreenImage(fullScreenGallery[prevIndex]);
    };

    // Resource Image/File upload handler
    const handleResourceImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const newFiles = [];
        for (const file of files) {
            if (file.size > 25 * 1024 * 1024) {
                alert(`File ${file.name} is too large. Limit is 25MB.`);
                continue;
            }
            try {
                let processedFile;
                if (file.type.startsWith('image/')) {
                    processedFile = await compressImage(file);
                } else if (file.type === 'application/pdf') {
                    processedFile = await fileToBase64(file);
                } else {
                    alert(`Unsupported file type: ${file.name}`);
                    continue;
                }
                newFiles.push(processedFile);
            } catch (error) {
                console.error(`Error processing ${file.name}:`, error);
                alert(`Failed to process file ${file.name}`);
            }
        }

        if (newFiles.length === 0) return;

        setResourceForm(prev => ({
            ...prev,
            image: prev.image ? (Array.isArray(prev.image) ? [...prev.image, ...newFiles] : [prev.image, ...newFiles]) : newFiles
        }));

        // Set preview for the first file if not already set
        if (!imagePreview && newFiles.length > 0) {
            setImagePreview(newFiles[0]);
        }
    };

    const handleRemoveResourceImage = (index) => {
        const updatedImages = resourceForm.image.filter((_, i) => i !== index);
        setResourceForm({ ...resourceForm, image: updatedImages });
        setImagePreview(updatedImages.length > 0 ? updatedImages[0] : null);
    };

    






    const renderCheckInLogView = () => (
        <CheckInLogTab
            log={checkInLog}
            locations={locations}
            sidebarToggle={(!isSidebarOpen || isMobile) ? <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(true)} /> : null}
            fallback={<TabLoader />}
        />
    );

    const renderNetworkTab = () => {
        if (!selectedCustomer) return null;

        const partners = selectedCustomer.associatedCustomers || [];
        
        // Group partners
        const fabricators = partners.filter(p => p.customerType === 'Fabricator');
        const otherPartners = partners.filter(p => p.customerType !== 'Fabricator');

        const renderPartnerGrid = (list, title) => {
            if (list.length === 0) return null;
            return (
                <div className="network-category-section">
                    <h4 className="network-category-title">{title} ({list.length})</h4>
                    <div className="network-grid">
                        {list.map(partner => (
                            <div className="partner-card" key={partner._id}>
                                <div className="partner-card-header">
                                    <div className="partner-avatar">
                                        {partner.company ? partner.company[0].toUpperCase() : partner.contactName[0].toUpperCase()}
                                    </div>
                                    <div className="partner-info-meta">
                                        <h5 className="partner-company" onClick={() => handleSelectCustomer(partner)}>
                                            {partner.company || 'Private Contractor'}
                                        </h5>
                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                                            <span className={`partner-badge ${partner.status?.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}>
                                                {partner.status || 'Active'}
                                            </span>
                                            <span className="partner-badge type-badge">
                                                {partner.customerType || 'Fabricator'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="partner-card-body">
                                    <div className="partner-field">
                                        <span className="field-label">Contact</span>
                                        <span className="field-value">{partner.contactName}</span>
                                    </div>
                                    {partner.phone && (
                                        <div className="partner-field">
                                            <span className="field-label">Phone</span>
                                            <span className="field-value">{partner.phone}</span>
                                        </div>
                                    )}
                                    <div className="partner-field">
                                        <span className="field-label">Last Visited</span>
                                        <span className="field-value highlight">
                                            {partner.lastVisitDate ? formatDate(partner.lastVisitDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never'}
                                        </span>
                                    </div>
                                </div>
                                <div className="partner-card-actions">
                                    <button 
                                        className="partner-action-btn view-btn"
                                        onClick={() => handleSelectCustomer(partner)}
                                    >
                                        View Profile
                                    </button>
                                    <button 
                                        className="partner-action-btn unlink-btn"
                                        onClick={() => handleUnlinkPartner(partner._id, partner.company || partner.contactName)}
                                    >
                                        Unlink
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        };

        return (
            <div className="network-tab-container">
                <div className="tab-header">
                    <div className="tab-header-left">
                        <h3>Partner Network</h3>
                        <p className="network-subtitle">Track and link fabricators, designers, and builders associated with this customer.</p>
                    </div>
                    <button className="add-btn" onClick={() => setShowLinkPartnerModal(true)}>
                        <Plus size={18} /> Link Partner
                    </button>
                </div>

                {partners.length === 0 ? (
                    <div className="network-empty-state">
                        <div className="empty-icon-container">
                            <Users size={32} className="empty-icon" />
                        </div>
                        <h4>No associated partners linked yet</h4>
                        <p>Link this customer to fabricators, designers, or builders they work with to see mutual activity and share details.</p>
                        <button className="link-action-btn" onClick={() => setShowLinkPartnerModal(true)}>
                            <Plus size={16} /> Link Your First Partner
                        </button>
                    </div>
                ) : (
                    <div className="network-sections">
                        {renderPartnerGrid(fabricators, "Associated Fabricators")}
                        {renderPartnerGrid(otherPartners, "Associated Designers & Builders")}
                    </div>
                )}
            </div>
        );
    };

    const renderPriceListView = () => {
        const sidebarToggle = (!isSidebarOpen || isMobile) ? (
            <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(true)} />
        ) : null;

        return (
            <Suspense fallback={<TabLoader />}>
                <PriceListPanel sidebarToggle={sidebarToggle} />
            </Suspense>
        );
    };

    const renderUsersRolesView = (section) => {
        const sidebarToggle = (!isSidebarOpen || isMobile) ? (
            <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(true)} />
        ) : null;

        return (
            <Suspense fallback={<TabLoader />}>
            <UsersRolesTab
                section={section}
                sidebarToggle={sidebarToggle}
                locations={locations}
                fetchLocations={fetchLocations}
            />
            </Suspense>
        );
    };

    const renderUserProfileView = () => {
        const sidebarToggle = (!isSidebarOpen || isMobile) ? (
            <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(true)} />
        ) : null;

        return (
            <UserProfileTab 
                sidebarToggle={sidebarToggle} 
                handleGoHome={handleGoHome} 
                theme={theme}
            />
        );
    };

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

                {!authLoading && currentUser?.permissions && crmTab === 'checkin' && canViewCheckInLog(currentUser) && (
                    <ErrorBoundary key="checkin-log-view">
                        {renderCheckInLogView()}
                    </ErrorBoundary>
                )}

                {!authLoading && currentUser?.permissions && crmTab === 'pricelist' && currentUser.permissions.includes('view_pricelist') && (
                    <ErrorBoundary key="price-list-view">
                        {renderPriceListView()}
                    </ErrorBoundary>
                )}

                {!authLoading && currentUser?.permissions && ['users', 'roles', 'locations'].includes(crmTab)
                    && (crmTab === 'users' ? canOpenUsersPage(currentUser) : canOpenArea(currentUser, crmTab)) && (
                    <ErrorBoundary key={`users-roles-view-${crmTab}`}>
                        {renderUsersRolesView(crmTab)}
                    </ErrorBoundary>
                )}

                {!authLoading && currentUser?.permissions && crmTab === 'nav_order' && can(currentUser, NAV_ORDER) && (
                    <ErrorBoundary key="nav-order-view">
                        <Suspense fallback={<TabLoader />}>
                            <NavOrderTab
                                order={navOrder}
                                onSave={saveNavOrder}
                                sidebarToggle={(!isSidebarOpen || isMobile) ? (
                                    <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(true)} />
                                ) : null}
                            />
                        </Suspense>
                    </ErrorBoundary>
                )}

                {!authLoading && currentUser?.permissions && crmTab === 'profile' && (
                    <ErrorBoundary key="user-profile-view">
                        {renderUserProfileView()}
                    </ErrorBoundary>
                )}

                {!authLoading && currentUser?.permissions && crmTab === 'lost_sales' && (() => {
                    const sidebarToggle = (!isSidebarOpen || isMobile) ? (
                        <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(!isSidebarOpen)} />
                    ) : null;

                    return (
                        <ErrorBoundary key="lost-sales-view">
                        <Suspense fallback={<TabLoader />}>
                            <LostSalesTab
                                currentUser={currentUser}
                                customersList={allCustomersForSelection.length > 0 ? allCustomersForSelection : (customers || [])}
                                customerOptions={customerOptions}
                                locationsList={locations || ['Seattle', 'Spokane', 'Salt Lake City']}
                                theme={theme}
                                onCreateNew={openNewCustomer}
                                isDropdownLoading={isDropdownLoading}
                                sidebarToggle={sidebarToggle}
                            />
                        </Suspense>
                        </ErrorBoundary>
                    );
                })()}

                {!authLoading && currentUser?.permissions && crmTab === 'crossover_sheet' && (() => {
                    const sidebarToggle = (!isSidebarOpen || isMobile) ? (
                        <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(!isSidebarOpen)} />
                    ) : null;

                    return (
                        <ErrorBoundary key="crossover-sheet-view">
                        <Suspense fallback={<TabLoader />}>
                            <CrossoverSheetTab
                                currentUser={currentUser}
                                sidebarToggle={sidebarToggle}
                            />
                        </Suspense>
                        </ErrorBoundary>
                    );
                })()}

                {!authLoading && currentUser?.permissions && crmTab === 'inventory_analysis' && (() => {
                    const sidebarToggle = (!isSidebarOpen || isMobile) ? (
                        <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(!isSidebarOpen)} />
                    ) : null;

                    return (
                        <ErrorBoundary key="inventory-analysis-view">
                        <Suspense fallback={<TabLoader />}>
                            <InventoryAnalysisTab
                                currentUser={currentUser}
                                sidebarToggle={sidebarToggle}
                                refreshSignal={inventoryAnalysisRefreshTrigger}
                            />
                        </Suspense>
                        </ErrorBoundary>
                    );
                })()}

                {!authLoading && currentUser?.permissions && crmTab === 'daily_report' && (() => {
                    const sidebarToggle = (!isSidebarOpen || isMobile) ? (
                        <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(!isSidebarOpen)} />
                    ) : null;

                    return (
                        <ErrorBoundary key="daily-report-view">
                        <Suspense fallback={<TabLoader />}>
                            <DailyReportTab
                                currentUser={currentUser}
                                sidebarToggle={sidebarToggle}
                            />
                        </Suspense>
                        </ErrorBoundary>
                    );
                })()}

                {!authLoading && currentUser?.permissions && crmTab === 'freight' && currentUser.permissions.includes('view_freight_charges') && (() => {
                    const sidebarToggle = (!isSidebarOpen || isMobile) ? (
                        <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(!isSidebarOpen)} />
                    ) : null;

                    return (
                        <ErrorBoundary key="freight-view">
                        <Suspense fallback={<TabLoader />}>
                            <FreightTab
                                currentUser={currentUser}
                                locationsList={locations || []}
                                sidebarToggle={sidebarToggle}
                            />
                        </Suspense>
                        </ErrorBoundary>
                    );
                })()}

                {!authLoading && currentUser?.permissions && crmTab === 'holds' && canSeeHolds && (() => {
                    const sidebarToggle = (!isSidebarOpen || isMobile) ? (
                        <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(!isSidebarOpen)} />
                    ) : null;

                    return (
                        <ErrorBoundary key="holds-view">
                        <Suspense fallback={<TabLoader />}>
                            <HoldsTab currentUser={currentUser} sidebarToggle={sidebarToggle} />
                        </Suspense>
                        </ErrorBoundary>
                    );
                })()}

                {!authLoading && currentUser?.permissions && crmTab === 'permits' && currentUser.permissions.includes(PERMITS.VIEW) && (() => {
                    const sidebarToggle = (!isSidebarOpen || isMobile) ? (
                        <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(!isSidebarOpen)} />
                    ) : null;

                    return (
                        <ErrorBoundary key="permits-view">
                        <Suspense fallback={<TabLoader />}>
                            <PermitsTab
                                sidebarToggle={sidebarToggle}
                                onOpenCustomer={(id) => handleSelectCustomer({ _id: id }, 'permits')}
                                onCreateCustomer={openNewCustomer ? (values) => { setCustomerPrefill(values); setShowAddCustomerModal(true); } : null}
                            />
                        </Suspense>
                        </ErrorBoundary>
                    );
                })()}

                {!authLoading && currentUser?.permissions && crmTab === 'delivery_schedule' && (() => {
                    const sidebarToggle = (!isSidebarOpen || isMobile) ? (
                        <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(!isSidebarOpen)} />
                    ) : null;

                    return (
                        <ErrorBoundary key="delivery-schedule-view">
                        <Suspense fallback={<TabLoader />}>
                            <DeliveryScheduleTab
                                currentUser={currentUser}
                                locationsList={locations || ['Seattle', 'Spokane', 'Salt Lake City']}
                                customerOptions={customerOptions}
                                theme={theme}
                                sidebarToggle={sidebarToggle}
                            />
                        </Suspense>
                        </ErrorBoundary>
                    );
                })()}

                {/* Kept mounted once opened, and hidden rather than unmounted when
                    you navigate away. Google bills a map load per map instance
                    created, so unmounting would buy a fresh one every time you came
                    back. Nothing runs while it is hidden — the fetch and the
                    geolocation both happen on mount. */}
                {!authLoading && currentUser?.permissions && routePlannerOpened && currentUser.permissions.includes('view_route_planner') && (
                    <div style={{ position: 'relative', display: crmTab === 'route_planner' ? 'block' : 'none' }}>
                        <ErrorBoundary key="route-planner-v2-view">
                        <Suspense fallback={<TabLoader />}>
                            <RoutePlannerV2
                                currentUser={currentUser}
                                theme={theme}
                                isActive={crmTab === 'route_planner'}
                                preselect={routePreselect}
                                onOpenCustomer={(id) => handleSelectCustomer({ _id: id }, 'route_planner')}
                                onAddVisit={canAddVisits ? handleAddVisitForPin : null}
                                onAddResource={canAddVisits ? handleAddResourceForPin : null}
                                sidebarToggle={(!isSidebarOpen || isMobile) ? (
                                    <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(!isSidebarOpen)} />
                                ) : null}
                            />
                        </Suspense>
                        </ErrorBoundary>
                    </div>
                )}

                {!authLoading && currentUser?.permissions && crmTab === 'customers' && currentUser.permissions.includes('view_customers') && (
                    <>
                    {selectedCustomer && (
                        <ErrorBoundary key={selectedCustomerId}>
                        <>
                            {/* Customer header: who they are, status, actions, summary, tabs. Hidden in full-screen chat. */}
                            {!isChatFullScreen && (
                                <div className="cl-ph-wrap">
                                    <CustomerProfileHeader
                                        customer={selectedCustomer}
                                        loading={visitsLoading}
                                        activeTab={activeTab}
                                        onTab={handleActiveTabChange}
                                        onBack={handleBackToCustomersList}
                                        onGoHome={handleGoHome}
                                        canEdit={!!currentUser?.permissions?.includes('manage_customers')}
                                        onStatusChanged={(status) => {
                                            setSelectedCustomerDetail(prev => (prev ? { ...prev, status } : prev));
                                            const cached = customerCacheRef.current[selectedCustomerId];
                                            if (cached) customerCacheRef.current[selectedCustomerId] = { ...cached, status };
                                        }}
                                    />
                                </div>
                            )}

                            <div className="tab-content">
                                {activeTab === 'details' && (
                                    // tab-section: on a phone/iPad the tab area only scrolls
                                    // inside one (SalesPage.css), so without it the bottom
                                    // of the tab — the admin card — was cut off.
                                    <div className="tab-section details-tab">
                                    <CustomerDetailsTab
                                        customer={selectedCustomer}
                                        detail={selectedCustomerDetail}
                                        levelLabel={getCustomerLevelLabel(selectedCustomer)}
                                        quickNote={quickNote}
                                        onQuickNoteChange={setQuickNote}
                                        onSaveQuickNote={handleSaveQuickNote}
                                        savingNote={isSavingNote}
                                        noteSaved={Boolean(selectedCustomerDetail?.quickNote) && quickNote === selectedCustomerDetail.quickNote}
                                        canManageAccount={!!currentUser?.permissions?.includes('manage_customer_accounts')}
                                        accountStatus={accountActionStatus}
                                        onToggleActive={() => handleToggleCustomerStatus(selectedCustomerDetail?._id, selectedCustomerDetail?.isActive ?? true)}
                                        resetPassword={resetPasswordValue}
                                        onResetPasswordChange={setResetPasswordValue}
                                        onResetPassword={() => handleResetCustomerPassword(selectedCustomerDetail?._id)}
                                    />
                                    </div>
                                )}

                                {activeTab === 'contacts' && (
                                    <div className="tab-section contacts-tab">
                                        <CustomerContactsTab
                                            customer={selectedCustomer}
                                            onAdd={handleAddContact}
                                            onEdit={handleEditContact}
                                            onDelete={handleDeleteContact}
                                        />
                                    </div>
                                )}

                                {activeTab === 'visits' && (
                                    <div className="tab-section visits-tab">
                                        {/* Top "New Post" Input Area */}
                                        {/* Add Visit Button Area */}
                                        <div className="add-visit-container">
                                            <button className="icon-action-btn secondary" onClick={handleAddContact} title="Add Contact">
                                                <UserPlus size={18} />
                                                <span className="btn-label">Add Contact</span>
                                            </button>
                                            {canAddVisits && (
                                                <>
                                                    <button className="icon-action-btn secondary" onClick={handleAddResource} title="Add Resource">
                                                        <FolderPlus size={18} />
                                                        <span className="btn-label">Add Resource</span>
                                                    </button>
                                                    <button className="add-visit-btn" onClick={handleQuickAddVisit}>
                                                        <Plus size={18} />
                                                        Add Visit
                                                    </button>
                                                </>
                                            )}
                                        </div>

                                        <div className="chat-container channel-feed">
                                            <div className="chat-messages feed-list">
                                                {visitsLoading || (!selectedCustomerDetail?.visits && !customerCacheRef.current[selectedCustomerId]) ? (
                                                    <div className="loading-spinner-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '220px', padding: '3rem 2rem', gap: '12px' }}>
                                                        <Loader className="spin-animation" size={32} color="#D4AF37" />
                                                        <span style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 500 }}>Loading customer history...</span>
                                                    </div>
                                                ) : (
                                                    selectedCustomer.visits?.length > 0 ? (
                                                        [...selectedCustomer.visits].reverse().map(visit => (
                                                            <VisitPostCard
                                                                key={visit._id}
                                                                visit={visit}
                                                                currentUser={currentUser}
                                                                currentUserId={currentUserId}
                                                                formatDate={formatDate}
                                                                handleReaction={handleReaction}
                                                                activeReactionMessageId={activeReactionMessageId}
                                                                setActiveReactionMessageId={setActiveReactionMessageId}
                                                                handleEditVisit={handleEditVisit}
                                                                handleDeleteVisit={handleDeleteVisit}
                                                                handleOpenGallery={handleOpenGallery}
                                                                canModify={canModifyVisit({ ...currentUser, id: currentUserId }, visit, selectedCustomer?.location)}
                                                                canDelete={canDeleteVisit({ ...currentUser, id: currentUserId }, visit, selectedCustomer?.location)}
                                                            />
                                                        ))
                                                    ) : (
                                                        <div className="empty-list-message">
                                                            No posts yet. Be the first to post!
                                                        </div>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'resources' && (
                                    <div className="tab-section resources-tab">
                                        {/* Filters Section */}


                                        {/* Header with Title and Add Button */}
                                        <div className="tab-header">
                                            <h3>Client Resource</h3>
                                            {canAddVisits && (
                                                <button className="add-resource-btn" onClick={handleAddResource}>
                                                    <Plus size={18} /> Add Resource
                                                </button>
                                            )}
                                        </div>



                                        {/* Resources Table */}
                                        <div className="resources-table-wrapper">
                                            <table className="resources-table">
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: '50px' }}>#</th>
                                                        <th>Date</th>
                                                        <th>Client</th>
                                                        <th>Location</th>
                                                        <th>Type</th>
                                                        <th style={{ width: '120px' }}>Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {customerFilteredResources && customerFilteredResources.length > 0 ? (
                                                        customerFilteredResources.map((resource, index) => (
                                                            <React.Fragment key={resource._id || index}>
                                                                <tr
                                                                    className={expandedResourceId === resource._id ? 'expanded' : ''}
                                                                    onClick={() => setExpandedResourceId(expandedResourceId === resource._id ? null : resource._id)}
                                                                >
                                                                    <td data-label="#">{index + 1}</td>
                                                                    <td data-label="Date">{formatDate(resource.date, { month: '2-digit', day: '2-digit', year: 'numeric' })}</td>
                                                                    <td data-label="Client">
                                                                        {(() => {
                                                                            const customerObj = customers.find(c => c._id === resource.customerId);
                                                                            return customerObj ? (customerObj.company || customerObj.contactName) : (resource.customer || '-');
                                                                        })()}
                                                                    </td>
                                                                    <td data-label="Location">{resource.location || '-'}</td>
                                                                    <td data-label="Type">{resource.resourceType || '-'}</td>
                                                                    <td data-label="Actions">
                                                                        <div className="action-buttons" onClick={(e) => e.stopPropagation()}>
                                                                            <button className="icon-btn view" onClick={(e) => { e.stopPropagation(); handleViewResource(resource); }} title="View" disabled={loadingResourceId === resource._id}>
                                                                                {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
                                                                            </button>
                                                                            {canModifyVisit({ ...currentUser, id: currentUserId }, { createdBy: resource.uploadedBy || resource.createdBy }, selectedCustomer?.location) && (
                                                                                <button className="icon-btn edit" onClick={(e) => { e.stopPropagation(); handleEditResource(resource); }} title="Edit">
                                                                                    <Edit2 size={16} />
                                                                                </button>
                                                                            )}
                                                                            {canDeleteVisit({ ...currentUser, id: currentUserId }, { createdBy: resource.uploadedBy || resource.createdBy }, selectedCustomer?.location) && (
                                                                                <button className="icon-btn delete" onClick={(e) => { e.stopPropagation(); handleDeleteResource(resource._id, resource.customerId); }} title="Delete">
                                                                                    <Trash2 size={16} />
                                                                                </button>
                                                                            )}
                                                                            {resource.url && (
                                                                                <a href={resource.url} target="_blank" rel="noopener noreferrer" className="icon-btn link" onClick={(e) => e.stopPropagation()} title="Open Link">
                                                                                    🔗
                                                                                </a>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                                {expandedResourceId === resource._id && (
                                                                    <tr className="resource-details-row">
                                                                        <td colSpan="6">
                                                                            <div className="resource-details">
                                                                                <div className="detail-item">
                                                                                    <strong>Attachments</strong>
                                                                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                                                                        {(Array.isArray(resource.image) ? resource.image : (resource.image ? [resource.image] : [])).length > 0 ? (
                                                                                            (Array.isArray(resource.image) ? resource.image : [resource.image]).map((img, idx) => (
                                                                                                isPdfSource(img) ? (
                                                                                                    <div key={idx} style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => openPdfInline(img)}>
                                                                                                        <FileText size={40} color="#E5C04A" />
                                                                                                        <div style={{ fontSize: '10px' }}>PDF</div>
                                                                                                    </div>
                                                                                                ) : (
                                                                                                    <img
                                                                                                        key={idx}
                                                                                                        src={img}
                                                                                                        alt="Resource"
                                                                                                        style={{ maxWidth: '100px', maxHeight: '100px', objectFit: 'cover', cursor: 'pointer', borderRadius: '4px', border: '1px solid #ddd' }}
                                                                                                        onClick={() => {
                                                                                                            const attachments = Array.isArray(resource.image) ? resource.image : [resource.image];
                                                                                                            handleOpenGallery(attachments, idx);
                                                                                                        }}
                                                                                                        loading="lazy"
                                                                                                    />
                                                                                                )
                                                                                            ))
                                                                                        ) : (
                                                                                            <span className="placeholder-img">No attachments</span>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                                <div className="detail-item">
                                                                                    <strong>Description</strong>
                                                                                    <p>{resource.description || '-'}</p>
                                                                                </div>
                                                                                <div className="detail-item">
                                                                                    <strong>Notes</strong>
                                                                                    <p>{resource.notes || '-'}</p>
                                                                                </div>
                                                                                <div className="detail-item">
                                                                                    <strong>Status</strong>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                                                                                        <span className={`status-badge ${resource.status?.toLowerCase()}`}>
                                                                                            {resource.status || 'Active'}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </React.Fragment>
                                                        ))
                                                    ) : (
                                                        <tr>
                                                            <td colSpan="6" className="empty-row">No resources found</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>


                                    </div>
                                )}
                                {activeTab === 'network' && (
                                    <div className="tab-section network-tab">
                                        {renderNetworkTab()}
                                    </div>
                                )}
                            </div>
                        </>
                        </ErrorBoundary>
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
                <ErrorBoundary key="dashboard-view">
                    <div className="sales-dashboard-v2">
                            {/* No skeleton gated on `loading` here: that flag is the Customers
                                list, which the dashboard doesn't render from (it has its own
                                /api/dashboard/* data, and its tables show "Loading…" until that
                                lands — see dashboardTableLoading). Waiting on it left the main
                                area blank for ~2s after login, after the dashboard data had arrived. */}
                                <>
                                    {/* Header */}
                                    <div className="dashboard-header-v2">
                                        <div className="dashboard-header-content">
                                            <div className="dashboard-left-section">
                                                {(!isSidebarOpen || isMobile) && (
                                                    <button
                                                        onClick={() => setIsSidebarOpen(true)}
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
                                                <DashboardRange value={dashboardTimeRange} onChange={setDashboardTimeRange} />
                                                {activeDashboardTab === 'visits' && (
                                                    <>
                                                        <LocationFilter
                                                            options={dashboardLocationOptions}
                                                            value={dashboardLocation}
                                                            onChange={handleDashboardLocationChange}
                                                            user={currentUser}
                                                        />
                                                        <RowMenu
                                                            label="More"
                                                            items={[{ key: 'export', label: 'Export to Excel', icon: Download, onClick: () => handleExportVisits() }]}
                                                        />
                                                    </>
                                                )}
                                                {activeDashboardTab === 'planner' && (
                                                    <button 
                                                        className="btn-secondary" 
                                                        onClick={() => setShowCalendarSyncModal(true)} 
                                                        title="Sync to Apple / Google Calendar"
                                                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                                    >
                                                        📅 Sync Calendar
                                                    </button>
                                                )}
                                                {canAddVisits && (
                                                    <>
                                                        <button className="btn-secondary" onClick={handleQuickAddResource} title="Add Resource for any Client">
                                                            + Add Resource
                                                        </button>
                                                        <button className="btn-primary" onClick={handleQuickAddVisit} title="Add Visit for any Client">
                                                            + Add Visit
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <DashboardStats
                                        stats={stats}
                                        statsLoading={statsLoading}
                                        dashboardTimeRange={dashboardTimeRange}
                                        activeDashboardTab={activeDashboardTab}
                                        setActiveDashboardTab={setActiveDashboardTab}
                                        todayScheduleCount={todayScheduleCount}

                                    />


                                    {/* Visits Table */}
                                    {/* Sales Visits Table */}
                                    {activeDashboardTab === 'planner' && (
                                        <div className="planner-dashboard-container">
                                            <Suspense fallback={<TabLoader />}>
                                            <SalesPlannerTab
                                                customerSelection={allCustomersForSelection}
                                                customerOptions={customerOptions}
                                                isDropdownLoading={isDropdownLoading}
                                                currentUserId={currentUserId}
                                                onSelectCustomer={handleSelectCustomer}
                                                onScheduleChange={fetchSchedules}
                                            />
                                            </Suspense>
                                        </div>
                                    )}

                                    {activeDashboardTab === 'visits' && (
                                        <div className="dfx-board">
                                        <div className="visits-table-section">
                                            <div className="section-header">
                                                <h2>Sales Visits</h2>
                                                <div className="table-controls">
                                                    <div className="table-search">
                                                         <Search className="search-icon" size={18} />
                                                         <input
                                                             type="text"
                                                             placeholder="Search visits..."
                                                            value={dashboardSearchTerm}
                                                            onChange={(e) => setDashboardSearchTerm(e.target.value)}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <VisitsFocusList
                                                visits={pagedDashboardVisits}
                                                canModify={(visit) => canModifyVisit({ ...currentUser, id: currentUserId }, visit, visit.location)}
                                                canDelete={(visit) => canDeleteVisit({ ...currentUser, id: currentUserId }, visit, visit.location)}
                                                canOpenCustomer={currentUser?.permissions?.includes('view_customers')}
                                                loading={dashboardTableLoading}
                                                busyVisitId={loadingVisitId}
                                                onOpenCustomer={(visit) => setVisitCardFor(visit)}
                                                onEdit={handleEditVisit}
                                                onDelete={(visit) => handleDeleteVisit(visit._id, visit.customerId)}
                                                onOpenGallery={handleOpenGallery}
                                            />

                                            {/* Pagination Controls */}
                                            <Pagination
                                                 currentPage={currentVisitsPage}
                                                 totalPages={Math.ceil(memoizedFilteredVisits.length / visitsPerPage)}
                                                 onPageChange={(p) => { setCurrentVisitsPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                                 rowsPerPage={visitsPerPage}
                                                 onRowsPerPageChange={handleVisitsPerPageChange}
                                                 totalCount={memoizedFilteredVisits.length}
                                             />
                                        </div>
                                        <DashboardAside
                                            schedules={allSchedules}
                                            customerName={(sch) => {
                                                const id = sch.customerId?._id || sch.customerId;
                                                const c = customers.find(x => String(x._id) === String(id));
                                                const src = c || sch.customerId || {};
                                                return src.company || src.contactName || '';
                                            }}
                                            followUps={followUpPanel}
                                            followUpCount={stats.followUp}
                                            onOpenPlanner={() => setActiveDashboardTab('planner')}
                                            onOpenFollowUps={() => setActiveDashboardTab('followups')}
                                            onOpenCustomer={(f) => {
                                                if (!f.customerId) return;
                                                handleSelectCustomer({ _id: f.customerId });
                                                setShowDashboard(false);
                                            }}
                                        />
                                        </div>
                                    )}

                                    {/* Follow-up Actions Table */}
                                    {activeDashboardTab === 'followups' && (
                                        <div className="visits-table-section">
                                            <div className="section-header">
                                                <h2>Follow-up Actions</h2>
                                                <div className="table-controls">
                                                    <div className="dashboard-sub-tabs" style={{ marginBottom: 0, border: 'none' }}>
                                                        <button
                                                            className={`sub-tab-btn ${followupFilter === 'all' ? 'active' : ''}`}
                                                            onClick={() => {
                                                                setFollowupFilter('all');
                                                                setCurrentFollowUpPage(1);
                                                            }}
                                                            style={{ padding: '0.5rem 1rem' }}
                                                        >
                                                            All Notes
                                                        </button>
                                                        <button
                                                            className={`sub-tab-btn ${followupFilter === 'nextWeek' ? 'active' : ''}`}
                                                            onClick={() => {
                                                                setFollowupFilter('nextWeek');
                                                                setCurrentFollowUpPage(1);
                                                            }}
                                                            style={{ padding: '0.5rem 1rem' }}
                                                        >
                                                            Next Week
                                                        </button>
                                                    </div>
                                                    <LocationFilter
                                                        options={dashboardLocationOptions}
                                                        value={dashboardLocation}
                                                        onChange={handleDashboardLocationChange}
                                                        user={currentUser}
                                                    />
                                                    <button className="export-btn" onClick={() => {
                                                        const followups = memoizedFilteredVisits.filter(v => v && (v.nextAction || v.followUp));
                                                        handleExportVisits(followups);
                                                    }}>
                                                        <Download size={18} /> Excel
                                                    </button>
                                                    <div className="table-search">
                                                         <Search className="search-icon" size={18} />
                                                         <input
                                                             type="text"
                                                             placeholder="Search follow-ups..."
                                                            value={dashboardSearchTerm}
                                                            onChange={(e) => setDashboardSearchTerm(e.target.value)}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="dashboard-table-wrapper">
                                                <table className="dashboard-table">
                                                    <thead>
                                                        <tr>
                                                            <th className="mobile-hide">Date</th>
                                                            <th>Customer</th>
                                                            <th>Action Item / Note</th>
                                                            <th className="mobile-hide">Source</th>
                                                            <th>Action</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(() => {
                                                            const followups = memoizedFollowups;

                                                            if (followups.length === 0 && dashboardTableLoading) {
                                                                return renderDashboardLoadingRow(5);
                                                            }
                                                            if (followups.length === 0) {
                                                                return (
                                                                    <tr>
                                                                        <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                                                                            {followupFilter === 'nextWeek' ? 'No follow-ups scheduled for next week' : 'No follow-up notes found'}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            }
                                                            const indexOfLastItem = currentFollowUpPage * visitsPerPage;
                                                            const indexOfFirstItem = indexOfLastItem - visitsPerPage;
                                                            const currentItems = followups.slice(indexOfFirstItem, indexOfLastItem);

                                                            return currentItems.map((item, index) => (
                                                                <tr key={item._id || index}>
                                                                    <td className="mobile-hide">{formatDate(item.displayDate, { month: 'numeric', day: 'numeric', year: 'numeric' })}</td>
                                                                    <td>
                                                                        <span
                                                                            className="link"
                                                                            onClick={() => {
                                                                                handleSelectCustomer({ _id: item.customerId });
                                                                                setShowDashboard(false);
                                                                            }}
                                                                        >
                                                                            {item.customerName}
                                                                        </span>
                                                                    </td>
                                                                    <td>
                                                                        <div title={item.displayNote} style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            {item.displayNote}
                                                                        </div>
                                                                    </td>
                                                                    <td className="mobile-hide">
                                                                        <span className={`status-badge ${item.source === 'Planner' ? 'completed' : 'pending'}`}>
                                                                            {item.source}
                                                                        </span>
                                                                    </td>
                                                                    <td>
                                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                                            {item.isSchedule ? (
                                                                                <button
                                                                                    className="icon-btn-ghost"
                                                                                    onClick={() => setActiveDashboardTab('planner')}
                                                                                    title="View in Planner"
                                                                                >
                                                                                    <Calendar size={16} />
                                                                                </button>
                                                                            ) : (
                                                                                <>
                                                                                    <button
                                                                                        className="icon-btn-ghost"
                                                                                        onClick={() => handleViewVisit(item)}
                                                                                        title="View Details"
                                                                                    >
                                                                                        <Eye size={16} />
                                                                                    </button>
                                                                                    <button
                                                                                        className="icon-btn-ghost"
                                                                                        onClick={() => handleEditVisit(item)}
                                                                                        title="Edit Visit"
                                                                                    >
                                                                                        <Pencil size={16} />
                                                                                    </button>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            ));
                                                        })()}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Follow-up Pagination Controls */}
                                            <Pagination
                                                 currentPage={currentFollowUpPage}
                                                 totalPages={Math.ceil(memoizedFollowups.length / visitsPerPage)}
                                                 onPageChange={(p) => {
                                                     setCurrentFollowUpPage(p);
                                                     const el = document.querySelector('.dashboard-content-area') || document.querySelector('.sales-dashboard-main');
                                                     if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
                                                     else window.scrollTo({ top: 0, behavior: 'smooth' });
                                                 }}
                                                 rowsPerPage={visitsPerPage}
                                                 onRowsPerPageChange={handleVisitsPerPageChange}
                                                 totalCount={memoizedFollowups.length}
                                             />
                                        </div>
                                    )}
                                    {activeDashboardTab === 'leads' && (
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

                                    {/* Resources Table */}
                                    {activeDashboardTab === 'resources' && (
                                        <div className="visits-table-section">
                                            <div className="section-header">
                                                <h2>Resources</h2>
                                                {activeResourceSubTab === 'client' && (
                                                    <div className="table-controls">
                                                        <LocationFilter
                                                            options={dashboardLocationOptions}
                                                            value={dashboardLocation}
                                                            onChange={handleDashboardLocationChange}
                                                            user={currentUser}
                                                        />
                                                        <button className="export-btn" onClick={handleExportResources}>
                                                            <Download size={18} /> Excel
                                                        </button>
                                                        <div className="table-search">
                                                            <Search className="search-icon" size={18} />
                                                            <input
                                                                type="text"
                                                                placeholder="Search resources..."
                                                                value={dashboardSearchTerm}
                                                                onChange={(e) => setDashboardSearchTerm(e.target.value)}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                                {activeResourceSubTab === 'team' && (
                                                    <div className="team-resources-controls">
                                                        <div className="resource-breadcrumbs">
                                                            <span
                                                                className="breadcrumb-item"
                                                                onClick={() => {
                                                                    if (folderPath.length > 0) {
                                                                        // Navigate to root
                                                                        setCurrentFolderId(null);
                                                                        setFolderPath([]);
                                                                        setDashboardSearchTerm('');
                                                                    }
                                                                }}
                                                            >
                                                                Home
                                                            </span>
                                                            {folderPath.map((folder, index) => (
                                                                <React.Fragment key={folder.id}>
                                                                    <span className="separator">/</span>
                                                                    <span
                                                                        className={`breadcrumb-item ${index === folderPath.length - 1 ? 'current' : ''}`}
                                                                        onClick={() => handleBreadcrumbClick(index)}
                                                                    >
                                                                        {folder.name}
                                                                    </span>
                                                                </React.Fragment>
                                                            ))}
                                                        </div>
                                                        <div className="team-resources-actions">
                                                            <button
                                                                className="icon-action-btn secondary"
                                                                title="Refresh Files"
                                                                onClick={fetchDashboardResources}
                                                            >
                                                                <RefreshCw size={16} />
                                                            </button>
                                                            <button className="icon-action-btn secondary" onClick={() => { setFolderName(''); setShowAddFolderModal(true); }}>
                                                                <FolderPlus size={16} /> <span className="mobile-hide-text">Add Folder</span>
                                                            </button>
                                                            <button className="icon-action-btn primary" onClick={() => { setDashboardUploadForm({ name: '', type: 'file', content: '', file: null }); setEditingDashboardResource(null); setShowDashboardUploadModal(true); }}>
                                                                <Upload size={16} /> <span className="mobile-hide-text">Upload</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="dashboard-sub-tabs">
                                                <button
                                                    className={`sub-tab-btn ${activeResourceSubTab === 'client' ? 'active' : ''}`}
                                                    onClick={() => setActiveResourceSubTab('client')}
                                                >
                                                    Client Updates
                                                </button>
                                                <button
                                                    className={`sub-tab-btn ${activeResourceSubTab === 'team' ? 'active' : ''}`}
                                                    onClick={() => setActiveResourceSubTab('team')}
                                                >
                                                    Team Files
                                                </button>
                                            </div>

                                            {activeResourceSubTab === 'client' && (
                                                <>


                                                    <div className="dashboard-table-wrapper">
                                                        <table className="dashboard-table">
                                                            <thead>
                                                                <tr>
                                                                    <th className="mobile-hide">Date</th>
                                                                    <th>Customer</th>
                                                                    <th>Type</th>
                                                                    <th className="mobile-hide">Description</th>
                                                                    <th>Action</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(() => {
                                                                    const resources = memoizedFilteredResources;
                                                                    if (resources.length === 0 && dashboardTableLoading) {
                                                                        return renderDashboardLoadingRow(5);
                                                                    }
                                                                    if (resources.length === 0) {
                                                                        return (
                                                                            <tr>
                                                                                <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                                                                                    No resources found
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    }
                                                                    const indexOfLastResource = currentResourcesPage * visitsPerPage;
                                                                    const indexOfFirstResource = indexOfLastResource - visitsPerPage;
                                                                    const currentResources = resources.slice(indexOfFirstResource, indexOfLastResource);

                                                                    return currentResources.map((resource, index) => (
                                                                        <tr key={resource._id || index}>
                                                                            <td className="mobile-hide">{formatDate(resource.date || resource.createdAt, { month: 'numeric', day: 'numeric', year: 'numeric' })}</td>
                                                                            <td
                                                                                style={{ cursor: 'pointer', color: '#E5C04A', fontWeight: '500' }}
                                                                                onClick={() => {
                                                                                    if (resource.customerId) {
                                                                                        handleSelectCustomer({ _id: resource.customerId });
                                                                                        handleActiveTabChange('resources');
                                                                                        setShowDashboard(false);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                {resource.customerName}
                                                                            </td>
                                                                            <td>{resource.resourceType || '-'}</td>
                                                                            <td className="mobile-hide">{resource.description || resource.notes || '-'}</td>
                                                                            <td>
                                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                                    <button
                                                                                        className="icon-btn-ghost"
                                                                                        title="View Details"
                                                                                        onClick={() => handleViewResource(resource)}
                                                                                        disabled={loadingResourceId === resource._id}
                                                                                    >
                                                                                        {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
                                                                                    </button>
                                                                                    <button
                                                                                        className="icon-btn-ghost"
                                                                                        title="Edit Resource"
                                                                                        onClick={() => handleEditResource(resource)}
                                                                                        disabled={loadingResourceId === resource._id}
                                                                                    >
                                                                                        {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Pencil size={16} />}
                                                                                    </button>
                                                                                    <button
                                                                                        className="icon-btn-ghost delete-btn"
                                                                                        title="Delete Resource"
                                                                                        onClick={() => handleDeleteResource(resource._id, resource.customerId)}
                                                                                        style={{ color: '#ff4d4f' }}
                                                                                    >
                                                                                        <Trash2 size={16} />
                                                                                    </button>
                                                                                    {(Array.isArray(resource.image || resource.content) ? (resource.image || resource.content) : ((resource.image || resource.content) ? [resource.image || resource.content] : [])).length > 0 && ( /* Check if attachments exist */
                                                                                        <button
                                                                                            className="icon-btn-ghost"
                                                                                            title="View Attachments"
                                                                                            onClick={() => {
                                                                                                const attachments = Array.isArray(resource.image || resource.content) ? (resource.image || resource.content) : [resource.image || resource.content];
                                                                                                handleOpenGallery(attachments, 0);
                                                                                            }}
                                                                                            disabled={loadingResourceId === resource._id}
                                                                                        >
                                                                                            {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Paperclip size={16} />}
                                                                                        </button>
                                                                                    )}
                                                                                    {resource.url ? (
                                                                                        <a href={resource.url} target="_blank" rel="noopener noreferrer" className="icon-btn-ghost" title="Open Link">
                                                                                            <Link size={16} />
                                                                                        </a>
                                                                                    ) : (resource.image) ? (
                                                                                        <button
                                                                                            className="icon-btn-ghost"
                                                                                            title="Download"
                                                                                            onClick={() => {
                                                                                                const img = (Array.isArray(resource.image) ? resource.image : [resource.image])[0];
                                                                                                if (img) handleDashboardDownload({ content: img, name: `Resource-${resource.date}.jpg`, type: 'file' });
                                                                                            }}
                                                                                        >
                                                                                            <Download size={16} />
                                                                                        </button>
                                                                                    ) : null}
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    ));
                                                                })()}
                                                            </tbody>
                                                        </table>
                                                    </div>

                                                    {/* Resources Pagination Controls */}
                                                    <Pagination
                                                         currentPage={currentResourcesPage}
                                                         totalPages={Math.ceil(memoizedFilteredResources.length / visitsPerPage)}
                                                         onPageChange={(p) => { setCurrentResourcesPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                                         rowsPerPage={visitsPerPage}
                                                         onRowsPerPageChange={handleVisitsPerPageChange}
                                                         totalCount={memoizedFilteredResources.length}
                                                     />
                                                </>
                                            )}

                                            {activeResourceSubTab === 'team' && (
                                                <div className="team-resources-content">
                                                    <div className="resources-list-container">
                                                        {folderPath.length > 0 && (
                                                            <div className="list-back-button" onClick={() => handleBreadcrumbClick(folderPath.length - 2)}>
                                                                <ArrowLeft size={16} />
                                                                <span>Back</span>
                                                            </div>
                                                        )}

                                                        {salesResources.length === 0 ? (
                                                            <div className="empty-resources-state">
                                                                <div className="empty-icon">
                                                                    <FileSearch size={48} />
                                                                </div>
                                                                <p>No files or folders found in this location</p>
                                                                <button className="btn-secondary small" onClick={() => setShowDashboardUploadModal(true)}>
                                                                    Upload your first file
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <table className="resources-table">
                                                                <thead>
                                                                    <tr>
                                                                        <th style={{ width: '40%' }}>Name</th>
                                                                        <th>Modified</th>
                                                                        <th>Modified By</th>
                                                                        <th style={{ width: '100px' }}></th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {salesResources.filter(r => !dashboardSearchTerm || r.name.toLowerCase().includes(dashboardSearchTerm.toLowerCase())).map(resource => {
                                                                        const isFolder = resource.type === 'folder';
                                                                        const isLink = resource.type === 'link';
                                                                        const isImage = resource.contentType?.startsWith('image/') || resource.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                                                                        const isPdf = resource.contentType === 'application/pdf' || resource.name.toLowerCase().endsWith('.pdf');

                                                                        return (
                                                                            <tr
                                                                                key={resource._id}
                                                                                className="resource-row"
                                                                                onClick={() => handleResourceClick(resource)}
                                                                            >
                                                                                <td className="col-name">
                                                                                    <div className="resource-name-wrapper">
                                                                                        <span className={`resource-icon-small ${resource.type}`}>
                                                                                            {isFolder ? <Folder size={18} fill="currentColor" /> :
                                                                                                isLink ? <Link size={18} /> :
                                                                                                    isImage ? <FileImage size={18} /> :
                                                                                                        isPdf ? <FileText size={18} /> :
                                                                                                            <File size={18} />}
                                                                                        </span>
                                                                                        <span className="name-text">{resource.name}</span>
                                                                                    </div>
                                                                                </td>
                                                                                <td className="col-date">
                                                                                    {formatDate(resource.createdAt, { month: 'long', day: 'numeric', year: 'numeric' })}
                                                                                </td>
                                                                                <td className="col-user">
                                                                                    <span className="user-pill">
                                                                                        {resource.uploadedBy?.username ?
                                                                                            resource.uploadedBy.username.charAt(0).toUpperCase() + resource.uploadedBy.username.slice(1)
                                                                                            : 'Admin'}
                                                                                    </span>
                                                                                </td>
                                                                                <td className="col-actions">
                                                                                    <div className="row-actions">
                                                                                        <button
                                                                                            className="action-icon-btn edit"
                                                                                            onClick={(e) => { e.stopPropagation(); handleEditDashboardResource(resource); }}
                                                                                            title="Edit"
                                                                                        >
                                                                                            <Pencil size={14} />
                                                                                        </button>
                                                                                        <button
                                                                                            className="action-icon-btn delete"
                                                                                            onClick={(e) => { e.stopPropagation(); handleDeleteDashboardResource(resource._id); }}
                                                                                            title="Delete"
                                                                                        >
                                                                                            <Trash2 size={14} />
                                                                                        </button>
                                                                                    </div>
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Follow-ups Table */}
                                </>
                        </div>
                </ErrorBoundary>
            )}

                {/* Dashboard Resource Preview Modal */}
                {previewDashboardResource && (
                    <div className="modal-overlay preview-overlay" onClick={() => setPreviewDashboardResource(null)}>
                        <div className="modal-content preview-modal-content dark-theme" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header preview-header premium-header">
                                <div className="preview-file-info">
                                    <div className="preview-icon-badge">
                                        {previewDashboardResource.type === 'folder' ? <Folder size={20} className="text-gold" /> :
                                            previewDashboardResource.type === 'link' ? <Link size={20} className="text-blue" /> :
                                                (previewDashboardResource.contentType?.startsWith('image/') || previewDashboardResource.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) ? <FileImage size={20} className="text-purple" /> :
                                                    (previewDashboardResource.contentType === 'application/pdf' || previewDashboardResource.name.toLowerCase().endsWith('.pdf')) ? <FileText size={20} className="text-red" /> :
                                                        <File size={20} className="text-gray" />}
                                    </div>
                                    <div className="preview-details">
                                        <h2 className="preview-title" title={previewDashboardResource.name}>{previewDashboardResource.name}</h2>
                                        <div className="preview-meta-row">
                                            <span className="preview-type-tag">{previewDashboardResource.type.toUpperCase()}</span>
                                            <span className="preview-separator">•</span>
                                            <span className="preview-date">{formatDate(previewDashboardResource.createdAt)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="preview-actions">
                                    <a
                                        href={previewDashboardResource.content.startsWith('http') || previewDashboardResource.content.startsWith('data:') ? previewDashboardResource.content : `${API_URL}${previewDashboardResource.content}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="icon-btn-ghost preview-action-btn"
                                        title="Open in New Tab"
                                        onClick={(e) => {
                                            const c = previewDashboardResource.content || '';
                                            const isPdf = c.startsWith('data:application/pdf') || previewDashboardResource.contentType === 'application/pdf' || /\.pdf$/i.test(previewDashboardResource.name || '');
                                            if (!isPdf) return;
                                            e.preventDefault();
                                            openPdfInline(c.startsWith('http') || c.startsWith('data:') ? c : `${API_URL}${c}`);
                                        }}
                                    >
                                        <ExternalLink size={20} />
                                    </a>
                                    <button
                                        className="icon-btn-ghost preview-action-btn"
                                        title="Download"
                                        onClick={() => handleDashboardDownload(previewDashboardResource)}
                                    >
                                        <Download size={20} />
                                    </button>
                                    <button className="close-preview-btn premium-close" onClick={() => setPreviewDashboardResource(null)}>
                                        <X size={24} />
                                    </button>
                                </div>
                            </div>
                            <div className="modal-body preview-body">
                                {previewDashboardResource.type === 'file' ? (
                                    (previewDashboardResource.content?.startsWith('data:image') ||
                                        (!previewDashboardResource.content?.startsWith('data:') &&
                                            (previewDashboardResource.contentType?.startsWith('image/') ||
                                                previewDashboardResource.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)))) ? (
                                        <div className="image-preview-container">
                                            <img
                                                src={previewDashboardResource.content.startsWith('http') || previewDashboardResource.content.startsWith('data:') ? previewDashboardResource.content : `${API_URL}${previewDashboardResource.content}`}
                                                alt={previewDashboardResource.name}
                                                className="preview-image"
                                                loading="lazy"
                                            />
                                        </div>
                                    ) : (previewDashboardResource.content?.startsWith('data:application/pdf') ||
                                        (!previewDashboardResource.content?.startsWith('data:') &&
                                            (previewDashboardResource.contentType === 'application/pdf' ||
                                                previewDashboardResource.name.toLowerCase().endsWith('.pdf')))) ? (
                                        <div className="pdf-preview-container">
                                            <object
                                                data={`${previewDashboardResource.content.startsWith('http') || previewDashboardResource.content.startsWith('data:') ? previewDashboardResource.content : `${API_URL}${previewDashboardResource.content}`}#toolbar=0`}
                                                type="application/pdf"
                                                className="preview-iframe"
                                                width="100%"
                                                height="100%"
                                            >
                                                <div className="no-preview-container" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                                    <p>Unable to display PDF preview.</p>
                                                    <button className="btn-primary small" onClick={() => handleDashboardDownload(previewDashboardResource)}>
                                                        Download PDF
                                                    </button>
                                                </div>
                                            </object>
                                        </div>
                                    ) : (
                                        <div className="no-preview-container">
                                            <File size={64} className="no-preview-icon" />
                                            <p>No preview available for this file type</p>
                                            <button className="btn-primary small" onClick={() => handleDashboardDownload(previewDashboardResource)}>
                                                Download to View
                                            </button>
                                        </div>
                                    )
                                ) : (
                                    <div className="link-preview-container">
                                        <Link size={48} />
                                        <p>This is a web link</p>
                                        <a href={previewDashboardResource.content} target="_blank" rel="noopener noreferrer" className="btn-primary">
                                            Open in New Tab
                                        </a>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Contact Modal */}
                {
                    showContactModal && (
                        <div className="modal-overlay" onClick={() => setShowContactModal(false)}>
                            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                                <div className="modal-header">
                                    <h2>{editingContact ? 'Edit Contact' : 'Add Contact'}</h2>
                                    <button className="close-btn" onClick={() => setShowContactModal(false)}>
                                        <X size={20} />
                                    </button>
                                </div>
                                <div className="modal-body">
                                    <div className="form-group">
                                        <label>Name *</label>
                                        <input
                                            type="text"
                                            value={contactForm.name}
                                            onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                                            placeholder="Contact name"
                                        />
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>Phone</label>
                                            <input
                                                type="tel"
                                                value={contactForm.phone}
                                                onChange={(e) => setContactForm({ ...contactForm, phone: formatPhoneInput(e.target.value) })}
                                                placeholder="(555) 000-0000"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Email</label>
                                            <input
                                                type="email"
                                                value={contactForm.email}
                                                onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                                                placeholder="Email address"
                                            />
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label>Role</label>
                                        <input
                                            type="text"
                                            value={contactForm.role}
                                            onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
                                            placeholder="Job title or role"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Notes</label>
                                        <textarea
                                            value={contactForm.notes}
                                            onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                                            placeholder="Additional notes"
                                            rows="3"
                                        />
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button className="btn-secondary" onClick={() => setShowContactModal(false)} disabled={isSaving}>
                                        Cancel
                                    </button>
                                    <button className="btn-primary" onClick={handleSaveContact} disabled={isSaving}>
                                        {isSaving ? 'Saving...' : 'Save Contact'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }

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
                    <div className="modal-overlay">
                        <div className="modal-content" style={{ maxWidth: '500px', minHeight: '300px', overflow: 'visible' }}>
                            <div className="modal-header" style={{ borderRadius: '12px 12px 0 0' }}>
                                <h2>LINK PARTNER</h2>
                                <button
                                    type="button"
                                    className="close-btn"
                                    onClick={() => { setShowLinkPartnerModal(false); setLinkingPartnerId(''); }}
                                >
                                    <X size={20} />
                                </button>
                            </div>
                            <form onSubmit={handleLinkPartner} style={{ display: 'flex', flexDirection: 'column', overflow: 'visible' }}>
                                <div className="modal-body" style={{ overflow: 'visible' }}>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label>Select Partner to Link</label>
                                        <SearchableSelect
                                            options={linkableCustomerOptions}
                                            value={linkingPartnerId}
                                            onChange={(val) => setLinkingPartnerId(val)}
                                            placeholder="Search by company or contact name..."
                                            isLoading={isDropdownLoading}
                                        />
                                    </div>
                                </div>
                                <div className="modal-footer" style={{ borderRadius: '0 0 12px 12px' }}>
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={() => { setShowLinkPartnerModal(false); setLinkingPartnerId(''); }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn-primary"
                                        disabled={!linkingPartnerId || isLinkingInProgress}
                                    >
                                        {isLinkingInProgress ? 'Linking...' : 'Link Partner'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
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

                {
                    fullScreenImage && (
                        <div className="fullscreen-image-overlay" onClick={() => { setFullScreenImage(null); setFullScreenGallery([]); }}>
                            <div className="fullscreen-image-container" onClick={(e) => e.stopPropagation()} style={{ width: isPdfSource(fullScreenImage) ? '80%' : 'auto', height: isPdfSource(fullScreenImage) ? '90%' : 'auto', maxWidth: '90%', maxHeight: '90%' }}>
                                <button className="fullscreen-close-btn" onClick={() => { setFullScreenImage(null); setFullScreenGallery([]); }}>
                                    <X size={32} />
                                </button>

                                {fullScreenGallery.length > 1 && (
                                    <>
                                        <button className="gallery-nav-btn prev" onClick={(e) => { e.stopPropagation(); handlePrevImage(); }}>
                                            <ChevronLeft size={48} />
                                        </button>
                                        <button className="gallery-nav-btn next" onClick={(e) => { e.stopPropagation(); handleNextImage(); }}>
                                            <ChevronRight size={48} />
                                        </button>
                                        <div className="gallery-index-indicator">
                                            {fullScreenIndex + 1} / {fullScreenGallery.length}
                                        </div>
                                    </>
                                )}

                                {isPdfSource(fullScreenImage) ? (
                                    <iframe src={fullScreenImage} style={{ width: '100%', height: '100%', border: 'none', background: 'white' }} title="PDF Preview"></iframe>
                                ) : (
                                    <img
                                        src={fullScreenImage.startsWith('data:') || fullScreenImage.startsWith('http') ? fullScreenImage : (fullScreenImage.startsWith('/uploads') ? `${API_URL}${fullScreenImage}` : `${API_URL}/uploads/resources/${fullScreenImage}`)}
                                        alt="Full Screen"
                                    />
                                )}
                            </div>
                        </div>
                    )
                }


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
                {
                    showDashboardUploadModal && (
                        <div className="modal-overlay" onClick={() => setShowDashboardUploadModal(false)}>
                            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                                <div className="modal-header">
                                    <h2>Upload Dashboard Resource</h2>
                                    <button className="close-btn" onClick={() => setShowDashboardUploadModal(false)}>
                                        <X size={20} />
                                    </button>
                                </div>
                                <div className="modal-body">
                                    <div className="form-group">
                                        <label>Resource Name</label>
                                        <input
                                            type="text"
                                            value={dashboardUploadForm.name}
                                            onChange={(e) => setDashboardUploadForm({ ...dashboardUploadForm, name: e.target.value })}
                                            placeholder="Enter resource name"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Type</label>
                                        <select
                                            value={dashboardUploadForm.type}
                                            onChange={(e) => setDashboardUploadForm({ ...dashboardUploadForm, type: e.target.value })}
                                            className="form-select"
                                        >
                                            <option value="file">File</option>
                                            <option value="link">Link</option>
                                        </select>
                                    </div>
                                    {dashboardUploadForm.type === 'link' ? (
                                        <div className="form-group">
                                            <label>URL</label>
                                            <input
                                                type="url"
                                                value={dashboardUploadForm.content || ''}
                                                onChange={(e) => setDashboardUploadForm({ ...dashboardUploadForm, content: e.target.value })}
                                                placeholder="https://example.com"
                                            />
                                        </div>
                                    ) : (
                                        <div className="form-group">
                                            <label>File</label>
                                            <input
                                                type="file"
                                                onChange={(e) => setDashboardUploadForm({ ...dashboardUploadForm, file: e.target.files[0] })}
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className="modal-footer">
                                    <button className="btn-secondary" onClick={() => setShowDashboardUploadModal(false)}>Cancel</button>
                                    <button className="btn-primary" onClick={handleDashboardUpload}>Upload</button>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Add Folder Modal */}
                {
                    showAddFolderModal && (
                        <div className="modal-overlay" onClick={() => setShowAddFolderModal(false)}>
                            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                                <div className="modal-header">
                                    <h2>Create New Folder</h2>
                                    <button className="close-btn" onClick={() => setShowAddFolderModal(false)}>
                                        <X size={20} />
                                    </button>
                                </div>
                                <div className="modal-body">
                                    <div className="form-group">
                                        <label>Folder Name</label>
                                        <input
                                            type="text"
                                            value={folderName}
                                            onChange={(e) => setFolderName(e.target.value)}
                                            placeholder="Enter folder name"
                                            autoFocus
                                        />
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button className="btn-secondary" onClick={() => setShowAddFolderModal(false)}>Cancel</button>
                                    <button className="btn-primary" onClick={() => { handleCreateFolder(); setShowAddFolderModal(false); }}>Create</button>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Custom Delete Confirmation Modal */}
                {
                    deleteConfirmation.isOpen && (
                        <div className="delete-confirmation-overlay" onClick={cancelDelete}>
                            <div className="delete-confirmation-modal" onClick={(e) => e.stopPropagation()}>
                                <div className="delete-modal-icon">
                                    <Trash2 size={48} color="#ef4444" />
                                </div>
                                <h3>Confirm Deletion</h3>
                                <p>{deleteConfirmation.message}</p>
                                <div className="delete-modal-actions">
                                    <button
                                        className="btn-cancel"
                                        onClick={cancelDelete}
                                        disabled={deleteConfirmation.isDeleting}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="btn-delete"
                                        onClick={confirmDelete}
                                        disabled={deleteConfirmation.isDeleting}
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}
                                    >
                                        {deleteConfirmation.isDeleting ? (
                                            <>
                                                <Loader size={16} className="animate-spin" />
                                                Deleting...
                                            </>
                                        ) : (
                                            'Delete'
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Check-In Detail/Edit Modal (src/features/checkin) */}
                <CheckInDetailModal log={checkInLog} locations={locations} currentUser={currentUser} />
            </div >
        </div >
    );
};

export default SalesPage;
