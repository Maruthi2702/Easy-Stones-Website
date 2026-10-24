import { useEffect, useState } from 'react';
import { navItem, pinnedDefaultTab } from '../../utils/navPins';
import { CHECKIN_PERMISSIONS } from '../../utils/checkInAccess';
import { canOpenUsersPage } from '../../utils/teamAccess';
import { canOpenArea } from '../../utils/usersAccess';
import type { Loose } from '../../types/records';

export type SalesNavigationDeps = {
    currentUser: Loose | null;
    /** The side nav's pins; the first one they can open is their default page. */
    pinnedTabsRef: { current: unknown };
    /** The drawer layout (≤1024px): picking somewhere closes the drawer. */
    isMobile: boolean;
    setIsSidebarOpen: (open: boolean) => void;
    /** Show a customer being opened at once — its cached copy, or the row it came from (useOpenCustomer). */
    onShowCustomer: (customer: Loose) => void;
    /** Forget the open customer's record (useOpenCustomer). */
    onClearCustomer: () => void;
    /** Dashboard → back to its Sales Visits tab (the Home button). */
    onGoHomeTab: () => void;
};

/**
 * Where the Sales page is (MIGRATION_NOTES.md §4, step A7): the page showing
 * (`crmTab`, and `showDashboard`), the open customer and their profile tab,
 * where Back returns to, and the URL (`?tab=&customer=&view=`) — kept in step
 * both ways, including the browser's back button. Moved out of SalesPage
 * unchanged (2026-10-24).
 */
export function useSalesNavigation({ currentUser, pinnedTabsRef, isMobile, setIsSidebarOpen, onShowCustomer, onClearCustomer, onGoHomeTab }: SalesNavigationDeps) {
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [customerOriginTab, setCustomerOriginTab] = useState<string | null>(null);
    // Latches on the first visit to the route planner and never clears, so the
    // map it builds survives navigating away and back. See where it renders.
    const [routePlannerOpened, setRoutePlannerOpened] = useState(false);
    const [activeTab, setActiveTab] = useState('visits');

    const getDefaultTab = () => {
        const searchParams = new URLSearchParams(window.location.search);
        const tabParam = searchParams.get('tab');
        if (tabParam) return tabParam;

        const pinned = currentUser ? pinnedDefaultTab(currentUser, pinnedTabsRef.current as never) : null;
        if (pinned) return pinned;

        const perms: string[] = currentUser?.permissions || [];
        if (perms.includes('view_dashboard')) return 'dashboard';
        if (perms.includes(CHECKIN_PERMISSIONS.VIEW_LOG)) return 'checkin';
        if (perms.includes('view_pricelist')) return 'pricelist';
        if (perms.includes('view_customers')) return 'customers';
        if (perms.includes('view_lost_sales')) return 'lost_sales';
        if (perms.includes('view_crossover_sheet')) return 'crossover_sheet';
        if (perms.includes('view_delivery_schedule')) return 'delivery_schedule';
        return 'checkin'; // safe fallback
    };
    const [crmTab, setCrmTab] = useState<string>(getDefaultTab); // 'dashboard', 'customers', 'checkin', 'pricelist', 'delivery_schedule'
    const [showDashboard, setShowDashboard] = useState(true);

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

    const handleCrmTabChange = (tabName: string) => {
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
        onClearCustomer();
        if (tabName === 'dashboard') {
            setShowDashboard(true);
        } else {
            setShowDashboard(false);
        }
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('tab', tabName);
        newUrl.searchParams.delete('customer');
        newUrl.searchParams.delete('view');
        newUrl.searchParams.delete('hold');
        window.history.pushState({ tab: tabName }, '', newUrl);

        if (isMobile) {
            setIsSidebarOpen(false);
        }
    };

    const handleGoHome = () => {
        setSelectedCustomerId(null);
        onClearCustomer();
        handleCrmTabChange('dashboard');
        onGoHomeTab();
        if (isMobile) {
            setIsSidebarOpen(false);
        }
    };

    const handleActiveTabChange = (tabName: string) => {
        setActiveTab(tabName);
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('view', tabName);
        window.history.replaceState({}, '', newUrl);
    };

    useEffect(() => {
        const handlePopState = () => {
            const params = new URLSearchParams(window.location.search);
            const tabParam = params.get('tab');
            const customerId = params.get('customer');
            const viewParam = params.get('view');

            const perms: string[] = currentUser?.permissions || [];
            const tabPermMap: Record<string, string> = {
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
                    onClearCustomer();
                    setCustomerOriginTab(null);
                }
            } else {
                setSelectedCustomerId(null);
                onClearCustomer();
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
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the user changes, as before
    }, [currentUser]);

    useEffect(() => {
        if (crmTab === 'route_planner') setRoutePlannerOpened(true);
    }, [crmTab]);

    const handleSelectCustomer = (customer: Loose | null | undefined, explicitOrigin?: string) => {
        if (customer) {
            // Track origin tab from which customer was opened
            const currentTab = crmTab;
            const origin = customerOriginTab || explicitOrigin || (currentTab !== 'customers' ? currentTab : 'customers');
            setCustomerOriginTab(origin);

            onShowCustomer(customer);
            setSelectedCustomerId(customer._id);

            const newUrl = new URL(window.location.href);
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
        onClearCustomer();
        setCustomerOriginTab(null);

        const newUrl = new URL(window.location.href);
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

    return {
        crmTab, showDashboard, setShowDashboard, selectedCustomerId, activeTab, routePlannerOpened, setRoutePlannerOpened,
        handleCrmTabChange, handleGoHome, handleActiveTabChange, handleSelectCustomer, handleBackToCustomersList
    };
}

/** What the hook returns. */
export type SalesNavigation = ReturnType<typeof useSalesNavigation>;
