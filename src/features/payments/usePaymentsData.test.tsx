// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePaymentsData } from './usePaymentsData';

const api = vi.hoisted(() => ({ paymentLocations: vi.fn(), listPayments: vi.fn(), addPayment: vi.fn(), editPayment: vi.fn(), voidPayment: vi.fn() }));
vi.mock('./paymentsApi', () => api);
const user = { location: 'Seattle', assignedLocations: ['*'], permissions: ['view_payments'] };
const day = { submitted: false, submittedBy: '', submittedAt: null, autoSubmitted: false };
const resultFor = (location: string) => ({ payments: [{ id: location, location }], day, today: '2026-11-05' });
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12));
  api.paymentLocations.mockResolvedValue({ locations: ['Seattle', 'Spokane'] });
  api.listPayments.mockImplementation(async location => resultFor(location));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Payments location requests', () => {
  it('opens the permitted home branch and waits for the branch list before requesting payments', async () => {
    let resolve!: (value: { locations: string[] }) => void;
    api.paymentLocations.mockReturnValue(new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => usePaymentsData(user));
    expect(api.listPayments).not.toHaveBeenCalled();
    await act(async () => { resolve({ locations: ['Seattle', 'Spokane'] }); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.listPayments).toHaveBeenCalledWith('Seattle', '2026-11-05');
  });

  it('does not load an unrestricted list for an account without branches', async () => {
    api.paymentLocations.mockResolvedValue({ locations: [] });
    const { result } = renderHook(() => usePaymentsData(user));
    await waitFor(() => expect(result.current.error).toContain('No branch is assigned'));
    expect(result.current.loading).toBe(false);
    expect(api.listPayments).not.toHaveBeenCalled();
  });

  it('hides the old branch while All locations loads and ignores a late combined response after switching back', async () => {
    let resolveAll!: (value: ReturnType<typeof resultFor>) => void;
    api.listPayments.mockImplementation(async location => location ? resultFor(location) : new Promise(resolve => { resolveAll = resolve; }));
    const { result } = renderHook(() => usePaymentsData(user));
    await waitFor(() => expect(result.current.payments[0]?.location).toBe('Seattle'));
    act(() => result.current.setLocation(''));
    expect(result.current.payments).toEqual([]);
    expect(result.current.loading).toBe(true);
    act(() => result.current.setLocation('Spokane'));
    await waitFor(() => expect(result.current.payments[0]?.location).toBe('Spokane'));
    await act(async () => { resolveAll(resultFor('late combined response')); });
    expect(result.current.payments[0]?.location).toBe('Spokane');
  });

  it('does not display a single branch as the combined total if the All locations request fails', async () => {
    api.listPayments.mockImplementation(async location => {
      if (!location) throw new Error('Could not load all branches');
      return resultFor(location);
    });
    const { result } = renderHook(() => usePaymentsData(user));
    await waitFor(() => expect(result.current.payments).toHaveLength(1));
    act(() => result.current.setLocation(''));
    await waitFor(() => expect(result.current.error).toBe('Could not load all branches'));
    expect(result.current.payments).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
