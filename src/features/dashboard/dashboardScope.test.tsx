// @vitest-environment jsdom
// Keep real location/people state and exercise the requests the dashboard sends.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardData, LIVE_REFRESH_DELAY_MS } from './useDashboardData';
import { narrowPeople, visiblePeople } from '../../utils/teamScope';
import { repTotals } from './repBreakdown';
import type { Loose } from '../../types/records';

const fixtures = vi.hoisted(() => ({ staff: [
    { _id: 'admin', role: 'admin', displayName: 'Admin', location: 'Seattle', assignedLocations: ['*'] },
    { _id: 'manager', role: 'manager', displayName: 'Manager', location: 'Seattle', assignedLocations: ['Seattle', 'Dallas'] },
    { _id: 'sea', role: 'sales_rep', displayName: 'Seattle Rep', location: 'Seattle', assignedLocations: ['Seattle'] },
    { _id: 'dal', role: 'sales_rep', displayName: 'Dallas Rep', location: 'Dallas', assignedLocations: ['Dallas'] },
    { _id: 'atl', role: 'sales_rep', displayName: 'Atlanta Rep', location: 'Atlanta', assignedLocations: ['Atlanta'] }
] }));
vi.mock('../../api/salesRepOptions', () => ({ useStaffList: () => fixtures.staff }));
const request = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock('../../api/authFetch', () => ({ authFetch: request }));

let viewer: Loose;
const locations = ['Seattle', 'Dallas', 'Atlanta'];
const deps = (live: { customerRefreshTrigger?: number; resourceRefreshTrigger?: number; active?: boolean } = {}) => ({ currentUser: viewer, currentUserId: String(viewer.id), locations, customers: [], customerRefreshTrigger: 0, resourceRefreshTrigger: 0, ...live });
const scopedRows = (url: URL) => {
    const visible = visiblePeople(viewer, fixtures.staff);
    const picked = narrowPeople(visible, { reps: url.searchParams.get('reps')?.split(',') || [], location: url.searchParams.get('location') || '' }, fixtures.staff);
    return fixtures.staff.filter(person => picked === '*' || picked.has(person._id)).map(person => ({
        _id: `visit-${person._id}`, createdBy: person._id, uploadedBy: person._id, customerName: `Customer ${person._id}`,
        date: '2026-11-05', followUp: 'Call', followUpDate: '2026-11-06'
    }));
};
const reply = (input: string | URL | Request) => {
    const url = new URL(String(input), 'http://localhost');
    const rows = scopedRows(url);
    return Response.json(url.pathname.endsWith('/stats') ? { visits: rows.length, resources: rows.length, followUp: rows.length } : rows);
};
const calls = (path = '/dashboard/visits') => request.mock.calls.map(([url]) => new URL(String(url), 'http://localhost')).filter(url => url.pathname.endsWith(path));

beforeEach(() => {
    sessionStorage.clear();
    viewer = { ...fixtures.staff[0], id: 'admin', permissions: ['view_dashboard', 'view_all_visits', 'view_team_calendar'] };
    request.mockReset(); request.mockImplementation(async url => reply(url));
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('dashboard multiple locations and reps', () => {
    it('defaults to Me at home, combines locations and reps, and resets every list page', async () => {
        const { result } = renderHook(() => useDashboardData(deps()));
        await waitFor(() => expect(result.current.stats.visits).toBe(1));
        expect(result.current.dashboardLocation).toBe('Seattle');
        expect(calls().at(-1)?.searchParams.get('reps')).toBe('admin');
        act(() => result.current.showMyTeam());
        await waitFor(() => expect(result.current.stats.visits).toBe(3));
        act(() => {
            result.current.setCurrentVisitsPage(3); result.current.setCurrentResourcesPage(3); result.current.setCurrentFollowUpPage(3);
        });
        act(() => result.current.handleDashboardLocationChange(''));
        await waitFor(() => expect(result.current.stats.visits).toBe(5));
        expect([result.current.currentVisitsPage, result.current.currentResourcesPage, result.current.currentFollowUpPage]).toEqual([1, 1, 1]);
        act(() => result.current.setDashboardPeople(['sea', 'dal']));
        await waitFor(() => expect(result.current.stats.visits).toBe(2));
        expect(result.current.memoizedFilteredVisits.map(row => row.createdBy).sort()).toEqual(['dal', 'sea']);
        act(() => result.current.handleDashboardLocationChange('Dallas'));
        await waitFor(() => expect(result.current.stats.visits).toBe(1));
        expect(result.current.memoizedFilteredVisits.map(row => row.createdBy)).toEqual(['dal']);
    });

    it('sends the same location, reps and custom dates to every dashboard endpoint', async () => {
        const { result } = renderHook(() => useDashboardData(deps()));
        await waitFor(() => expect(result.current.dashboardTableLoading).toBe(false));
        request.mockClear();
        act(() => {
            result.current.setDashboardPeople(['dal']);
            result.current.handleDashboardLocationChange('Dallas');
            result.current.setDashboardRange('custom', '2026-11-01', '2026-11-05');
        });
        await waitFor(() => expect(result.current.dashboardTableLoading).toBe(false));
        for (const path of ['/dashboard/stats', '/dashboard/visits', '/dashboard/resources', '/dashboard/followups/panel']) {
            const urls = calls(path);
            expect(urls.length).toBeGreaterThan(0);
            for (const url of urls) {
                expect(url.searchParams.get('location')).toBe('Dallas');
                expect(url.searchParams.get('reps')).toBe('dal');
                // The separate all-time follow-up inventory intentionally has no range.
                if (url.searchParams.get('filterType') === 'followup') continue;
                expect(url.searchParams.get('from')).toBe('2026-11-01');
                expect(url.searchParams.get('to')).toBe('2026-11-05');
            }
        }
    });

    it('offers a multi-location manager only reps at their assigned branches', async () => {
        viewer = { ...fixtures.staff[1], id: 'manager', permissions: ['view_dashboard', 'view_branch_visits'] };
        const { result } = renderHook(() => useDashboardData(deps()));
        expect(result.current.dashboardLocationOptions).toEqual(['Seattle', 'Dallas']);
        expect(result.current.peopleOptions.map(person => person.value).sort()).toEqual(['dal', 'manager', 'sea']);
        act(() => { result.current.showMyTeam(); result.current.handleDashboardLocationChange(''); });
        await waitFor(() => expect(result.current.stats.visits).toBe(3));
        expect(result.current.memoizedFilteredVisits.some(row => row.createdBy === 'atl' || row.createdBy === 'admin')).toBe(false);
    });

    it('does not expose a People or location choice to an own-only rep', async () => {
        viewer = { ...fixtures.staff[2], id: 'sea', permissions: ['view_dashboard'] };
        const { result } = renderHook(() => useDashboardData(deps()));
        await waitFor(() => expect(result.current.stats.visits).toBe(1));
        expect(result.current.canPickPeople).toBe(false);
        expect(result.current.dashboardLocationOptions).toEqual([]);
        expect(result.current.peopleOptions).toEqual([]);
        act(() => result.current.setDashboardPeople(['atl']));
        expect(result.current.dashboardPeople).toEqual(['sea']);
        expect(result.current.memoizedFilteredVisits.map(row => row.createdBy)).toEqual(['sea']);
    });

    it('makes By rep totals match the lists and drills down to one rep', async () => {
        const { result } = renderHook(() => useDashboardData(deps()));
        await waitFor(() => expect(result.current.dashboardTableLoading).toBe(false));
        act(() => { result.current.handleDashboardLocationChange(''); result.current.setDashboardRange('all'); result.current.setVisitsView('byRep'); });
        await waitFor(() => expect(result.current.stats.visits).toBe(5));
        expect(repTotals(result.current.repRows)).toMatchObject({ visits: 5, resources: 5, followUps: 5 });
        act(() => result.current.showRepWork('dal'));
        await waitFor(() => expect(result.current.stats.visits).toBe(1));
        expect(result.current.visitsView).toBe('list');
        expect(result.current.dashboardPeople).toEqual(['dal']);
    });

    it('ignores older list and totals responses after a quick branch switch', async () => {
        const { result } = renderHook(() => useDashboardData(deps()));
        await waitFor(() => expect(result.current.dashboardTableLoading).toBe(false));
        const pending: (() => void)[] = [];
        request.mockImplementation(async input => {
            const url = new URL(String(input), 'http://localhost');
            const response = reply(input);
            return url.searchParams.get('location') === 'Dallas'
                ? new Promise(resolveReply => { pending.push(() => resolveReply(response)); }) : response;
        });
        act(() => { result.current.showMyTeam(); result.current.handleDashboardLocationChange('Dallas'); });
        await waitFor(() => expect(pending.length).toBeGreaterThan(0));
        act(() => result.current.handleDashboardLocationChange('Atlanta'));
        await waitFor(() => expect(result.current.memoizedFilteredVisits[0]?.createdBy).toBe('atl'));
        await act(async () => { pending.forEach(resolveReply => resolveReply()); });
        expect(result.current.memoizedFilteredVisits.map(row => row.createdBy)).toEqual(['atl']);
        expect(result.current.stats.visits).toBe(1);
        expect(result.current.memoizedFilteredResources.map(row => row.uploadedBy)).toEqual(['atl']);
    });

    it('reloads totals when access is revoked even if the filter query stays the same', async () => {
        sessionStorage.setItem('salesDashboard.people.admin', '[]');
        sessionStorage.setItem('locationFilter:salesDashboard:admin', '""');
        const { result, rerender } = renderHook(() => useDashboardData(deps()));
        await waitFor(() => expect(result.current.stats.visits).toBe(5));
        const before = calls('/dashboard/stats').length;
        viewer = { ...viewer, permissions: ['view_dashboard'] };
        rerender();
        await waitFor(() => expect(calls('/dashboard/stats').length).toBeGreaterThan(before));
        await waitFor(() => expect(result.current.stats.visits).toBe(1));
    });

    it('applies the location choice to Me in the team calendar too', async () => {
        const { result } = renderHook(() => useDashboardData(deps()));
        await waitFor(() => expect(result.current.dashboardTableLoading).toBe(false));
        act(() => result.current.handleDashboardLocationChange('Dallas'));
        await waitFor(() => expect(calls('/schedule').at(-1)?.searchParams.get('location')).toBe('Dallas'));
        expect(calls('/schedule').at(-1)?.searchParams.get('reps')).toBe('admin');
        expect(result.current.calendarIncludesMe).toBe(false);
    });

    it('does not count cancelled stops in the Calendar tile', async () => {
        const day = new Date().toLocaleDateString('en-CA');
        request.mockImplementation(async input => String(input).includes('/api/schedule?') ? Response.json([
            { _id: 'scheduled', userId: 'admin', startTime: `${day}T09:00:00.000`, status: 'Scheduled' },
            { _id: 'cancelled', userId: 'admin', startTime: `${day}T10:00:00.000`, status: 'Cancelled' }
        ]) : reply(input));
        const { result } = renderHook(() => useDashboardData(deps()));
        await waitFor(() => expect(result.current.allSchedules).toHaveLength(2));
        expect(result.current.todayScheduleCount).toBe(1);
    });
});

describe('dashboard live changes', () => {
    it('reloads once per burst of changes, keeping the tiles on screen meanwhile', async () => {
        const live = { customerRefreshTrigger: 0, resourceRefreshTrigger: 0, active: true };
        const { result, rerender } = renderHook(() => useDashboardData(deps(live)));
        await waitFor(() => expect(result.current.statsLoading).toBe(false));
        await waitFor(() => expect(result.current.dashboardTableLoading).toBe(false));
        const before = calls('/dashboard/stats').length;
        vi.useFakeTimers();
        try {
            // A visit save sends customer_update and resource_update: two bumps, one reload.
            live.customerRefreshTrigger = 1; rerender();
            live.resourceRefreshTrigger = 1; rerender();
            expect(calls('/dashboard/stats').length).toBe(before);
            await act(async () => { vi.advanceTimersByTime(LIVE_REFRESH_DELAY_MS); });
            expect(calls('/dashboard/stats').length).toBe(before + 1);
            // Same query: no "…" or "Loading" while it reloads.
            expect(result.current.statsLoading).toBe(false);
            expect(result.current.dashboardTableLoading).toBe(false);
        } finally { vi.useRealTimers(); }
    });

    it('waits while the dashboard is not on screen, then reloads when it is', async () => {
        const live = { customerRefreshTrigger: 0, resourceRefreshTrigger: 0, active: false };
        const { result, rerender } = renderHook(() => useDashboardData(deps(live)));
        await waitFor(() => expect(result.current.statsLoading).toBe(false));
        const before = calls('/dashboard/stats').length;
        vi.useFakeTimers();
        try {
            live.customerRefreshTrigger = 1; rerender();
            live.customerRefreshTrigger = 2; rerender();
            await act(async () => { vi.advanceTimersByTime(LIVE_REFRESH_DELAY_MS * 5); });
            expect(calls('/dashboard/stats').length).toBe(before);
            live.active = true; rerender();
            await act(async () => { vi.advanceTimersByTime(0); });
            expect(calls('/dashboard/stats').length).toBe(before + 1);
        } finally { vi.useRealTimers(); }
    });

    it('still shows loading for a new range', async () => {
        const { result } = renderHook(() => useDashboardData(deps()));
        await waitFor(() => expect(result.current.statsLoading).toBe(false));
        let resolveStats: () => void = () => {};
        request.mockImplementation(async url => {
            if (String(url).includes('/dashboard/stats')) await new Promise<void>(done => { resolveStats = done; });
            return reply(url);
        });
        act(() => result.current.setDashboardRange('7days'));
        await waitFor(() => expect(result.current.statsLoading).toBe(true));
        await act(async () => { resolveStats(); });
        await waitFor(() => expect(result.current.statsLoading).toBe(false));
    });
});
