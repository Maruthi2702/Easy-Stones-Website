// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InventoryAnalysisTab from './InventoryAnalysisTab';
import { clearInventoryCache } from '../../api/inventoryAnalysisCache';

const request = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock('../../api/authFetch', () => ({ authFetch: request }));
// The workbench and transit panel have separate suites. This suite exercises
// inventory's data, filters, permissions, and how it selects those workspaces.
vi.mock('../../features/purchasing', () => ({ PurchasingWorkbench: () => <p>Purchasing workspace</p> }));
vi.mock('./InventoryTransitPanel', () => ({ default: () => <p>Transit workspace</p> }));
const summary = { totalItems: 3, totalAssetValue: 12345, distinctProductCount: 1, totalAvailableQty: 180, agingBuckets: [{ _id: 90, count: 3, assetValue: 12345 }] };
const group = { product: 'Calacatta Lincoln', category: 'Quartz', units: 'SF', locations: ['Seattle'], oldestReceivedDate: null, statusCounts: { available: 3 }, slabCount: 3, totalOnHand: 180, totalAvailable: 180, totalAssetValue: 12345 };
function answer(url: Parameters<typeof fetch>[0]) {
  const parsed = new URL(String(url), 'http://localhost');
  if (parsed.pathname.endsWith('/filters')) return { categories: ['Quartz'], locations: ['Seattle', 'Spokane'], statuses: ['available'] };
  if (parsed.pathname.endsWith('/locations')) return [{ name: 'Seattle' }, { name: 'Spokane' }];
  if (parsed.pathname.endsWith('/summary')) return summary;
  if (parsed.pathname.endsWith('/items/grouped')) return { groups: parsed.searchParams.has('search') ? [] : [group], total: parsed.searchParams.has('search') ? 0 : 1 };
  if (parsed.pathname.endsWith('/velocity')) return { rows: [] };
  if (parsed.pathname.endsWith('/items')) return { items: [], total: 0 };
  return {};
}
beforeEach(() => { request.mockReset(); request.mockImplementation(async url => Response.json(answer(url))); clearInventoryCache(); localStorage.clear(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); clearInventoryCache(); vi.restoreAllMocks(); });
const page = (permissions: string[] = []) => render(<InventoryAnalysisTab currentUser={{ id: 'u1', permissions }} />);

describe('Inventory Analysis page', () => {
  it('loads stock groups and scopes the first stock request to company branches', async () => {
    page(); expect(await screen.findByText('Calacatta Lincoln')).toBeTruthy();
    const call = request.mock.calls.find(([url]) => String(url).includes('/items/grouped'))!;
    const query = new URL(String(call[0]), 'http://localhost').searchParams;
    expect(query.get('location')?.split(',').sort()).toEqual(['Seattle', 'Spokane']);
    expect(query.get('page')).toBe('1');
  });
  it('hides imports, purchasing and asset costs unless granted separately', async () => {
    page(); await screen.findByText('Calacatta Lincoln');
    expect(screen.queryByRole('button', { name: /Import Stock/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Purchasing' })).toBeNull();
    expect(document.body.textContent).not.toContain('12,345');
  });
  it('shows authorized asset values', async () => {
    page(['view_inventory_prices']); await screen.findByText('Calacatta Lincoln');
    expect(document.body.textContent).toContain('12,345');
    expect(screen.queryByRole('button', { name: /Import Stock/ })).toBeNull();
  });
  it('opens the real stock import form for an importer', async () => {
    page(['import_inventory_analysis']); await screen.findByText('Calacatta Lincoln');
    fireEvent.click(screen.getByRole('button', { name: /Import Stock/ }));
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain('12,345');
  });
  it('distinguishes an empty database from a filtered result with no matching items', async () => {
    page(); await screen.findByText('Calacatta Lincoln');
    fireEvent.change(screen.getByPlaceholderText('Search product, SKU, supplier, block...'), { target: { value: 'missing-sku' } });
    expect(await screen.findByText('No Matching Items')).toBeTruthy();
    expect(screen.queryByText('No Inventory Data Yet')).toBeNull();
    expect(request.mock.calls.some(([url]) => String(url).includes('search=missing-sku'))).toBe(true);
  });
  it('shows the initial import state when no inventory has been imported', async () => {
    request.mockImplementation(async url => Response.json(String(url).includes('/summary') ? { ...summary, totalItems: 0 } : answer(url)));
    page(); expect(await screen.findByText('No Inventory Data Yet')).toBeTruthy();
  });
  it('fetches individual slabs only after expanding a product and reuses them', async () => {
    page(); const name = await screen.findByText('Calacatta Lincoln');
    const slabsCalls = () => request.mock.calls.filter(([url]) => String(url).includes('/items?'));
    expect(slabsCalls()).toHaveLength(0);
    fireEvent.click(name);
    await screen.findByText('No slabs found for this product under the current filters.');
    expect(slabsCalls()).toHaveLength(1);
    expect(new URL(String(slabsCalls()[0][0]), 'http://localhost').searchParams.get('product')).toBe('Calacatta Lincoln');
    fireEvent.click(name); fireEvent.click(name);
    expect(slabsCalls()).toHaveLength(1);
  });
  it('loads reorder analysis and indicates missing sales history', async () => {
    page(); await screen.findByText('Calacatta Lincoln');
    fireEvent.click(screen.getByRole('button', { name: 'Reorder & Velocity' }));
    expect(await screen.findByText('No Sales History Imported Yet')).toBeTruthy();
    expect(request.mock.calls.some(([url]) => String(url).includes('/velocity?'))).toBe(true);
  });
  it('opens authorized purchasing and transit workspaces', async () => {
    page(['view_purchasing']); await screen.findByText('Calacatta Lincoln');
    fireEvent.click(screen.getByRole('button', { name: 'Purchasing' }));
    expect(screen.getByText('Purchasing workspace')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'In-Transit' }));
    expect(screen.getByText('Transit workspace')).toBeTruthy();
  });
  it('offers a retry after an individual slab request fails', async () => {
    request.mockImplementation(async url => String(url).includes('/items?') ? new Response('', { status: 503 }) : Response.json(answer(url)));
    page(); fireEvent.click(await screen.findByText('Calacatta Lincoln'));
    await waitFor(() => expect(document.body.textContent).toContain('Retry'));
    expect(screen.queryByText('No slabs found for this product under the current filters.')).toBeNull();
  });
});
