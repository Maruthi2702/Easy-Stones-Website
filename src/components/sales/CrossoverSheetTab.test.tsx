// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CrossoverSheetTab from './CrossoverSheetTab';

const request = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock('../../api/authFetch', () => ({ authFetch: request }));
const documents = [{ _id: 'c1', easyStonesName: 'Lincoln', crossovers: [{ _id: 'm1', distributorName: 'Other Stone', distributorColorName: 'Alpine White', matchType: 'Exact', notes: 'Same pattern' }] }];
const colors = [{ _id: 'e1', name: 'Lincoln' }, { _id: 'e2', name: 'Nero' }];
beforeEach(() => { request.mockReset(); request.mockImplementation(async url => Response.json(String(url).endsWith('/easy-stones-colors') ? colors : documents)); localStorage.clear(); vi.spyOn(window, 'confirm').mockReturnValue(true); vi.spyOn(window, 'alert').mockImplementation(() => {}); vi.spyOn(window, 'print').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const page = (permissions: string[] = []) => render(<CrossoverSheetTab currentUser={{ role: 'sales_rep', permissions }} />);

describe('Crossover Sheet page', () => {
  it('renders distributor mappings in matrix and list views', async () => {
    page(); await screen.findAllByText('Alpine White');
    expect(screen.getAllByText('Lincoln').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTitle('List View'));
    expect(screen.getAllByText('Other Stone').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Same pattern').length).toBeGreaterThan(0);
  });
  it('filters mapping names and clears an empty search result', async () => {
    page(); await screen.findAllByText('Alpine White');
    fireEvent.change(screen.getByPlaceholderText('Search distributor, color, or crossover name...'), { target: { value: 'not-a-color' } });
    expect(screen.queryByText('Alpine White')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear Filters' })[0]);
    expect(screen.getAllByText('Alpine White').length).toBeGreaterThan(0);
  });
  it('fails closed when the user is unknown', async () => {
    render(<CrossoverSheetTab />); await screen.findAllByText('Alpine White');
    expect(screen.queryByRole('button', { name: /Add Crossover/ })).toBeNull();
    expect(screen.queryByTitle('Manage Easy Stones Colors')).toBeNull();
    expect(screen.queryByTitle('Delete Entry')).toBeNull();
    expect((screen.getByTitle('Same pattern') as HTMLButtonElement).disabled).toBe(true);
  });
  it('grants create, edit, delete and color management independently', async () => {
    page(['add_crossover_sheet']); await screen.findAllByText('Alpine White');
    expect(screen.getByRole('button', { name: /Add Crossover/ })).toBeTruthy();
    expect(screen.queryByTitle('Delete Entry')).toBeNull();
    expect(screen.queryByTitle('Manage Easy Stones Colors')).toBeNull();
    expect((screen.getByTitle('Same pattern') as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not delete when confirmation is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    page(['delete_crossover_sheet']); await screen.findAllByText('Alpine White');
    fireEvent.click(screen.getByTitle('Delete Entry'));
    expect(request.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  });
  it('keeps a mapping when deletion fails', async () => {
    request.mockImplementation(async (url, options) => options?.method === 'DELETE' ? new Response('', { status: 403 }) : Response.json(String(url).endsWith('/easy-stones-colors') ? colors : documents));
    page(['delete_crossover_sheet']); await screen.findAllByText('Alpine White');
    fireEvent.click(screen.getByTitle('Delete Entry'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Failed to delete crossover entry'));
    expect(screen.getAllByText('Alpine White').length).toBeGreaterThan(0);
  });
  it('prints the sheet on request', async () => {
    page(); await screen.findAllByText('Alpine White');
    fireEvent.click(screen.getByTitle('Print / Save as PDF'));
    expect(window.print).toHaveBeenCalledTimes(1);
  });
  it('patches a confirmed deletion locally without fetching the full sheet again', async () => {
    page(['delete_crossover_sheet']); await screen.findAllByText('Alpine White');
    const count = request.mock.calls.filter(([url]) => String(url).endsWith('/crossover-sheet')).length;
    fireEvent.click(screen.getByTitle('Delete Entry'));
    await waitFor(() => expect(screen.queryByText('Alpine White')).toBeNull());
    expect(request).toHaveBeenCalledWith(expect.stringMatching(/\/crossover-sheet\/c1\/m1$/), { method: 'DELETE' });
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/crossover-sheet')).length).toBe(count);
  });
});
