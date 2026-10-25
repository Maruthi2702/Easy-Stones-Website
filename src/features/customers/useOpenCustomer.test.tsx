// @vitest-environment jsdom
// The open customer: loads on an id, cached copy first, patched ahead of a visit save.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const authFetch = vi.fn();
vi.mock('../../api/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

const { useOpenCustomer } = await import('./useOpenCustomer');

const FULL = { permissions: ['view_customers', 'view_customer_profile'], role: 'admin' };
const record = { _id: 'c1', company: 'Pacific Granite', quickNote: 'Call Monday', visits: [{ _id: 'v1', notes: 'old' }] };
const reply = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

beforeEach(() => { authFetch.mockReset(); authFetch.mockImplementation(() => reply(record)); });

const setup = (selectedCustomerId: string | null = 'c1') => {
  const onOpening = vi.fn(); const onShown = vi.fn();
  const hook = renderHook(({ id }) => useOpenCustomer({ currentUser: FULL, customers: [], selectedCustomerId: id, onOpening, onShown }), { initialProps: { id: selectedCustomerId } });
  return { ...hook, onOpening, onShown };
};

describe('useOpenCustomer', () => {
  it('loads the record when an id is set, clearing the last one first', async () => {
    const { result, onOpening, onShown } = setup();
    await waitFor(() => expect(result.current.selectedCustomerDetail).toEqual(record));
    expect(authFetch.mock.calls[0][0]).toContain('/api/customers/c1');
    expect(onOpening).toHaveBeenCalled();
    expect(onShown).toHaveBeenCalledWith(record);
    expect(result.current.selectedCustomer).toEqual(record);
    expect(result.current.visitsLoading).toBe(false);
  });

  it('shows the cached copy at once the next time', async () => {
    const { result, onShown, rerender } = setup();
    await waitFor(() => expect(result.current.selectedCustomerDetail).toEqual(record));
    rerender({ id: null });
    let resolve: (r: Response) => void = () => {};
    authFetch.mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
    onShown.mockClear();
    rerender({ id: 'c1' });
    await waitFor(() => expect(onShown).toHaveBeenCalledWith(record));
    expect(result.current.visitsLoading).toBe(false);
    await act(async () => { resolve(new Response(JSON.stringify(record))); });
  });

  it('a visit saved for this customer shows before the server answers, and can be taken back', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.selectedCustomerDetail).toEqual(record));
    act(() => result.current.patchOpenCustomerVisits('c1', { _id: 'v2', notes: 'new' }));
    expect(result.current.selectedCustomer!.visits.map((v: { _id: string }) => v._id)).toEqual(['v1', 'v2']);
    act(() => result.current.patchOpenCustomerVisits('c1', { _id: 'v1', notes: 'edited' }));
    expect(result.current.selectedCustomer!.visits[0].notes).toBe('edited');
    expect(result.current.customerCacheRef.current.c1.visits).toHaveLength(2);
    act(() => result.current.removeOpenCustomerVisit('c1', 'v2'));
    expect(result.current.selectedCustomer!.visits).toHaveLength(1);
    act(() => result.current.patchOpenCustomerVisits('c9', { _id: 'v3' }));
    expect(result.current.selectedCustomer!.visits).toHaveLength(1);
  });

  it('shows nothing without Full profile', () => {
    const { result } = renderHook(() => useOpenCustomer({ currentUser: { permissions: [] }, customers: [], selectedCustomerId: 'c1', onOpening() {}, onShown() {} }));
    expect(result.current.selectedCustomer).toBeNull();
  });
});
