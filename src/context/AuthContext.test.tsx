// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('../api/deliverySchedule', () => ({ clearScheduleCache: vi.fn() }));
vi.mock('../api/customerOptions', () => ({ clearCustomers: vi.fn() }));
vi.mock('../utils/dataCache', () => ({ clearAllCache: vi.fn() }));
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let verifyStatus = 200, valid = true;
beforeEach(() => {
  verifyStatus = 200; valid = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/verify')) return reply({ valid, authType: 'admin', role: 'sales_rep' }, verifyStatus);
    if (url.endsWith('/token')) return reply({ token: 'isolated-test-token' });
    return reply({ _id: 'u1', username: 'rep', role: 'sales_rep', permissions: [] });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const open = () => renderHook(() => useAuth(), { wrapper: AuthProvider });
describe('recoverable authentication failures', () => {
  it.each([429, 500, 503])('keeps initial HTTP %s verification failure separate from invalid login', async status => {
    verifyStatus = status;
    const { result } = open();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull(); expect(result.current.authError).toContain('could not verify');
    verifyStatus = 200;
    act(() => result.current.retryAuth());
    await waitFor(() => expect(result.current.user?._id).toBe('u1'));
    expect(result.current.authError).toBeNull();
  });
  it('preserves the existing identity during a temporary silent recheck failure', async () => {
    const { result } = open();
    await waitFor(() => expect(result.current.user?._id).toBe('u1'));
    verifyStatus = 429;
    await act(async () => { await result.current.checkAuth({ silent: true }); });
    expect(result.current.user?._id).toBe('u1'); expect(result.current.authError).toBeTruthy();
  });
  it('still clears identity when the server explicitly reports an invalid session', async () => {
    const { result } = open();
    await waitFor(() => expect(result.current.user?._id).toBe('u1'));
    valid = false;
    await act(async () => { await result.current.checkAuth({ silent: true }); });
    expect(result.current.user).toBeNull(); expect(result.current.authError).toBeNull();
  });
  it('treats a temporary profile-load failure as recoverable too', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => String(url).endsWith('/verify')
      ? reply({ valid: true, authType: 'admin' }) : String(url).endsWith('/token') ? reply({}) : reply({}, 503));
    const { result } = open();
    await waitFor(() => expect(result.current.authError).toBeTruthy());
    expect(result.current.loading).toBe(false);
  });
});
