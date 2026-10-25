// @vitest-environment jsdom
// What can be done to an open customer: contacts, quick note, account, reactions.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const authFetch = vi.fn();
vi.mock('../../api/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

const { useCustomerActions } = await import('./useCustomerActions');

const reply = (status: number, body: unknown = {}) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const deps = () => ({
  selectedCustomer: { _id: 'c1' }, selectedCustomerId: 'c1', selectedCustomerDetail: { _id: 'c1', isActive: true },
  setSelectedCustomerDetail: vi.fn(), fetchSingleCustomer: vi.fn(() => Promise.resolve()), setIsSaving: vi.fn(),
  refreshAfterSave: vi.fn(), setDeleteConfirmation: vi.fn()
});

beforeEach(() => {
  authFetch.mockReset();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockImplementation(() => true);
});

describe('useCustomerActions', () => {
  it('opens a blank contact form, then one filled from a contact', () => {
    const { result } = renderHook(() => useCustomerActions(deps()));
    act(() => result.current.handleAddContact());
    expect(result.current.showContactModal).toBe(true);
    expect(result.current.contactForm.name).toBe('');
    act(() => result.current.handleEditContact({ _id: 'k1', name: 'Max', phone: '1' }));
    expect(result.current.editingContact).toMatchObject({ _id: 'k1' });
    expect(result.current.contactForm).toMatchObject({ name: 'Max', phone: '1', email: '' });
  });

  it('saves a new contact, closes the form and reloads without the dashboard', async () => {
    const d = deps();
    authFetch.mockImplementation(() => reply(200));
    const { result } = renderHook(() => useCustomerActions(d));
    act(() => result.current.handleAddContact());
    await act(async () => { await result.current.handleSaveContact(); });
    expect(authFetch.mock.calls[0][0]).toContain('/api/customers/c1/contacts');
    expect(authFetch.mock.calls[0][1].method).toBe('POST');
    expect(result.current.showContactModal).toBe(false);
    expect(d.refreshAfterSave).toHaveBeenCalledWith('c1', { dashboard: false });
  });

  it('keeps the contact form open and says why when refused', async () => {
    authFetch.mockImplementation(() => reply(400, { message: 'Name needed' }));
    const { result } = renderHook(() => useCustomerActions(deps()));
    act(() => result.current.handleAddContact());
    await act(async () => { await result.current.handleSaveContact(); });
    expect(result.current.showContactModal).toBe(true);
    expect(window.alert).toHaveBeenCalledWith('Name needed');
  });

  it('asks before deleting a contact', async () => {
    const d = deps();
    const { result } = renderHook(() => useCustomerActions(d));
    await act(async () => { await result.current.handleDeleteContact('k1'); });
    expect(d.setDeleteConfirmation).toHaveBeenCalledWith(expect.objectContaining({ isOpen: true, type: 'contact', id: 'k1' }));
  });

  it('saves the quick note onto the open record', async () => {
    const d = deps();
    authFetch.mockImplementation(() => reply(200, { quickNote: 'Call Monday' }));
    const { result } = renderHook(() => useCustomerActions(d));
    act(() => result.current.setQuickNote('Call Monday'));
    await act(async () => { await result.current.handleSaveQuickNote(); });
    expect(JSON.parse(authFetch.mock.calls[0][1].body)).toEqual({ quickNote: 'Call Monday' });
    expect(d.setSelectedCustomerDetail).toHaveBeenCalledWith({ _id: 'c1', isActive: true, quickNote: 'Call Monday' });
  });

  it('deactivates a customer after confirming, and reports it', async () => {
    const d = deps();
    authFetch.mockImplementation(() => reply(200));
    const { result } = renderHook(() => useCustomerActions(d));
    await act(async () => { await result.current.handleToggleCustomerStatus('c1', true); });
    expect(JSON.parse(authFetch.mock.calls[0][1].body)).toEqual({ isActive: false });
    expect(result.current.accountActionStatus).toEqual({ type: 'success', message: 'Customer deactivated successfully' });
  });

  it('does not reset a password that is blank or not confirmed', async () => {
    const { result } = renderHook(() => useCustomerActions(deps()));
    await act(async () => { await result.current.handleResetCustomerPassword('c1'); });
    expect(authFetch).not.toHaveBeenCalled();
    act(() => result.current.setResetPasswordValue('s3cret'));
    vi.spyOn(window, 'confirm').mockImplementation(() => false);
    await act(async () => { await result.current.handleResetCustomerPassword('c1'); });
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('a reaction reloads the customer', async () => {
    const d = deps();
    authFetch.mockImplementation(() => reply(200));
    const { result } = renderHook(() => useCustomerActions(d));
    await act(async () => { await result.current.handleReaction('v1', 'like'); });
    expect(authFetch.mock.calls[0][0]).toContain('/visits/v1/react');
    expect(d.fetchSingleCustomer).toHaveBeenCalledWith('c1');
  });
});
