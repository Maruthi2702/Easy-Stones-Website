import React, { useCallback, useEffect, useState } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { formatDate, getLocalISOString } from '../../utils/dateUtils';
import { DEFAULT_ROWS_PER_PAGE } from '../../components/shared/paginationConfig';
import { useLocationFilter } from '../../components/shared/useLocationFilter';
import { splitCustomer } from '../../components/sales/visitsListHelpers';
import { canAddVisit, visitViewScope } from '../../utils/visitAccess.ts';
import { usePeopleOptions } from '../../api/myTeam';
import { peopleDefault, repsParam, includesPerson, parseStoredPeople, showsWhoLogged, togglePerson, isJustMe, MY_TEAM } from './dashboardPeople';
import { repBreakdown } from './repBreakdown';
import { canSeeTeamCalendar } from '../../utils/teamScope.ts';
import { resourceExportRows } from './resources/resourceList';
import { rangeQuery } from './dashboardFocus';
import { followUpsInView, withStatus } from '../../utils/followUpList';
import type { FollowUpRange } from '../../utils/followUpList';
import { todayISO } from '../../components/shared/calendar/calendarDates';
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
    // One time range for the whole dashboard (dashboardFocus.ts's RANGES); Custom has its days.
    const [dashboardTimeRange, setDashboardTimeRange] = useState('1day');
    const [rangeFrom, setRangeFrom] = useState('');
    const [rangeTo, setRangeTo] = useState('');
    const setDashboardRange = (id: string, from = '', to = '') => {
        setDashboardTimeRange(id);
        setRangeFrom(id === 'custom' ? from : '');
        setRangeTo(id === 'custom' ? to : '');
    };
    const rangeParam = rangeQuery(dashboardTimeRange, rangeFrom, rangeTo);
    // The Sales dashboard's location filter: Visits, Follow-ups, Resources and
    // the tiles above them all follow it ('' = every branch the viewer may
    // see). Offered from the viewer's Visits permissions (visitViewScope in
    // src/utils/visitAccess.ts): every branch with view_all_visits, their
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
    // The People filter (dashboardPeople.ts): whose work the page shows, for
    // anyone who can see more than their own. Opens on Me; a different pick is
    // remembered for the session, like the location. The location narrows by
    // where the people work (teamScope.js — by the rep's branch).
    const me = String(currentUserId || '');
    const canPickPeople = visitViewScope(currentUser).kind !== 'own';
    const peopleOptions = usePeopleOptions(currentUser, currentUserId);
    const peopleKey = `salesDashboard.people.${me}`;
    const readPeople = (key: string): string[] | null => {
        try { return parseStoredPeople(sessionStorage.getItem(key)); } catch { return null; }
    };
    const [pickedPeople, setPickedPeople] = useState<string[] | null>(() => (me ? readPeople(peopleKey) : null));
    // Read again when the signed-in person changes (adjusting state in render, not an effect, so the first fetch already has it).
    const [peopleFor, setPeopleFor] = useState(me);
    if (peopleFor !== me) {
        setPeopleFor(me);
        setPickedPeople(me ? readPeople(peopleKey) : null);
    }
    const dashboardPeople = canPickPeople ? (pickedPeople ?? peopleDefault(me)) : peopleDefault(me);
    const peopleParam = canPickPeople ? repsParam(dashboardPeople) : '';
    const dashboardLocationParam = (dashboardLocation ? `&location=${encodeURIComponent(dashboardLocation)}` : '') + peopleParam;
    // The calendar follows the same filter for anyone with Users & Roles →
    // Visits → Team calendar (teamScope.js): '' while it's just them (their own
    // calendar, as before), else the team calendar's query for
    // /api/schedule?scope=team. Others' stops are read only.
    const teamCalendar = canPickPeople && canSeeTeamCalendar(currentUser);
    const calendarViewing = teamCalendar && !isJustMe(dashboardPeople, me)
        ? `&scope=team${repsParam(dashboardPeople)}${dashboardLocation ? `&location=${encodeURIComponent(dashboardLocation)}` : ''}`
        : '';
    const myLocations = peopleOptions.find((o) => o.value === me)?.locations;
    const calendarIncludesMe = !calendarViewing || (includesPerson(dashboardPeople, me)
        && (!dashboardLocation || !myLocations || myLocations.includes(dashboardLocation)));
    const [dashboardSearchTerm, setDashboardSearchTerm] = useState('');

    const [activeDashboardTab, setActiveDashboardTab] = useState('visits'); // 'visits' or 'resources'
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
    const [dashboardErrors, setDashboardErrors] = useState<Record<string, string | null>>({});
    const loadError = (part: string, message: string | null) => setDashboardErrors(previous => ({ ...previous, [part]: message }));
    // Bumped each time the lists are read again (a save anywhere refetches
    // them), so Dashboard → Follow-ups, which loads its own, catches up too.
    const [dashboardDataVersion, setDashboardDataVersion] = React.useState(0);
    const [allSchedules, setAllSchedules] = useState<Loose[]>([]);

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
            const response = await authFetch(`${API_URL}/api/dashboard/stats?${rangeParam}&localDate=${localDate}${dashboardLocationParam}`);
            if (!response.ok) throw new Error(`Stats request failed (${response.status})`);
            const data = await response.json();
            if (reqId === dashboardStatsReqRef.current) { setStats(data); loadError('stats', null); }
        } catch (error) {
            console.error('Error fetching dashboard stats:', error);
            if (reqId === dashboardStatsReqRef.current) loadError('stats', 'summary totals');
        } finally {
            if (reqId === dashboardStatsReqRef.current) setStatsLoading(false);
        }
    }, [rangeParam, dashboardLocationParam]);

    const fetchFollowUpPanel = useCallback(async () => {
        const reqId = ++followUpPanelReqRef.current;
        try {
            const localDateStr = new Date().toLocaleDateString('en-CA');
            const res = await authFetch(`${API_URL}/api/dashboard/followups/panel?${rangeParam}&localDate=${localDateStr}${dashboardLocationParam}`);
            if (!res.ok) throw new Error(`Follow-ups request failed (${res.status})`);
            const rows = await res.json();
            if (!Array.isArray(rows)) throw new Error('Invalid follow-ups response');
            if (reqId === followUpPanelReqRef.current) { setFollowUpPanel(rows); loadError('followUpPanel', null); }
        } catch (error) {
            console.error('Error fetching follow-up panel:', error);
            if (reqId === followUpPanelReqRef.current) loadError('followUpPanel', 'follow-ups');
        }
    }, [rangeParam, dashboardLocationParam]);

    // Fetch Independent Dashboard Data
    const fetchDashboardData = useCallback(async () => {
        const reqId = ++dashboardDataReqRef.current;
        setDashboardDataLoading(true);
        fetchFollowUpPanel(); // not awaited: the table doesn't wait for the panel
        try {
            const localDateStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
            const [visitsRes, resourcesRes, followupsRes] = await Promise.all([
                authFetch(`${API_URL}/api/dashboard/visits?${rangeParam}&localDate=${localDateStr}${dashboardLocationParam}`),
                authFetch(`${API_URL}/api/dashboard/resources?${rangeParam}&localDate=${localDateStr}${dashboardLocationParam}`),
                // Every follow-up in scope: By rep counts them by the Follow-ups tab's rule (followUpList.ts).
                authFetch(`${API_URL}/api/dashboard/visits?timeRange=all&localDate=${localDateStr}&filterType=followup${dashboardLocationParam}`)
            ]);
            if (![visitsRes, resourcesRes, followupsRes].every(response => response.ok)) throw new Error('Dashboard list request failed');
            const visits = await visitsRes.json();
            const resources = await resourcesRes.json();
            const followups = await followupsRes.json();
            if (![visits, resources, followups].every(Array.isArray)) throw new Error('Invalid dashboard list response');
            if (reqId !== dashboardDataReqRef.current) return; // superseded — see dashboardDataReqRef

            setDashboardVisits(Array.isArray(visits) ? visits : []);
            setDashboardResources(Array.isArray(resources) ? resources : []);
            setDashboardFollowups(followups);
            loadError('data', null);
            setDashboardDataVersion((v) => v + 1);
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            if (reqId === dashboardDataReqRef.current) loadError('data', 'visits and resources');
        } finally {
            if (reqId === dashboardDataReqRef.current) {
                setDashboardDataLoading(false);
                setDashboardLoaded(true);
            }
        }
    }, [rangeParam, dashboardLocationParam, fetchFollowUpPanel]);

    // A dashboard table with no rows yet while its data is still on the way
    // says so, instead of claiming there's nothing there.
    const dashboardTableLoading = dashboardDataLoading || !dashboardLoaded;

    // Single effect: fire BOTH dashboard fetches in parallel when dashboardTimeRange or refresh triggers change
    useEffect(() => {
        Promise.all([fetchDashboardStats(), fetchDashboardData()]);
    }, [fetchDashboardStats, fetchDashboardData, customerRefreshTrigger, resourceRefreshTrigger]);

    // Fetch schedules for the dashboard
    const schedulesReqRef = React.useRef(0);
    const fetchSchedules = useCallback(async () => {
        const reqId = ++schedulesReqRef.current;
        try {
            // Fetch a broad range of schedules for the dashboard (e.g., +/- 1 month)
            const now = new Date();
            const start = new Date(now);
            start.setMonth(now.getMonth() - 1);
            const end = new Date(now);
            end.setMonth(now.getMonth() + 1);

            // Use getLocalISOString to avoid UTC conversion logic
            const response = await authFetch(`${API_URL}/api/schedule?start=${getLocalISOString(start)}&end=${getLocalISOString(end)}${calendarViewing}`);
            if (!response.ok) throw new Error(`Schedule request failed (${response.status})`);
            {
                const data = await response.json();
                if (!Array.isArray(data)) throw new Error('Invalid schedule response');
                if (reqId !== schedulesReqRef.current) return;
                loadError('schedules', null);
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
            if (reqId === schedulesReqRef.current) loadError('schedules', 'calendar');
        }
    }, [calendarViewing]);

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
            case '90days':
                start = new Date();
                start.setDate(now.getDate() - 90);
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
        // (dashboardScope in src/utils/dashboardMatch.ts: a manager only their
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
                (r.notes?.toLowerCase().includes(searchLower)) ||
                (r.city?.toLowerCase().includes(searchLower)) ||
                (r.uploadedByName?.toLowerCase().includes(searchLower));

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

    // The People filter shares the same rule: any change starts every list on page 1.
    const setDashboardPeople = (people: string[]) => {
        setPickedPeople(people);
        try { sessionStorage.setItem(peopleKey, JSON.stringify(people)); } catch { /* private mode: not remembered */ }
        setCurrentVisitsPage(1);
        setCurrentFollowUpPage(1);
        setCurrentResourcesPage(1);
    };
    const toggleDashboardPerson = (id: string) => setDashboardPeople(togglePerson(dashboardPeople, id, me));

    // Sales Visits → "List | By rep" (repBreakdown.ts), for anyone with the
    // People filter. By rep counts the lists already loaded, so its totals are
    // the tiles'. Opening it on Me widens to My team (one row says nothing);
    // a rep's row opens their work in the list.
    const [visitsView, setVisitsViewRaw] = useState<'list' | 'byRep'>('list');
    const setVisitsView = (view: 'list' | 'byRep') => {
        if (view === 'byRep' && isJustMe(dashboardPeople, me)) setDashboardPeople(MY_TEAM);
        setVisitsViewRaw(view);
    };
    const showRepWork = (id: string) => {
        setDashboardPeople([id]);
        setVisitsViewRaw('list');
    };
    const peopleValueKey = dashboardPeople.join(',');
    const repRows = React.useMemo(() => (canPickPeople ? repBreakdown({
        visits: dashboardVisits,
        resources: dashboardResources,
        // What Dashboard → Follow-ups lists as pending for the range: due in it, plus still overdue.
        followUps: withStatus(followUpsInView(dashboardFollowups, { range: dashboardTimeRange as FollowUpRange, from: rangeFrom, to: rangeTo }, todayISO()), 'pending'),
        schedules: teamCalendar ? allSchedules : [],
        people: peopleOptions,
        selection: dashboardPeople,
        location: dashboardLocation || '',
        me,
        today: new Date().toLocaleDateString('en-CA')
    }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dashboardPeople is rebuilt each render; its key is what changes
    [canPickPeople, dashboardVisits, dashboardResources, dashboardFollowups, dashboardTimeRange, rangeFrom, rangeTo, teamCalendar, allSchedules, peopleOptions, peopleValueKey, dashboardLocation, me]);

    // The dashboard's Sales Visits list is its own copy (fetchDashboardData), so a
    // saved visit is put in it too, tagged _saving until the server confirms.
    // `insert` false only updates a row that is already there (an edit).
    const patchDashboardVisit = (visit: Loose | null | undefined, insert = true) => {
        if (!visit?._id) return;
        setDashboardVisits((prev: Loose[]) => {
            const has = prev.some(v => v._id === visit._id);
            if (has) return prev.map(v => (v._id === visit._id ? { ...v, ...visit } : v));
            // A new visit is the viewer's own: only shown when they're in view.
            return insert && includesPerson(dashboardPeople, String(visit.createdBy || me)) ? [visit, ...prev] : prev;
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

    // Resources → ⋯ → Export this view: the rows on screen (filters and search applied).
    const handleExportResources = async (rows: Loose[] = memoizedFilteredResources, fileName = 'Resources.xlsx') => {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(resourceExportRows(rows));
        XLSX.utils.book_append_sheet(wb, ws, 'Resources');
        XLSX.writeFile(wb, fileName);
    };

    // Resources → ⋯ → Export all resources: every date and location this login may see (the server scopes it).
    const handleExportAllResources = async () => {
        try {
            const localDateStr = new Date().toLocaleDateString('en-CA');
            const res = await authFetch(`${API_URL}/api/dashboard/resources?timeRange=all&localDate=${localDateStr}`);
            if (!res.ok) throw new Error(`The server answered ${res.status}`);
            const rows = await res.json();
            await handleExportResources(Array.isArray(rows) ? rows : [], 'All_Resources.xlsx');
        } catch (error) {
            console.error('Export all resources failed:', error);
            alert(`Couldn't export all resources: ${(error as Error).message}. Try again in a moment.`);
        }
    };

    return {
        dashboardErrors,
        retryDashboard: () => Promise.all([fetchDashboardStats(), fetchDashboardData(), fetchSchedules()]),
        dashboardTimeRange,
        rangeFrom,
        rangeTo,
        setDashboardRange,
        dashboardLocationOptions,
        dashboardLocation,
        canPickPeople,
        peopleOptions,
        dashboardPeople,
        setDashboardPeople,
        toggleDashboardPerson,
        showWhoLogged: canPickPeople && showsWhoLogged(dashboardPeople, me),
        resetDashboardPeople: () => setDashboardPeople(peopleDefault(me)),
        showMyTeam: () => setDashboardPeople(MY_TEAM),
        visitsView: canPickPeople ? visitsView : 'list' as const,
        setVisitsView,
        showRepWork,
        repRows,
        teamCalendar,
        calendarViewing,
        calendarIncludesMe,
        dashboardSearchTerm,
        setDashboardSearchTerm,
        activeDashboardTab,
        setActiveDashboardTab,
        dashboardScope: dashboardLocationParam,
        dashboardDataVersion,
        todayScheduleCount,
        stats,
        statsLoading,
        followUpPanel,
        allSchedules,
        fetchDashboardStats,
        fetchDashboardData,
        dashboardTableLoading,
        fetchSchedules,
        canAddVisits,
        memoizedFilteredVisits,
        memoizedFilteredResources,
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
        handleExportAllResources,
    };
}

/** What the hook returns, for the dashboard's page to take as one prop. */
export type DashboardData = ReturnType<typeof useDashboardData>;
