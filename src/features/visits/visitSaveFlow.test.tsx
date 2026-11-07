// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useVisitEditor } from './useVisitEditor';
import { useDashboardData, LIVE_REFRESH_DELAY_MS } from '../dashboard/useDashboardData';
import { useSalesLiveUpdates } from '../salesShell/useSalesLiveUpdates';

const { request, listeners } = vi.hoisted(() => ({
    request: vi.fn<typeof fetch>(),
    listeners: {} as Record<string, (payload?: unknown) => void>
}));
vi.mock('../../api/authFetch', () => ({ authFetch: request }));
vi.mock('../../api/myTeam', () => ({ usePeopleOptions: () => [] }));
vi.mock('../../components/shared/useLocationFilter', () => ({ useLocationFilter: () => ['', vi.fn()] }));
vi.mock('socket.io-client', () => ({ io: () => ({
    on: (event: string, handler: (payload?: unknown) => void) => { listeners[event] = handler; },
    emit: vi.fn(), disconnect: vi.fn()
}) }));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['before', 'after'])('uses six requests for a new staff visit when its socket echo arrives %s the response', async echo => {
    request.mockReset();
    let savedPayload: Record<string, unknown>;
    request.mockImplementation(async (input, options) => {
        const url = String(input);
        if (options?.method === 'POST') {
            savedPayload = JSON.parse(String(options.body));
            if (echo === 'before') listeners.customer_update({ kind: 'visit', customerId: 'c1', mutationId: savedPayload._mutationId });
            return Response.json({ visit: { ...savedPayload, createdBy: 'u1' } }, { status: 201 });
        }
        return Response.json(url.includes('/stats?') ? { visits: 1, resources: 0, followUp: 0 } : []);
    });
    const unwantedRefresh = vi.fn();
    const { result } = renderHook(() => {
        const dashboard = useDashboardData({
            currentUser: { permissions: ['add_visits'] }, currentUserId: 'u1', locations: [], customers: [],
            customerRefreshTrigger: 0, resourceRefreshTrigger: 0
        });
        const visits = useVisitEditor({
            currentUser: { _id: 'u1' }, selectedCustomerId: 'c1', selectedCustomer: null,
            customers: [], customerOptions: [], patchOpenCustomerVisits: vi.fn(), removeOpenCustomerVisit: vi.fn(),
            patchDashboardVisit: dashboard.patchDashboardVisit, removeDashboardVisit: dashboard.removeDashboardVisit,
            setCurrentFollowUpPage: vi.fn(), showSaveToast: vi.fn(), setDeleteConfirmation: vi.fn(), refreshVisits: dashboard.refreshVisits
        });
        useSalesLiveUpdates({
            currentUserIdRef: useRef('u1'), refreshCheckInsRef: useRef(vi.fn()), resyncCheckInsRef: useRef(vi.fn()),
            onStart: vi.fn(), onCustomersChanged: unwantedRefresh, onVisitsChanged: dashboard.refreshVisits,
            onResourcesChanged: unwantedRefresh, onLocationsChanged: vi.fn(), onInventoryChanged: vi.fn(),
            onMySchedulesChanged: dashboard.fetchSchedules
        });
        return { dashboard, visits };
    });
    await waitFor(() => expect(result.current.dashboard.dashboardTableLoading).toBe(false));
    await waitFor(() => expect(result.current.dashboard.statsLoading).toBe(false));
    request.mockClear();
    vi.useFakeTimers();
    act(() => result.current.visits.handleQuickAddVisit());
    await act(async () => {
        await result.current.visits.handleSaveVisit({ customerId: 'c1', date: '2026-11-06', purpose: 'Quick Note', image: [] });
    });
    expect(request).toHaveBeenCalledTimes(1); // save; no eager customer or calendar reads
    if (echo === 'after') {
        act(() => listeners.customer_update({ kind: 'visit', customerId: 'c1', mutationId: savedPayload!._mutationId }));
    }
    await act(async () => { vi.advanceTimersByTime(LIVE_REFRESH_DELAY_MS); });
    expect(request).toHaveBeenCalledTimes(5); // save + stats, visits, follow-ups, preview
    await act(async () => { listeners.schedule_update({ userId: 'u1' }); });
    expect(request).toHaveBeenCalledTimes(6); // calendar after the server links the visit
    expect(unwantedRefresh).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([url]) => /\/dashboard\/resources|\/customers\/dropdown/.test(String(url)))).toBe(false);
});
