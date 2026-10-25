import { Suspense } from 'react';
import type { ComponentType } from 'react';
import ErrorBoundary from '../../components/shared/ErrorBoundary';
import SidebarToggleButton from '../../components/shared/SidebarToggleButton';
import UserProfileTab from '../../components/sales/UserProfileTab';
import { CheckInLogTab } from '../checkin';
import type { CheckInLog } from '../checkin';
import { lazyRetry } from '../../utils/lazyRetry';
import { canViewCheckInLog } from '../../utils/checkInAccess';
import { canOpenUsersPage } from '../../utils/teamAccess';
import { canOpenArea, can, NAV_ORDER } from '../../utils/usersAccess';
import { PERMITS } from '../../permits/permissions';
import type { Loose } from '../../types/records';
import TabLoader from './TabLoader';

// The pages are still JavaScript, and TypeScript reads their `= null` / `= []`
// defaults as the only values allowed; until each moves into src/features (step B)
// and is typed, they're taken as taking any props.
type JsPage = ComponentType<Loose>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
const page = (load: () => Promise<{ default: ComponentType<any> }>) => lazyRetry(load) as unknown as JsPage;

// Each page loads only once its own tab is opened (the same lazyRetry pattern
// src/App.jsx uses per route): before, every tab — Route Planner's Google Maps
// code, Users & Roles, Price List — was in one bundle loaded for any tab.
const RoutePlannerV2 = page(() => import('../routePlanner/RoutePlannerV2'));
const PriceListPanel = page(() => import('../../components/sales/PriceListPanel'));
const UsersRolesTab = page(() => import('../../components/sales/UsersRolesTab'));
const NavOrderTab = page(() => import('../../components/sales/NavOrderTab'));
const LostSalesTab = page(() => import('../../components/sales/LostSalesTab'));
const CrossoverSheetTab = page(() => import('../../components/sales/CrossoverSheetTab'));
const InventoryAnalysisTab = page(() => import('../../components/sales/InventoryAnalysisTab'));
const DeliveryScheduleTab = page(() => import('../delivery/DeliveryScheduleTab'));
const DailyReportTab = page(() => import('../dailyReport/DailyReportTab'));
const FreightTab = page(() => import('../../components/sales/freight/FreightTab'));
const HoldsTab = page(() => import('../../components/sales/holds/HoldsTab'));
const PermitsTab = page(() => import('../../components/sales/permits/PermitsTab'));

export type SalesTabViewsProps = {
    /** Signed in with permissions loaded (`!authLoading && currentUser?.permissions`). */
    ready: boolean;
    /** The page showing (the side nav's key). */
    crmTab: string;
    currentUser: Loose | null;
    theme: string;
    /** The side nav is open / the drawer layout is on (≤1024px). */
    isSidebarOpen: boolean;
    isMobile: boolean;
    /** Most pages' menu button opens the nav; some toggle it (kept as they were). */
    onOpenSidebar: () => void;
    onToggleSidebar: () => void;
    checkInLog: CheckInLog;
    locations: Loose[];
    fetchLocations: () => void;
    /** The shared customer list, or the page's own first page until it loads. */
    customersList: Loose[];
    customerOptions: Loose[];
    isDropdownLoading: boolean;
    inventoryRefreshSignal: number;
    navOrder: unknown;
    onSaveNavOrder: (order: unknown) => unknown;
    canSeeHolds: boolean;
    /** Route Planner: mounted on its first visit and kept (hidden) after. */
    routePlannerOpened: boolean;
    routePreselect: unknown;
    canAddVisits: boolean;
    onGoHome: () => void;
    /** A page opened a customer; `origin` is where Back returns to. */
    onOpenCustomer: (customerId: string, origin: string) => void;
    /** "New customer" in a dropdown; undefined when they may not add one. */
    onCreateCustomer?: () => void;
    /** Permits → a contractor's "Create customer", pre-filled. */
    onCreatePrefilledCustomer: ((values: Loose) => void) | null;
    onAddVisitForPin: (pin: Loose | null) => void;
    onAddResourceForPin: (pin: Loose | null) => void;
};

/**
 * Every Sales page other than the Dashboard and Customers, each behind its
 * permission and its own ErrorBoundary (MIGRATION_NOTES.md §4, step A7). Moved
 * out of SalesPage unchanged (2026-10-24): same order, keys and props.
 */
export default function SalesTabViews(p: SalesTabViewsProps) {
    const { crmTab, currentUser, theme, isSidebarOpen, isMobile, locations } = p;
    const { ready } = p;
    const perms: string[] = currentUser?.permissions || [];
    const showToggle = !isSidebarOpen || isMobile;
    // The menu button that opens the side nav, or (`toggle`) flips it.
    const menu = (toggle = false) => (showToggle
        ? <SidebarToggleButton isOpen={isSidebarOpen} onClick={toggle ? p.onToggleSidebar : p.onOpenSidebar} />
        : null);

    return (
        <>
            {ready && crmTab === 'checkin' && canViewCheckInLog(currentUser) && (
                <ErrorBoundary key="checkin-log-view">
                    <CheckInLogTab log={p.checkInLog} locations={locations} sidebarToggle={menu()} fallback={<TabLoader />} />
                </ErrorBoundary>
            )}

            {ready && crmTab === 'pricelist' && perms.includes('view_pricelist') && (
                <ErrorBoundary key="price-list-view">
                    <Suspense fallback={<TabLoader />}>
                        <PriceListPanel sidebarToggle={menu()} />
                    </Suspense>
                </ErrorBoundary>
            )}

            {ready && ['users', 'roles', 'locations'].includes(crmTab)
                && (crmTab === 'users' ? canOpenUsersPage(currentUser) : canOpenArea(currentUser, crmTab)) && (
                <ErrorBoundary key={`users-roles-view-${crmTab}`}>
                    <Suspense fallback={<TabLoader />}>
                        <UsersRolesTab section={crmTab} sidebarToggle={menu()} locations={locations} fetchLocations={p.fetchLocations} />
                    </Suspense>
                </ErrorBoundary>
            )}

            {ready && crmTab === 'nav_order' && can(currentUser, NAV_ORDER) && (
                <ErrorBoundary key="nav-order-view">
                    <Suspense fallback={<TabLoader />}>
                        <NavOrderTab order={p.navOrder} onSave={p.onSaveNavOrder} sidebarToggle={menu()} />
                    </Suspense>
                </ErrorBoundary>
            )}

            {ready && crmTab === 'profile' && (
                <ErrorBoundary key="user-profile-view">
                    <UserProfileTab sidebarToggle={menu()} theme={theme} />
                </ErrorBoundary>
            )}

            {ready && crmTab === 'lost_sales' && (
                <ErrorBoundary key="lost-sales-view">
                    <Suspense fallback={<TabLoader />}>
                        <LostSalesTab
                            currentUser={currentUser}
                            customersList={p.customersList}
                            customerOptions={p.customerOptions}
                            locationsList={locations || ['Seattle', 'Spokane', 'Salt Lake City']}
                            theme={theme}
                            onCreateNew={p.onCreateCustomer}
                            isDropdownLoading={p.isDropdownLoading}
                            sidebarToggle={menu(true)}
                        />
                    </Suspense>
                </ErrorBoundary>
            )}

            {ready && crmTab === 'crossover_sheet' && (
                <ErrorBoundary key="crossover-sheet-view">
                    <Suspense fallback={<TabLoader />}>
                        <CrossoverSheetTab currentUser={currentUser} sidebarToggle={menu(true)} />
                    </Suspense>
                </ErrorBoundary>
            )}

            {ready && crmTab === 'inventory_analysis' && (
                <ErrorBoundary key="inventory-analysis-view">
                    <Suspense fallback={<TabLoader />}>
                        <InventoryAnalysisTab currentUser={currentUser} sidebarToggle={menu(true)} refreshSignal={p.inventoryRefreshSignal} />
                    </Suspense>
                </ErrorBoundary>
            )}

            {ready && crmTab === 'daily_report' && (
                <ErrorBoundary key="daily-report-view">
                    <Suspense fallback={<TabLoader />}>
                        <DailyReportTab currentUser={currentUser} sidebarToggle={menu(true)} />
                    </Suspense>
                </ErrorBoundary>
            )}

            {ready && crmTab === 'freight' && perms.includes('view_freight_charges') && (
                <ErrorBoundary key="freight-view">
                    <Suspense fallback={<TabLoader />}>
                        <FreightTab currentUser={currentUser} locationsList={locations || []} sidebarToggle={menu(true)} />
                    </Suspense>
                </ErrorBoundary>
            )}

            {ready && crmTab === 'holds' && p.canSeeHolds && (
                <ErrorBoundary key="holds-view">
                    <Suspense fallback={<TabLoader />}>
                        <HoldsTab currentUser={currentUser} sidebarToggle={menu(true)} />
                    </Suspense>
                </ErrorBoundary>
            )}

            {ready && crmTab === 'permits' && perms.includes(PERMITS.VIEW) && (
                <ErrorBoundary key="permits-view">
                    <Suspense fallback={<TabLoader />}>
                        <PermitsTab
                            sidebarToggle={menu(true)}
                            onOpenCustomer={(id: string) => p.onOpenCustomer(id, 'permits')}
                            onCreateCustomer={p.onCreatePrefilledCustomer}
                        />
                    </Suspense>
                </ErrorBoundary>
            )}

            {ready && crmTab === 'delivery_schedule' && (
                <ErrorBoundary key="delivery-schedule-view">
                    <Suspense fallback={<TabLoader />}>
                        <DeliveryScheduleTab
                            currentUser={currentUser}
                            locationsList={locations || ['Seattle', 'Spokane', 'Salt Lake City']}
                            customerOptions={p.customerOptions}
                            theme={theme}
                            sidebarToggle={menu(true)}
                        />
                    </Suspense>
                </ErrorBoundary>
            )}

            {/* Kept mounted once opened, and hidden rather than unmounted when
                you navigate away. Google bills a map load per map instance
                created, so unmounting would buy a fresh one every time you came
                back. Nothing runs while it is hidden — the fetch and the
                geolocation both happen on mount. */}
            {ready && p.routePlannerOpened && perms.includes('view_route_planner') && (
                <div style={{ position: 'relative', display: crmTab === 'route_planner' ? 'block' : 'none' }}>
                    <ErrorBoundary key="route-planner-v2-view">
                        <Suspense fallback={<TabLoader />}>
                            <RoutePlannerV2
                                currentUser={currentUser}
                                theme={theme}
                                isActive={crmTab === 'route_planner'}
                                preselect={p.routePreselect}
                                onOpenCustomer={(id: string) => p.onOpenCustomer(id, 'route_planner')}
                                onAddVisit={p.canAddVisits ? p.onAddVisitForPin : null}
                                onAddResource={p.canAddVisits ? p.onAddResourceForPin : null}
                                sidebarToggle={menu(true)}
                            />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            )}
        </>
    );
}
