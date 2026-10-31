// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { useDashboardData } from './useDashboardData';

vi.mock('../../api/authFetch', () => ({ authFetch: vi.fn() }));
vi.mock('../../api/myTeam', () => ({ usePeopleOptions: () => [] }));
vi.mock('../../components/shared/useLocationFilter', () => ({ useLocationFilter: () => ['', vi.fn()] }));
const { authFetch } = await import('../../api/authFetch');
const visit = { _id: 'v1', createdBy: 'u1', date: '2026-10-31', customerName: 'Example', notes: 'Visit' };
const dependencies = { currentUser: { permissions: [] }, locations: [], customers: [], currentUserId: 'u1', customerRefreshTrigger: 0, resourceRefreshTrigger: 0 };
let failLists = false, failStats = false;
beforeEach(() => {
  failLists = false; failStats = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(authFetch).mockImplementation(async url => {
    const key = String(url);
    const status = (key.includes('/dashboard/visits') && failLists) || (key.includes('/stats') && failStats) ? 500 : 200;
    const body = status !== 200 ? { error: 'Test failure' } : key.includes('/stats') ? { visits: 1, resources: 0, followUp: 0 } : key.includes('/dashboard/visits') && !key.includes('filterType=') ? [visit] : [];
    return new Response(JSON.stringify(body), { status });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('dashboard request failures', () => {
  it('records an error instead of treating a failed list response as an empty success, and retries', async () => {
    failLists = true;
    const { result } = renderHook(() => useDashboardData(dependencies));
    await waitFor(() => expect(result.current.dashboardErrors.data).toBe('visits and resources'));
    failLists = false;
    await act(async () => { await result.current.retryDashboard(); });
    expect(result.current.dashboardErrors.data).toBeNull();
    expect(result.current.memoizedFilteredVisits).toHaveLength(1);
  });
  it('keeps previously loaded rows when a refresh fails', async () => {
    const { result } = renderHook(() => useDashboardData(dependencies));
    await waitFor(() => expect(result.current.memoizedFilteredVisits).toHaveLength(1));
    failLists = true;
    await act(async () => { await result.current.fetchDashboardData(); });
    expect(result.current.dashboardErrors.data).toBeTruthy();
    expect(result.current.memoizedFilteredVisits[0]._id).toBe('v1');
  });
  it('reports failed statistics instead of displaying a successful zero count', async () => {
    failStats = true;
    const { result } = renderHook(() => useDashboardData(dependencies));
    await waitFor(() => expect(result.current.dashboardErrors.stats).toBe('summary totals'));
  });
});
