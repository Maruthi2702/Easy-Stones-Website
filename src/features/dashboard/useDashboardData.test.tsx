// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { useDashboardData } from './useDashboardData';
import type { PersonOption } from '../../api/myTeam';

vi.mock('../../api/authFetch', () => ({ authFetch: vi.fn() }));
const people = vi.hoisted(() => ({ options: [] as PersonOption[] }));
vi.mock('../../api/myTeam', () => ({ usePeopleOptions: () => people.options }));
vi.mock('../../components/shared/useLocationFilter', () => ({ useLocationFilter: () => ['', vi.fn()] }));
const { authFetch } = await import('../../api/authFetch');
const visit = { _id: 'v1', createdBy: 'u1', date: '2026-10-31', customerName: 'Example', notes: 'Visit' };
const dependencies = { currentUser: { permissions: [] }, locations: [], customers: [], currentUserId: 'u1', customerRefreshTrigger: 0, resourceRefreshTrigger: 0 };
let failLists = false, failStats = false;
beforeEach(() => {
  failLists = false; failStats = false;
  people.options = [];
  sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(authFetch).mockImplementation(async url => {
    const key = String(url);
    const status = (key.includes('/dashboard/visits') && failLists) || (key.includes('/stats') && failStats) ? 500 : 200;
    const body = status !== 200 ? { error: 'Test failure' } : key.includes('/stats') ? { visits: 1, resources: 0, followUp: 0 } : key.includes('/dashboard/visits') && !key.includes('filterType=') ? [visit] : [];
    return new Response(JSON.stringify(body), { status });
  });
});

describe('dashboard People filter requests', () => {
  it('loads My team without a rep restriction, then excludes an unchecked teammate', async () => {
    people.options = [
      { id: 'u1', value: 'u1', label: 'Me', location: 'Seattle', inactive: false },
      { id: 'u2', value: 'u2', label: 'Alex', location: 'Seattle', inactive: false },
      { id: 'u3', value: 'u3', label: 'Sam', location: 'Seattle', inactive: false }
    ];
    const { result } = renderHook(() => useDashboardData({ ...dependencies, currentUser: { permissions: ['view_all_visits'] } }));
    const latestVisitsQuery = () => {
      const calls = vi.mocked(authFetch).mock.calls.filter(([url]) => String(url).includes('/dashboard/visits?'));
      return new URL(String(calls.at(-1)?.[0]), 'http://localhost').searchParams;
    };
    await waitFor(() => expect(latestVisitsQuery().get('reps')).toBe('u1'));
    act(() => result.current.showMyTeam());
    await waitFor(() => expect(latestVisitsQuery().has('reps')).toBe(false));
    expect(result.current.dashboardPeople).toEqual([]);
    act(() => result.current.toggleDashboardPerson('u2'));
    await waitFor(() => expect(latestVisitsQuery().get('reps')).toBe('u1,u3'));
    expect(result.current.dashboardPeople).toEqual(['u1', 'u3']);
    expect(JSON.parse(sessionStorage.getItem('salesDashboard.people.u1')!)).toEqual(['u1', 'u3']);
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
