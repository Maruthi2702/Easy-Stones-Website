import { describe, it, expect, vi, beforeEach } from 'vitest';

const authFetch = vi.fn();
vi.mock('../../api/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.stubGlobal('alert', vi.fn());

const { deleteUrl, makeConfirmDelete } = await import('./deleteCheck');
type Req = Parameters<typeof makeConfirmDelete>[0]['deleteConfirmation'];

const ask = (over: Partial<Req> = {}): Req => ({ isOpen: true, type: 'visit', id: 'v1', customerId: 'c1', message: 'Sure?', ...over });
const deps = (request: Req, over = {}) => {
  let state = request;
  const setDeleteConfirmation = vi.fn((next: Req | ((p: Req) => Req)) => { state = typeof next === 'function' ? next(state) : next; });
  return {
    d: {
      deleteConfirmation: request, setDeleteConfirmation, selectedCustomerId: null as string | null, activeDashboardTab: 'visits',
      fetchDashboardResources: vi.fn(), fetchDashboardData: vi.fn(), fetchDashboardStats: vi.fn(), fetchSingleCustomer: vi.fn(), ...over
    },
    state: () => state
  };
};

beforeEach(() => { authFetch.mockReset(); vi.mocked(alert).mockClear(); });

describe('deleteUrl', () => {
  it('sends each kind to its own route', () => {
    expect(deleteUrl('contact', 'c1', 'k1')).toMatch(/\/api\/customers\/c1\/contacts\/k1$/);
    expect(deleteUrl('visit', 'c1', 'v1')).toMatch(/\/api\/customers\/c1\/visits\/v1$/);
    expect(deleteUrl('resource', 'c1', 'r1')).toMatch(/\/api\/customers\/c1\/resources\/r1$/);
    expect(deleteUrl('dashboardResource', null, 'f1')).toMatch(/\/api\/sales-dashboard\/resources\/f1$/);
    expect(deleteUrl('other', 'c1', 'x')).toBeNull();
  });
});

describe('confirm delete', () => {
  it('a visit deleted from the dashboard closes the check and refreshes the dashboard', async () => {
    authFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const { d, state } = deps(ask());
    await makeConfirmDelete(d)();
    expect(authFetch.mock.calls[0][1]).toEqual({ method: 'DELETE' });
    expect(state().isOpen).toBe(false);
    expect(d.fetchDashboardData).toHaveBeenCalled();
    expect(d.fetchSingleCustomer).not.toHaveBeenCalled();
  });
  it('with a customer open, refreshes that customer', async () => {
    authFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const { d } = deps(ask({ type: 'contact', customerId: null }), { selectedCustomerId: 'c9' });
    await makeConfirmDelete(d)();
    expect(authFetch.mock.calls[0][0]).toContain('/customers/c9/contacts/v1');
    expect(d.fetchSingleCustomer).toHaveBeenCalledWith('c9');
  });
  it('a Team Files item refreshes the file list', async () => {
    authFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    const { d } = deps(ask({ type: 'dashboardResource', customerId: null }));
    await makeConfirmDelete(d)();
    expect(d.fetchDashboardResources).toHaveBeenCalled();
  });
  it('a refusal keeps the check open and says why', async () => {
    authFetch.mockResolvedValue(new Response(JSON.stringify({ message: 'Not yours' }), { status: 403 }));
    const { d, state } = deps(ask());
    await makeConfirmDelete(d)();
    expect(state()).toMatchObject({ isOpen: true, isDeleting: false });
    expect(alert).toHaveBeenCalledWith('Not yours');
  });
  it('refuses without a customer (except Team Files)', async () => {
    const { d } = deps(ask({ customerId: null }));
    await makeConfirmDelete(d)();
    expect(authFetch).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Failed to delete visit: Missing customer information');
  });
});
