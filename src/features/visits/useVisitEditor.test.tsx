// @vitest-environment jsdom
// The visit form's save: closes at once and sends behind it, shows the visit
// ahead of the answer, and gives the form back with everything typed if it fails.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const authFetch = vi.fn();
vi.mock('../../api/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

const { useVisitEditor } = await import('./useVisitEditor');

const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const deps = () => ({
  currentUser: { _id: 'u1', username: 'krish' }, selectedCustomerId: null, selectedCustomer: null,
  customers: [{ _id: 'c1', company: 'Pacific Granite', contactName: 'Max', location: 'Seattle' }], customerOptions: [],
  patchOpenCustomerVisits: vi.fn(), removeOpenCustomerVisit: vi.fn(), patchDashboardVisit: vi.fn(), removeDashboardVisit: vi.fn(),
  setCurrentFollowUpPage: vi.fn(), showSaveToast: vi.fn(), refreshAfterSave: vi.fn(), setDeleteConfirmation: vi.fn()
});
const filled = { date: '2026-10-20', purpose: 'Scheduled in Person Sales Meeting', notes: 'Met Vlad', customerId: 'c1', image: [] };

beforeEach(() => { authFetch.mockReset(); vi.spyOn(window, 'alert').mockImplementation(() => {}); });

describe('useVisitEditor', () => {
  it('opens a blank form for a new visit', () => {
    const { result } = renderHook(() => useVisitEditor(deps()));
    act(() => result.current.handleQuickAddVisit());
    expect(result.current.showVisitModal).toBe(true);
    expect(result.current.visitForm.purpose).toBe('Scheduled in Person Sales Meeting');
  });

  it('refuses a save without a customer, date and type', async () => {
    const d = deps();
    const { result } = renderHook(() => useVisitEditor(d));
    await act(async () => { await result.current.handleSaveVisit({ ...filled, customerId: '' }); });
    expect(window.alert).toHaveBeenCalled();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('shows the new visit and closes the form at once, then confirms it', async () => {
    const d = deps();
    authFetch.mockImplementation(() => reply(200, { visit: { _id: 'srv', notes: 'Met Vlad' } }));
    const { result } = renderHook(() => useVisitEditor(d));
    act(() => result.current.handleQuickAddVisit());
    await act(async () => { await result.current.handleSaveVisit(filled); });
    expect(result.current.showVisitModal).toBe(false);
    expect(d.patchDashboardVisit.mock.calls[0][0]).toMatchObject({ company: 'Pacific Granite', location: 'Seattle', _saving: true });
    expect(authFetch.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(authFetch.mock.calls[0][1].body)._id).toMatch(/\S/);
    expect(d.showSaveToast).toHaveBeenCalledWith('Visit saved');
    expect(d.refreshAfterSave).toHaveBeenCalledWith('c1', { schedules: true });
  });

  it('takes the visit back and reopens the form with the entries when the server refuses', async () => {
    const d = deps();
    authFetch.mockImplementation(() => reply(403, { message: 'Not allowed' }));
    const { result } = renderHook(() => useVisitEditor(d));
    act(() => result.current.handleQuickAddVisit());
    // The form closes (and renders) first; the send and its failure come after, as in a browser.
    let saving: Promise<void> = Promise.resolve();
    act(() => { saving = result.current.handleSaveVisit(filled); });
    await act(async () => { await saving; });
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(d.removeDashboardVisit).toHaveBeenCalled();
    expect(result.current.showVisitModal).toBe(true);
    expect(result.current.visitForm.notes).toBe('Met Vlad');
    expect(d.showSaveToast.mock.calls[0][0]).toContain('Not allowed');
    expect(d.showSaveToast.mock.calls[0][1]).toBe('error');
  });

  it('asks before deleting, for the open customer by default', async () => {
    const d = { ...deps(), selectedCustomerId: 'c9' };
    const { result } = renderHook(() => useVisitEditor(d));
    await act(async () => { await result.current.handleDeleteVisit('v1'); });
    expect(d.setDeleteConfirmation).toHaveBeenCalledWith(expect.objectContaining({ isOpen: true, type: 'visit', id: 'v1', customerId: 'c9' }));
  });
});
