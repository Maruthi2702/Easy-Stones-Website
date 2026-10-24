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
import { formatDate } from '../utils/dateUtils';
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
import { useVisitEditor } from '../features/visits';
import { useResourceEditor } from '../features/resources';
import { CustomerProfile, ContactModal, LinkPartnerModal, useCustomerActions, useOpenCustomer, getCustomerLevelLabel } from '../features/customers';
import ImageGallery from '../components/shared/ImageGallery';
import { useImageGallery } from '../components/shared/useImageGallery';
import DeleteConfirmModal from '../components/shared/DeleteConfirmModal';
import { useDeleteCheck, makeConfirmDelete } from '../features/salesShell/deleteCheck';
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
    const dashboardData = useDashboardData({ currentUser, locations, customers, currentUserId, customerRefreshTrigger, resourceRefreshTrigger });
    const {
        activeDashboardTab, setActiveDashboardTab, activeResourceSubTab, fetchDashboardStats, fetchDashboardData, fetchSchedules,
        canAddVisits, setCurrentVisitsPage, setCurrentFollowUpPage, setCurrentResourcesPage, patchDashboardVisit, removeDashboardVisit
    } = dashboardData;
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

    const {
        selectedCustomerDetail, setSelectedCustomerDetail, visitsLoading, setVisitsLoading, customerCacheRef, fetchSingleCustomer,
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



    









    






    const renderCheckInLogView = () => (
        <CheckInLogTab
            log={checkInLog}
            locations={locations}
            sidebarToggle={(!isSidebarOpen || isMobile) ? <SidebarToggleButton isOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(true)} /> : null}
            fallback={<TabLoader />}
        />
    );

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
