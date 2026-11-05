// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LostSalesTab from './LostSalesTab';

const request = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock('../../api/authFetch', () => ({ authFetch: request }));
const records = [
  { _id: 'ls1', customerName: 'Harbor Stone', productName: 'Lincoln', salesRepName: 'Alex', location: 'Seattle', reason: 'Price', totalLostValue: 1200, slabsCount: 2, date: '2026-10-01', notes: 'Budget too low' },
  { _id: 'ls2', customerName: 'Alpine', productName: 'Nero', salesRepName: 'Sam', location: 'Seattle', reason: 'Availability', totalLostValue: 500, slabsCount: 1, date: '2026-10-02' }
];
const reader = { id: 'u1', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'], permissions: ['view_lost_sales'] };
beforeEach(() => { request.mockReset(); request.mockImplementation(async () => Response.json(records)); localStorage.clear(); vi.spyOn(window, 'confirm').mockReturnValue(true); vi.spyOn(window, 'alert').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const page = (permissions: string[] = reader.permissions) => render(<LostSalesTab currentUser={{ ...reader, permissions }} locationsList={['Seattle', 'Spokane']} />);

describe('Lost Sales page', () => {
  it('loads opportunities and searches customer, product, rep and notes', async () => {
    page(); await screen.findAllByText('Harbor Stone');
    for (const query of ['Harbor', 'Lincoln', 'Budget too low']) {
      fireEvent.change(screen.getByPlaceholderText('Search customer, product, rep...'), { target: { value: query } });
      expect(screen.getAllByText('Harbor Stone').length).toBeGreaterThan(0);
      expect(screen.queryByText('Alpine')).toBeNull();
    }
  });
  it('resets an unsuccessful search', async () => {
    page(); await screen.findAllByText('Harbor Stone');
    fireEvent.change(screen.getByPlaceholderText('Search customer, product, rep...'), { target: { value: 'absent' } });
    expect(screen.getAllByText('No Matching Lost Sales').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /Clear|Reset/i }).find(button => button.classList.contains('btn-clear-filters-empty'))!);
    expect(screen.getAllByText('Harbor Stone').length).toBeGreaterThan(0);
  });
  it('hides mutation actions for viewers', async () => {
    page(); await screen.findAllByText('Harbor Stone');
    expect(screen.queryByRole('button', { name: /Record Lost Sale/ })).toBeNull();
    expect(screen.queryByTitle('Edit Opportunity')).toBeNull();
    expect(screen.queryByTitle('Delete Opportunity')).toBeNull();
  });
  it('grants edit and delete independently', async () => {
    page(['view_lost_sales', 'edit_lost_sales']); await screen.findAllByText('Harbor Stone');
    expect(screen.getByRole('button', { name: /Record Lost Sale/ })).toBeTruthy();
    expect(screen.getAllByTitle('Edit Opportunity')).toHaveLength(2);
    expect(screen.queryByTitle('Delete Opportunity')).toBeNull();
  });
  it('cancels deletion without making a request', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    page(['delete_lost_sales']); await screen.findAllByText('Harbor Stone');
    fireEvent.click(screen.getAllByTitle('Delete Opportunity')[0]);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  });
  it('removes a confirmed deletion and retains the other opportunity', async () => {
    page(['delete_lost_sales']); await screen.findAllByText('Harbor Stone');
    const row = screen.getAllByText('Harbor Stone')[0].closest('tr')!;
    fireEvent.click(row.querySelector('[title="Delete Opportunity"]')!);
    await waitFor(() => expect(screen.queryByText('Harbor Stone')).toBeNull());
    expect(request).toHaveBeenCalledWith(expect.stringMatching(/\/lost-sales\/ls1$/), { method: 'DELETE' });
    expect(screen.getAllByText('Alpine').length).toBeGreaterThan(0);
  });
  it('keeps the record and reports a failed deletion', async () => {
    request.mockImplementation(async (_url, options) => options?.method === 'DELETE' ? new Response('', { status: 403 }) : Response.json(records));
    page(['delete_lost_sales']); await screen.findAllByText('Harbor Stone');
    fireEvent.click(screen.getAllByTitle('Delete Opportunity')[0]);
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Failed to delete lost sale record'));
    expect(screen.getAllByText('Harbor Stone').length).toBeGreaterThan(0);
  });
  it('shows the initial empty state when no opportunities exist', async () => {
    request.mockResolvedValue(Response.json([])); page();
    expect((await screen.findAllByText('No Lost Sales Recorded Yet')).length).toBeGreaterThan(0);
  });
});
