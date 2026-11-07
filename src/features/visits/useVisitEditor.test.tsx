// @vitest-environment jsdom
// The visit form's save: closes at once and sends behind it, shows the visit
// ahead of the answer, and gives the form back with everything typed if it fails.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import type { ChangeEvent } from 'react';

const authFetch = vi.fn();
vi.mock('../../api/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
const { compressImage, fileToBase64 } = vi.hoisted(() => ({ compressImage: vi.fn(), fileToBase64: vi.fn() }));
vi.mock('../../utils/attachmentFiles', () => ({ compressImage, fileToBase64 }));

const { useVisitEditor } = await import('./useVisitEditor');

const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const deps = () => ({
  currentUser: { _id: 'u1', username: 'krish' }, selectedCustomerId: null, selectedCustomer: null,
  customers: [{ _id: 'c1', company: 'Pacific Granite', contactName: 'Max', location: 'Seattle' }], customerOptions: [],
  patchOpenCustomerVisits: vi.fn(), removeOpenCustomerVisit: vi.fn(), patchDashboardVisit: vi.fn(), removeDashboardVisit: vi.fn(),
  setCurrentFollowUpPage: vi.fn(), showSaveToast: vi.fn(), refreshVisits: vi.fn(), setDeleteConfirmation: vi.fn()
});
const filled = { date: '2026-10-20', purpose: 'Scheduled in Person Sales Meeting', notes: 'Met Vlad', customerId: 'c1', image: [] };

beforeEach(() => {
  authFetch.mockReset(); compressImage.mockReset(); fileToBase64.mockReset();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const picked = (type = 'image/jpeg') => ({ target: { files: [new File(['file'], type === 'application/pdf' ? 'visit.pdf' : 'visit.jpg', { type })] } }) as unknown as ChangeEvent<HTMLInputElement>;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

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
    expect(d.refreshVisits).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledTimes(1);
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

  it.each(['image/jpeg', 'application/pdf'])('waits for %s preparation and saves its uploaded link', async type => {
    const preparing = deferred<string>();
    const uploading = deferred<Response>();
    const data = `data:${type};base64,AAAA`;
    const link = 'https://cdn.example/visit-file';
    (type === 'application/pdf' ? fileToBase64 : compressImage).mockReturnValue(preparing.promise);
    authFetch.mockImplementation((url: string) => url.endsWith('visit-attachments') ? uploading.promise : reply(201, { visit: { _id: 'saved' } }));
    const d = deps();
    const { result } = renderHook(() => useVisitEditor(d));
    act(() => result.current.handleQuickAddVisit());
    let upload!: Promise<void>, save!: Promise<void>;
    act(() => { upload = result.current.handleVisitImageUpload(picked(type)); });
    expect(result.current.visitUploading).toBe(true);
    act(() => { save = result.current.handleSaveVisit(filled); });
    expect(result.current.showVisitModal).toBe(true);
    expect(result.current.visitSaving).toBe(true);
    expect(authFetch).not.toHaveBeenCalled();
    // A second submit while preparing is ignored.
    await act(async () => { await result.current.handleSaveVisit(filled); });
    await act(async () => { preparing.resolve(data); await upload; });
    expect(result.current.showVisitModal).toBe(false);
    expect(authFetch).toHaveBeenCalledTimes(1); // upload only; no visit POST yet
    await act(async () => { uploading.resolve(new Response(JSON.stringify({ url: link }))); await save; });
    expect(authFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(authFetch.mock.calls[1][1].body).image).toEqual([link]);
    expect(d.showSaveToast).toHaveBeenCalledWith('Visit saved');
  });

  it('sends the original attachment with Save if its early upload fails', async () => {
    const data = 'data:image/jpeg;base64,AAAA';
    compressImage.mockResolvedValue(data);
    authFetch.mockImplementation((url: string) => url.endsWith('visit-attachments') ? reply(502, {}) : reply(201, { visit: { _id: 'saved' } }));
    const { result } = renderHook(() => useVisitEditor(deps()));
    act(() => result.current.handleQuickAddVisit());
    act(() => result.current.setVisitForm(filled));
    await act(async () => { await result.current.handleVisitImageUpload(picked()); });
    await act(async () => { await result.current.handleSaveVisit(result.current.visitForm); });
    expect(JSON.parse(authFetch.mock.calls[1][1].body).image).toEqual([data]);
  });

  it('keeps late file preparation out of a different visit form', async () => {
    const preparing = deferred<string>();
    compressImage.mockReturnValue(preparing.promise);
    const { result } = renderHook(() => useVisitEditor(deps()));
    act(() => result.current.handleQuickAddVisit());
    let upload!: Promise<void>;
    act(() => { upload = result.current.handleVisitImageUpload(picked()); });
    act(() => result.current.handleCloseVisitModal());
    act(() => result.current.handleQuickAddVisit());
    await act(async () => { preparing.resolve('data:image/jpeg;base64,AAAA'); await upload; });
    expect(result.current.visitForm.image).toEqual([]);
    expect(result.current.visitUploading).toBe(false);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('reuses the visit ID for automatic and manual retries after lost responses', async () => {
    vi.useFakeTimers();
    authFetch.mockRejectedValue(new Error('Response lost'));
    const d = deps();
    const { result } = renderHook(() => useVisitEditor(d));
    act(() => result.current.handleQuickAddVisit());
    let save!: Promise<void>;
    act(() => { save = result.current.handleSaveVisit(filled); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); await save; });
    expect(result.current.showVisitModal).toBe(true);
    expect(result.current.visitSaving).toBe(false);
    expect(d.refreshVisits).toHaveBeenCalledTimes(1);
    const first = JSON.parse(authFetch.mock.calls[0][1].body);
    expect(JSON.parse(authFetch.mock.calls[1][1].body)._id).toBe(first._id);
    authFetch.mockImplementation(() => reply(200, { alreadySaved: true, visit: { ...first } }));
    await act(async () => { await result.current.handleSaveVisit(result.current.visitForm); });
    expect(JSON.parse(authFetch.mock.calls[2][1].body)._id).toBe(first._id);
    act(() => result.current.handleQuickAddVisit());
    await act(async () => { await result.current.handleSaveVisit(filled); });
    expect(JSON.parse(authFetch.mock.calls[3][1].body)._id).not.toBe(first._id);
  });

  it('retries an unreadable success response with the same ID before confirming', async () => {
    vi.useFakeTimers();
    const d = deps();
    authFetch.mockResolvedValueOnce(new Response('{', { status: 201 }));
    authFetch.mockImplementation(() => reply(200, { visit: { _id: 'saved' } }));
    const { result } = renderHook(() => useVisitEditor(d));
    act(() => result.current.handleQuickAddVisit());
    let save!: Promise<void>;
    act(() => { save = result.current.handleSaveVisit(filled); });
    expect(d.showSaveToast).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); await save; });
    expect(authFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(authFetch.mock.calls[1][1].body)._id).toBe(JSON.parse(authFetch.mock.calls[0][1].body)._id);
    expect(d.showSaveToast).toHaveBeenCalledTimes(1);
    expect(d.showSaveToast).toHaveBeenCalledWith('Visit saved');
  });
});
