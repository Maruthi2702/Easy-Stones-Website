// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { useTeamFiles } from './useTeamFiles';
import TeamFilesPage from './TeamFilesPage';

const request = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock('../../api/authFetch', () => ({ authFetch: request }));
const rows = [
  { _id: 'f1', name: 'Price List.pdf', type: 'file', createdAt: '2026-10-01', uploadedBy: { username: 'alex' } },
  { _id: 'd1', name: 'Training', type: 'folder', isFolder: true, createdAt: '2026-10-01' }
];
function deps(active = true) {
  return { active, resourceRefreshTrigger: 0, setIsSaving: vi.fn(), fetchDashboardData: vi.fn(), fetchDashboardStats: vi.fn(), setDeleteConfirmation: vi.fn() };
}
beforeEach(() => { request.mockReset(); request.mockImplementation(async () => Response.json(rows)); vi.spyOn(window, 'alert').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Team Files page', () => {
  function Harness() {
    const files = useTeamFiles(deps());
    return <><TeamFilesPage files={files} sidebarToggle={<button>Menu</button>} />{files.showDashboardUploadModal && <p>Upload form open</p>}{files.showAddFolderModal && <p>Folder form open</p>}</>;
  }
  it('lists real files, filters names, and clears search', async () => {
    render(<Harness />); await screen.findByText('Price List.pdf');
    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search this folder'), { target: { value: 'PRICE' } });
    expect(screen.getByText('Price List.pdf')).toBeTruthy();
    expect(screen.queryByText('Training')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Training')).toBeTruthy();
  });
  it('opens folders with their parent ID and returns home', async () => {
    render(<Harness />); fireEvent.click(await screen.findByText('Training'));
    await waitFor(() => expect(request.mock.calls.some(([url]) => String(url).endsWith('?parentId=d1'))).toBe(true));
    fireEvent.click(screen.getByText('Home'));
    await waitFor(() => expect(String(request.mock.calls.at(-1)?.[0])).toMatch(/\/resources$/));
    expect(screen.queryByText('Back')).toBeNull();
  });
  it('opens upload and folder creation, and refreshes the list', async () => {
    render(<Harness />); await screen.findByText('Price List.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(screen.getByText('Upload form open')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));
    expect(screen.getByText('Folder form open')).toBeTruthy();
    const count = request.mock.calls.length;
    fireEvent.click(screen.getByTitle('Refresh Files'));
    await waitFor(() => expect(request.mock.calls.length).toBe(count + 1));
  });
  it('opens edit without opening a file preview', async () => {
    render(<Harness />);
    const row = (await screen.findByText('Price List.pdf')).closest('tr')!;
    fireEvent.click(within(row).getByTitle('Edit'));
    expect(screen.getByText('Upload form open')).toBeTruthy();
    expect(request.mock.calls.some(([url]) => String(url).endsWith('/resources/f1'))).toBe(false);
  });
  it('offers an upload action for an empty folder', async () => {
    request.mockResolvedValue(Response.json([])); render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload your first file' }));
    expect(screen.getByText('Upload form open')).toBeTruthy();
  });
});

describe('Team Files operations', () => {
  it('loads only while active, and reloads after a live resource update', async () => {
    const initial = deps(false);
    const { result, rerender } = renderHook(props => useTeamFiles(props), { initialProps: initial });
    expect(request).not.toHaveBeenCalled();
    rerender({ ...initial, active: true });
    await waitFor(() => expect(result.current.salesResources).toHaveLength(2));
    rerender({ ...initial, active: true, resourceRefreshTrigger: 1 });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
  it.each([
    [{ name: 'PDF', type: 'file', content: '', file: null }, 'Please select a file'],
    [{ name: '', type: 'link', content: 'https://example.com', file: null }, 'Please provide a name'],
    [{ name: 'Link', type: 'link', content: '', file: null }, 'Please provide a URL']
  ])('validates uploads before making a request', async (form, error) => {
    const { result } = renderHook(() => useTeamFiles(deps(false)));
    act(() => result.current.setDashboardUploadForm(form));
    await act(async () => result.current.handleDashboardUpload({ preventDefault: vi.fn() }));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining(error));
    expect(request).not.toHaveBeenCalled();
  });
  it('uploads a link and refreshes dashboard data', async () => {
    const dependencies = deps(false);
    const { result } = renderHook(() => useTeamFiles(dependencies));
    act(() => { result.current.setShowDashboardUploadModal(true); result.current.setDashboardUploadForm({ name: 'Catalog', type: 'link', content: 'https://example.com/catalog', file: null }); });
    await act(async () => result.current.handleDashboardUpload({ preventDefault: vi.fn() }));
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('/api/sales-dashboard/upload');
    expect(options?.method).toBe('POST');
    expect((options?.body as FormData).get('content')).toBe('https://example.com/catalog');
    expect(result.current.showDashboardUploadModal).toBe(false);
    expect(dependencies.fetchDashboardData).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchDashboardStats).toHaveBeenCalledTimes(1);
    expect(dependencies.setIsSaving.mock.calls.map(call => call[0])).toEqual([true, false]);
  });
  it('edits file metadata without requiring a replacement file', async () => {
    const { result } = renderHook(() => useTeamFiles(deps(false)));
    act(() => result.current.handleEditDashboardResource(rows[0]));
    await act(async () => result.current.handleDashboardUpload({ preventDefault: vi.fn() }));
    expect(request.mock.calls[0]).toEqual(['/api/sales-dashboard/resources/f1', expect.objectContaining({ method: 'PUT', body: expect.any(FormData) })]);
    expect((request.mock.calls[0][1]?.body as FormData).has('file')).toBe(false);
  });
  it('reports upload failures without dismissing the form', async () => {
    request.mockResolvedValue(Response.json({ message: 'Upload denied' }, { status: 403 }));
    const dependencies = deps(false);
    const { result } = renderHook(() => useTeamFiles(dependencies));
    act(() => { result.current.setShowDashboardUploadModal(true); result.current.setDashboardUploadForm({ name: 'Catalog', type: 'link', content: 'https://example.com', file: null }); });
    await act(async () => result.current.handleDashboardUpload({ preventDefault: vi.fn() }));
    expect(window.alert).toHaveBeenCalledWith('Failed to upload resource: Upload denied');
    expect(result.current.showDashboardUploadModal).toBe(true);
    expect(dependencies.setIsSaving).toHaveBeenLastCalledWith(false);
  });
  it('requires a nonblank folder name and creates a folder under its parent', async () => {
    const { result } = renderHook(() => useTeamFiles(deps(false)));
    await act(async () => result.current.handleCreateFolder());
    expect(request).not.toHaveBeenCalled();
    act(() => { result.current.setFolderName('  Quotes  '); result.current.setCurrentFolderId('parent'); });
    await act(async () => result.current.handleCreateFolder());
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ name: 'Quotes', type: 'folder', isFolder: true, parentId: 'parent' });
  });
  it('lazily fetches file content once and caches it for preview', async () => {
    request.mockImplementation(async url => Response.json(String(url).endsWith('/f1') ? { ...rows[0], content: 'data:application/pdf;base64,AA==' } : rows));
    const { result } = renderHook(() => useTeamFiles(deps(true)));
    await waitFor(() => expect(result.current.salesResources).toHaveLength(2));
    await act(async () => result.current.handleResourceClick(result.current.salesResources[0]));
    expect(result.current.previewDashboardResource?.content).toContain('data:application/pdf');
    const count = request.mock.calls.length;
    await act(async () => result.current.handleResourceClick(result.current.salesResources[0]));
    expect(request).toHaveBeenCalledTimes(count);
  });
  it('requests confirmation before deletion without deleting immediately', async () => {
    const dependencies = deps(false);
    const { result } = renderHook(() => useTeamFiles(dependencies));
    await act(async () => result.current.handleDeleteDashboardResource('f1'));
    expect(dependencies.setDeleteConfirmation).toHaveBeenCalledWith(expect.objectContaining({ isOpen: true, id: 'f1', type: 'dashboardResource' }));
    expect(request).not.toHaveBeenCalled();
  });
});
