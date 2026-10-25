// @vitest-environment jsdom
// The resource form: opening it, saving (new and edit), refusals, and the delete check.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const authFetch = vi.fn();
vi.mock('../../api/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

const { useResourceEditor } = await import('./useResourceEditor');

const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const deps = () => ({
  selectedCustomerId: 'c9', selectedCustomer: { _id: 'c9', company: 'Stone River' },
  setIsSaving: vi.fn(), refreshAfterSave: vi.fn(), setDeleteConfirmation: vi.fn()
});

beforeEach(() => { authFetch.mockReset(); vi.spyOn(window, 'alert').mockImplementation(() => {}); });

describe('useResourceEditor', () => {
  it('opens a blank form for the open customer', () => {
    const { result } = renderHook(() => useResourceEditor(deps()));
    act(() => result.current.handleAddResource());
    expect(result.current.showResourceModal).toBe(true);
    expect(result.current.resourceForm).toMatchObject({ customerId: 'c9', customer: 'Stone River', status: 'Active' });
  });

  it('opens for a route-planner pin with its name', () => {
    const { result } = renderHook(() => useResourceEditor(deps()));
    act(() => result.current.handleAddResourceForPin({ _id: 'p1', company: 'Pin Co' }));
    expect(result.current.resourceForm).toMatchObject({ customerId: 'p1', customer: 'Pin Co' });
  });

  it('saves a new resource, closes the form and reloads', async () => {
    const d = deps();
    authFetch.mockImplementation(() => reply(200, {}));
    const { result } = renderHook(() => useResourceEditor(d));
    act(() => result.current.handleAddResource());
    await act(async () => { await result.current.handleSaveResource(); });
    expect(authFetch.mock.calls[0][0]).toContain('/api/customers/c9/resources');
    expect(authFetch.mock.calls[0][1].method).toBe('POST');
    expect(result.current.showResourceModal).toBe(false);
    expect(d.refreshAfterSave).toHaveBeenCalledWith('c9', { schedules: true });
    expect(d.setIsSaving).toHaveBeenLastCalledWith(false);
  });

  it('keeps the form open and says why when the server refuses', async () => {
    const d = deps();
    authFetch.mockImplementation(() => reply(400, { message: 'Bad type' }));
    const { result } = renderHook(() => useResourceEditor(d));
    act(() => result.current.handleAddResource());
    await act(async () => { await result.current.handleSaveResource(); });
    expect(result.current.showResourceModal).toBe(true);
    expect(window.alert).toHaveBeenCalledWith('Failed to save resource: Bad type');
    expect(d.refreshAfterSave).not.toHaveBeenCalled();
  });

  it('asks before deleting', async () => {
    const d = deps();
    const { result } = renderHook(() => useResourceEditor(d));
    await act(async () => { await result.current.handleDeleteResource('r1'); });
    expect(d.setDeleteConfirmation).toHaveBeenCalledWith(expect.objectContaining({ isOpen: true, type: 'resource', id: 'r1', customerId: 'c9' }));
  });
});
