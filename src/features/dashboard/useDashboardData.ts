import React, { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { formatDate, formatInstant, getLocalISOString } from '../../utils/dateUtils';
import { DEFAULT_ROWS_PER_PAGE } from '../../components/shared/paginationConfig';
import { useLocationFilter } from '../../components/shared/useLocationFilter';
import { splitCustomer } from '../../components/sales/visitsListHelpers';
import { canAddVisit, visitViewScope } from '../../utils/visitAccess.js';
import type { Loose } from '../../types/records';

/**
 * The Sales dashboard's data (MIGRATION_NOTES.md §4, step A6): the time
 * range, branch filter and search; the tiles' counts; the Sales Visits,
 * Resources and Follow-up lists and their pages; the calendar's schedule; and
 * the Excel exports. Moved out of SalesPage unchanged — the page reads every
 * value under the name it always had. `patchDashboardVisit` /
 * `removeDashboardVisit` let a visit saved anywhere show here at once.
 */
export type DashboardDeps = {
    currentUser: Loose | null;
    locations: unknown[];
    /** The Customers tab's first page — names for planner rows. */
    customers: Loose[];
    currentUserId: string | null;
    /** Bumped when customers or resources change (socket), to refetch. */
    customerRefreshTrigger: number;
    resourceRefreshTrigger: number;
};

export function useDashboardData({ currentUser, locations, customers, currentUserId, customerRefreshTrigger, resourceRefreshTrigger }: DashboardDeps) {
        // Dashboard State (Required for memoized values)
    const [dashboardTimeRange, setDashboardTimeRange] = useState('1day');
    // The Sales dashboard's location filter: Visits, Follow-ups, Resources and
    // the tiles above them all follow it ('' = every branch the viewer may
    // see). Offered from the viewer's Visits permissions (visitViewScope in
    // src/utils/visitAccess.js): every branch with view_all_visits, their
    // assigned ones with view_branch_visits (all, if assigned '*'), none for
    // anyone who only sees their own visits. The server enforces the same
    // limits (narrowScopeToLocation). Opens on their home location.
    const dashboardLocationOptions = React.useMemo(() => {
        const all = (locations || []).map(l => (typeof l === 'string' ? l : (l as Loose)?.name)).filter(Boolean);
        const scope = visitViewScope(currentUser);
        if (scope.kind === 'all') return all;
        if (scope.kind === 'branches') return scope.locations;
        return [];
    }, [locations, currentUser]);
    const [dashboardLocation, setDashboardLocation] = useLocationFilter('salesDashboard', currentUser, dashboardLocationOptions);
    const dashboardLocationParam = dashboardLocation ? `&location=${encodeURIComponent(dashboardLocation)}` : '';
    const [dashboardSearchTerm, setDashboardSearchTerm] = useState('');

    const [activeDashboardTab, setActiveDashboardTab] = useState('visits'); // 'visits' or 'resources'
    const [followupFilter, setFollowupFilter] = useState<'all' | 'nextWeek'>('all');
    const [todayScheduleCount, setTodayScheduleCount] = useState(0);
    const [stats, setStats] = useState<Loose>({ visits: 0, keyVisits: 0, bids: 0, followUp: 0, resources: 0 });
    const [statsLoading, setStatsLoading] = useState(true);
    const [dashboardVisits, setDashboardVisits] = useState<Loose[]>([]);
    const [dashboardResources, setDashboardResources] = React.useState<Loose[]>([]);
    const [dashboardFollowups, setDashboardFollowups] = React.useState<Loose[]>([]);
    // The Visits tab's Follow-ups panel: the few rows the server picked (own request, so it never holds the table up).
    const [followUpPanel, setFollowUpPanel] = React.useState<Loose[]>([]);
    const followUpPanelReqRef = React.useRef(0);
    const [dashboardDataLoading, setDashboardDataLoading] = React.useState(false);
    // False until the first fetchDashboardData finishes. dashboardDataLoading
    // starts false (other logic keys off it), so on its own the tables showed
    // "No data available" between the workspace spinner going away and the
    // first response landing — which read as an empty dashboard.
    const [dashboardLoaded, setDashboardLoaded] = React.useState(false);
    const [allSchedules, setAllSchedules] = useState<Loose[]>([]);
    const [activeResourceSubTab, setActiveResourceSubTab] = useState('client'); // 'client' or 'team'

    // Fetch Dashboard Stats from Backend — merged into one effect with fetchDashboardData below
    // Each dashboard fetch is numbered and only the latest may write its
    // result. Without this, a slow earlier request (the unfiltered "All" range
    // takes ~1s) could land after a quick later one (a location filter that
    // matches nothing) and overwrite it — the filter "not working".
    const dashboardStatsReqRef = React.useRef(0);
    const dashboardDataReqRef = React.useRef(0);

    const fetchDashboardStats = useCallback(async () => {
        const reqId = ++dashboardStatsReqRef.current;
        setStatsLoading(true);
        try {
            const localDate = new Date().toLocaleDateString('en-CA');
            const response = await authFetch(`${API_URL}/api/dashboard/stats?timeRange=${dashboardTimeRange}&localDate=${localDate}${dashboardLocationParam}`);
            if (response.ok) {
                const data = await response.json();
                if (reqId === dashboardStatsReqRef.current) setStats(data);
            }
        } catch (error) {
            console.error('Error fetching dashboard stats:', error);
        } finally {
            if (reqId === dashboardStatsReqRef.current) setStatsLoading(false);
        }
    }, [dashboardTimeRange, dashboardLocationParam]);

    const fetchFollowUpPanel = useCallback(async () => {
        const reqId = ++followUpPanelReqRef.current;
        try {
            const localDateStr = new Date().toLocaleDateString('en-CA');
            const res = await authFetch(`${API_URL}/api/dashboard/followups/panel?timeRange=${dashboardTimeRange}&localDate=${localDateStr}${dashboardLocationParam}`);
            if (!res.ok) return;
            const rows = await res.json();
            if (reqId === followUpPanelReqRef.current) setFollowUpPanel(Array.isArray(rows) ? rows : []);
        } catch (error) {
            console.error('Error fetching follow-up panel:', error);
        }
    }, [dashboardTimeRange, dashboardLocationParam]);

    // Fetch Independent Dashboard Data
    const fetchDashboardData = useCallback(async () => {
        const reqId = ++dashboardDataReqRef.current;
        setDashboardDataLoading(true);
        fetchFollowUpPanel(); // not awaited: the table doesn't wait for the panel
        try {
            const localDateStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
            const [visitsRes, resourcesRes, followupsRes] = await Promise.all([
                authFetch(`${API_URL}/api/dashboard/visits?timeRange=${dashboardTimeRange}&localDate=${localDateStr}${dashboardLocationParam}`),
                authFetch(`${API_URL}/api/dashboard/resources?timeRange=${dashboardTimeRange}&localDate=${localDateStr}${dashboardLocationParam}`),
                authFetch(`${API_URL}/api/dashboard/visits?timeRange=${dashboardTimeRange}&localDate=${localDateStr}&filterType=followup${dashboardLocationParam}`)
            ]);
            const visits = await visitsRes.json();
            const resources = await resourcesRes.json();
            const followups = await followupsRes.json();
            if (reqId !== dashboardDataReqRef.current) return; // superseded — see dashboardDataReqRef

            setDashboardVisits(Array.isArray(visits) ? visits : []);
            setDashboardResources(Array.isArray(resources) ? resources : []);
            setDashboardFollowups(Array.isArray(followups) ? followups : []);
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            if (reqId === dashboardDataReqRef.current) {
                setDashboardDataLoading(false);
                setDashboardLoaded(true);
            }
        }
    }, [dashboardTimeRange, dashboardLocationParam, fetchFollowUpPanel]);

    // A dashboard table with no rows yet while its data is still on the way
    // says so, instead of claiming there's nothing there.
    const dashboardTableLoading = dashboardDataLoading || !dashboardLoaded;

    // Single effect: fire BOTH dashboard fetches in parallel when dashboardTimeRange or refresh triggers change
    useEffect(() => {
        Promise.all([fetchDashboardStats(), fetchDashboardData()]);
    }, [fetchDashboardStats, fetchDashboardData, customerRefreshTrigger, resourceRefreshTrigger]);

    // Fetch schedules for the dashboard
    const fetchSchedules = useCallback(async () => {
        try {
            // Fetch a broad range of schedules for the dashboard (e.g., +/- 1 month)
            const now = new Date();
            const start = new Date(now);
            start.setMonth(now.getMonth() - 1);
            const end = new Date(now);
            end.setMonth(now.getMonth() + 1);

            // Use getLocalISOString to avoid UTC conversion logic
            const response = await authFetch(`${API_URL}/api/schedule?start=${getLocalISOString(start)}&end=${getLocalISOString(end)}`);
            if (response.ok) {
                const data = await response.json();
                setAllSchedules(data);

                // Update today's count from the fetched data
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const todayEnd = new Date();
                todayEnd.setHours(23, 59, 59, 999);

                const todayCount = data.filter((s: Loose) => {
                    const d = new Date(s.startTime);
                    return d >= todayStart && d <= todayEnd;
                }).length;
                setTodayScheduleCount(todayCount);
            }
        } catch (error) {
            console.error('Error fetching schedules:', error);
        }
    }, []);

    useEffect(() => {
        fetchSchedules();
    }, [fetchSchedules]);

    const dashboardDateRangeStart = React.useMemo(() => {
        // If we are using the dedicated dashboardVisits/dashboardResources from the backend,
        // we should trust the backend's date filtering. 
        // We only use this local start date if we fallback to the allVisits/allResources lists.
        if (dashboardVisits.length > 0 || dashboardResources.length > 0) return null;

        const now = new Date();

        let start;
        switch (dashboardTimeRange) {
            case '1day':
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
                break;
            case '7days':
                start = new Date();
                start.setDate(now.getDate() - 7);
                start.setHours(0, 0, 0, 0);
                break;
            case '30days':
                start = new Date();
                start.setDate(now.getDate() - 30);
                start.setHours(0, 0, 0, 0);
                break;
            case 'year':
                start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
                break;
            case 'all':
                return null;
            default:
                start = null;
        }
        return start;
    }, [dashboardTimeRange]);


    // Whether the viewer may see other people's visits and resources at all.
    const seesOthers = React.useMemo(() => visitViewScope(currentUser).kind !== 'own', [currentUser]);
    // Whether to offer Add Visit / Add Resource anywhere (Users & Roles → Visits → Add).
    const canAddVisits = canAddVisit(currentUser);

    const memoizedFilteredVisits = React.useMemo(() => {
        const startDate = dashboardDateRangeStart;
        const searchLower = dashboardSearchTerm.toLowerCase();
        const currentUserIdStr = currentUserId?.toString();

        // Always the server's list, which is already scoped to who may see what
        // (dashboardScope in src/utils/dashboardMatch.js: a manager only their
        // branches). The "All" range used to read allVisits instead — built from
        // the Customers tab's current page, unscoped and only one page deep.
        const sourceVisits = dashboardVisits;

        const filtered = sourceVisits.filter(v => {
            if (!v) return false;

            // If using dashboardVisits, backend already filtered by date.
            // Only apply dateMatch if we fell back to allVisits.
            const isFromBackend = sourceVisits === dashboardVisits;

            // Use a robust date parser for comparison/sort
            const parseDate = (d: unknown, ca: unknown): Date => {
                if (!d && !ca) return new Date(0);
                const dateStr = d || ca;
                if (typeof dateStr !== 'string') return new Date((dateStr as number) || 0);

                if (dateStr.includes('/')) {
                    const [m, day, y] = dateStr.split('/');
                    return new Date(Number(y), Number(m) - 1, Number(day));
                }
                return new Date(dateStr);
            };

            const visitDate = parseDate(v.date, v.createdAt);
            const dateMatch = isFromBackend || !startDate || visitDate >= startDate;

            // Anyone allowed to see others' visits gets what the server sent.
            const userMatch = seesOthers || v.createdBy?.toString() === currentUserIdStr || v.creatorId?.toString() === currentUserIdStr;

            const searchMatch = !dashboardSearchTerm ||
                (v.customerName?.toLowerCase().includes(searchLower)) ||
                (v.notes?.toLowerCase().includes(searchLower)) ||
                (v.purpose?.toLowerCase().includes(searchLower));



            // Exclude system entries from visits tab
            const systemEntryExclude = true;

            return dateMatch && userMatch && searchMatch && systemEntryExclude;
        });

        const parseSortDate = (v: Loose): number => {
            if (!v.date && !v.createdAt) return 0;
            const ds = v.date || v.createdAt;
            if (typeof ds !== 'string') return new Date(ds).getTime();
            if (ds.includes('/')) {
                const [m, d, y] = ds.split('/');
                return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
            }
            return new Date(ds).getTime();
        };

        return [...filtered].sort((a, b) => parseSortDate(b) - parseSortDate(a));
    }, [dashboardVisits, dashboardDateRangeStart, seesOthers, currentUserId, dashboardSearchTerm]);

    const memoizedFilteredResources = React.useMemo(() => {
        const startDate = dashboardDateRangeStart;
        const searchLower = dashboardSearchTerm.toLowerCase();
        const currentUserIdStr = currentUserId?.toString();

        // Always the server's list, scoped like the visits above; falling back to
        // allResources (the Customers tab's page) bypassed that scope.
        const sourceResources = dashboardResources;

        const filtered = sourceResources.filter(r => {
            if (!r) return false;

            // If using dashboardResources, backend already filtered by date.
            const isFromBackend = sourceResources === dashboardResources;
            const resourceDate = new Date(r.date || r.createdAt);
            const dateMatch = isFromBackend || !startDate || resourceDate >= startDate;

            // Anyone allowed to see others' resources gets what the server sent.
            const userMatch = seesOthers || (
                r.uploadedBy?.toString() === currentUserIdStr ||
                r.createdBy?.toString() === currentUserIdStr ||
                r.uploaderId?.toString() === currentUserIdStr
            );

            const searchMatch = !dashboardSearchTerm ||
                (r.customerName?.toLowerCase().includes(searchLower)) ||
                (r.description?.toLowerCase().includes(searchLower)) ||
                (r.resourceType?.toLowerCase().includes(searchLower)) ||
                (r.notes?.toLowerCase().includes(searchLower));

            return dateMatch && userMatch && searchMatch;
        });

        const parseSortDate = (r: Loose): number => {
            if (!r.date && !r.createdAt) return 0;
            const ds = r.date || r.createdAt;
            if (typeof ds !== 'string') return new Date(ds).getTime();
            if (ds.includes('/')) {
                const [m, d, y] = ds.split('/');
                return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
            }
            return new Date(ds).getTime();
        };

        return [...filtered].sort((a, b) => parseSortDate(b) - parseSortDate(a));
    }, [dashboardResources, dashboardDateRangeStart, seesOthers, currentUserId, dashboardSearchTerm]);

    const memoizedFollowups = React.useMemo(() => {
        let followups: Loose[] = [];
        if (followupFilter === 'all') {
            const searchLower = dashboardSearchTerm.toLowerCase();
            // Select the source: strictly dashboardFollowups for specific ranges to avoid leaking historical data
            const source = (dashboardTimeRange === 'all')
                ? (dashboardFollowups.length > 0 ? dashboardFollowups : memoizedFilteredVisits)
                : dashboardFollowups;

            followups = source
                .filter(v => v && (v.nextAction || v.followUp || v.followUpDate))
                .filter(v => !dashboardSearchTerm ||
                    v.customerName?.toLowerCase().includes(searchLower) ||
                    v.notes?.toLowerCase().includes(searchLower) ||
                    v.followUp?.toLowerCase().includes(searchLower)
                )
                .map(v => ({
                    ...v,
                    displayDate: v.followUpDate || v.date,
                    displayNote: v.followUp || v.nextAction,
                    source: 'Visit'
                }));
        } else if (followupFilter === 'nextWeek') {
            const now = new Date();
            const startOfNextWeek = new Date(now);
            startOfNextWeek.setDate(now.getDate() + (8 - now.getDay()) % 7 || 7);
            startOfNextWeek.setHours(0, 0, 0, 0);
            const endOfNextWeek = new Date(startOfNextWeek);
            endOfNextWeek.setDate(startOfNextWeek.getDate() + 6);
            endOfNextWeek.setHours(23, 59, 59, 999);

            // Respect dashboard filter: only look at all items if 'all' is selected. Otherwise only use backend data.
            const sourceVisits = (dashboardTimeRange === 'all')
                ? (dashboardFollowups.length > 0 ? dashboardFollowups : memoizedFilteredVisits)
                : dashboardFollowups;

            // Note: Schedules are NOT filtered by the dashboard time range currently, they are always "All".
            // If the user expects schedules to be filtered, that requires a backend change to /api/schedules.
            // For now, we keep schedules global but strictly enforce the dashboard filter for visits.
            const nextWeekSchedules = allSchedules.filter(s => {
                const d = new Date(s.startTime);
                return d >= startOfNextWeek && d <= endOfNextWeek;
            }).map(s => {
                const targetId = s.customerId?._id || s.customerId;
                const customer = customers.find(c => String(c._id) === String(targetId));
                const customerName = customer
                    ? (customer.company || customer.contactName || `${customer.firstName || ''} ${customer.lastName || ''}`.trim())
                    : (s.customerId?.company || s.customerId?.contactName || 'Unknown Customer');

                return {
                    _id: s._id,
                    customerId: targetId,
                    customerName,
                    displayDate: s.startTime,
                    displayNote: s.notes || 'Scheduled Follow-up',
                    source: 'Planner',
                    isSchedule: true
                };
            });
            const nextWeekVisits = sourceVisits.filter(v => {
                if (!v.followUpDate) return false;
                const d = new Date(v.followUpDate);
                return d >= startOfNextWeek && d <= endOfNextWeek;
            }).map(v => ({
                ...v,
                displayDate: v.followUpDate,
                displayNote: v.followUp || v.nextAction || 'Follow-up Visit',
                source: 'Visit'
            }));

            followups = [...nextWeekSchedules, ...nextWeekVisits];
        }

        if (dashboardSearchTerm && followupFilter === 'nextWeek') {
            const term = dashboardSearchTerm.toLowerCase();
            followups = followups.filter(f =>
                f.customerName?.toLowerCase().includes(term) ||
                f.displayNote?.toLowerCase().includes(term)
            );
        }

        const parseDate = (d: unknown): number => {
            if (!d) return 0;
            if (d instanceof Date) return d.getTime();
            const dateStr = String(d);
            if (dateStr.includes('/')) {
                const [m, day, y] = dateStr.split('/');
                return new Date(Number(y), Number(m) - 1, Number(day)).getTime();
            }
            const parsed = new Date(dateStr).getTime();
            return isNaN(parsed) ? 0 : parsed;
        };

        return [...followups].sort((a, b) => parseDate(b.displayDate) - parseDate(a.displayDate));
    }, [followupFilter, dashboardFollowups, memoizedFilteredVisits, dashboardSearchTerm, allSchedules, customers]);

    // Pagination State
    const [currentVisitsPage, setCurrentVisitsPage] = useState(1);
    const [currentFollowUpPage, setCurrentFollowUpPage] = useState(1);
    const [currentResourcesPage, setCurrentResourcesPage] = useState(1);
    const [visitsPerPage, setVisitsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
    // The visible page of visits, memoized (declared after the page state it reads): passed inline as `.slice(...)` it
    // was a new array on every render of this page, which VisitsListDetail read
    // as "the list changed" — a photo request per keystroke anywhere on the page.
    const pagedDashboardVisits = React.useMemo(
        () => memoizedFilteredVisits.slice((currentVisitsPage - 1) * visitsPerPage, currentVisitsPage * visitsPerPage),
        [memoizedFilteredVisits, currentVisitsPage, visitsPerPage]
    );

    const handleVisitsPerPageChange = (newVal: number) => {
        setVisitsPerPage(newVal);
        setCurrentVisitsPage(1);
        setCurrentFollowUpPage(1);
        setCurrentResourcesPage(1);
    };

    // Visits, Follow-ups and Resources share the dashboard's location, so a
    // switch on any of them sends all three back to their first page.
    const handleDashboardLocationChange = (loc: unknown) => {
        setDashboardLocation(loc);
        setCurrentVisitsPage(1);
        setCurrentFollowUpPage(1);
        setCurrentResourcesPage(1);
    };

    // The dashboard's Sales Visits list is its own copy (fetchDashboardData), so a
    // saved visit is put in it too, tagged _saving until the server confirms.
    // `insert` false only updates a row that is already there (an edit).
    const patchDashboardVisit = (visit: Loose | null | undefined, insert = true) => {
        if (!visit?._id) return;
        setDashboardVisits((prev: Loose[]) => {
            const has = prev.some(v => v._id === visit._id);
            if (has) return prev.map(v => (v._id === visit._id ? { ...v, ...visit } : v));
            return insert ? [visit, ...prev] : prev;
        });
    };
    const removeDashboardVisit = (visitId: string) => setDashboardVisits(prev => prev.filter(v => v._id !== visitId));

    const handleExportVisits = async (customVisits?: unknown) => {
        const XLSX = await import('xlsx');
        // Only ever a list: the Excel button used to pass its click event in
        // here (onClick={handleExportVisits}), and `event.map` threw.
        const visits = Array.isArray(customVisits) ? customVisits : memoizedFilteredVisits;
        const data = visits.map(v => {
            const { company, contact } = splitCustomer(v);
            return {
                Date: formatDate(v.date),
                Company: company,
                Contact: contact || '-',
                Location: v.location || '-',
                'Visit Type': v.purpose || '-',
                'Logged By': v.createdByName || '-',
                Notes: v.notes || '-',
                'Follow-up Date': v.followUpDate ? formatDate(v.followUpDate) : '-',
                'Follow-up Notes': v.followUp || v.nextAction || '-',
                Outcome: v.outcome || '-'
            };
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Sales Visits");
        XLSX.writeFile(wb, "Sales_Visits.xlsx");
    };

    const handleExportResources = async () => {
        const XLSX = await import('xlsx');
        const resources = memoizedFilteredResources;
        const data = resources.map(r => ({
            Date: r.date ? formatDate(r.date) : formatInstant(r.createdAt),
            Customer: r.customerName,
            Type: r.resourceType || '-',
            Description: r.description || r.notes || '-',
            Status: r.status || 'Active'
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Client Resources");
        XLSX.writeFile(wb, "Client_Resources.xlsx");
    };

    return {
        dashboardTimeRange,
        setDashboardTimeRange,
        dashboardLocationOptions,
        dashboardLocation,
        dashboardSearchTerm,
        setDashboardSearchTerm,
        activeDashboardTab,
        setActiveDashboardTab,
        followupFilter,
        setFollowupFilter,
        todayScheduleCount,
        stats,
        statsLoading,
        followUpPanel,
        allSchedules,
        activeResourceSubTab,
        setActiveResourceSubTab,
        fetchDashboardStats,
        fetchDashboardData,
        dashboardTableLoading,
        fetchSchedules,
        canAddVisits,
        memoizedFilteredVisits,
        memoizedFilteredResources,
        memoizedFollowups,
        currentVisitsPage,
        setCurrentVisitsPage,
        currentFollowUpPage,
        setCurrentFollowUpPage,
        currentResourcesPage,
        setCurrentResourcesPage,
        visitsPerPage,
        pagedDashboardVisits,
        handleVisitsPerPageChange,
        handleDashboardLocationChange,
        patchDashboardVisit,
        removeDashboardVisit,
        handleExportVisits,
        handleExportResources,
    };
}

/** What the hook returns, for the dashboard's page to take as one prop. */
export type DashboardData = ReturnType<typeof useDashboardData>;
