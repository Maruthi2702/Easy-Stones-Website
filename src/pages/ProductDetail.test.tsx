// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProductDetail from './ProductDetail';

const auth = vi.hoisted(() => ({ user: null as { id: string; type: string; role?: string; permissions?: string[] } | null, loading: false }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
const request = vi.fn<typeof fetch>();
const product = { id: 'p1', name: 'Calacatta Lincoln', category: 'Moda Quartz', availability: 'In Stock', image: '/slab.jpg', price: '$25.00' };
beforeEach(() => { auth.user = null; auth.loading = false; request.mockReset(); vi.stubGlobal('fetch', request); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.style.overflow = ''; });
function page(state?: object, slug = 'calacatta-lincoln') {
  return render(<MemoryRouter initialEntries={[{ pathname: `/product/${slug}`, state }]}><Routes><Route path="/product/:productId" element={<ProductDetail />} /><Route path="/" element={<p>Collection</p>} /></Routes></MemoryRouter>);
}

describe('Product details', () => {
  it.each(['calacatta-lincoln', 'p1'])('loads a product by slug or legacy ID: %s', async slug => {
    request.mockResolvedValue(Response.json([product])); page(undefined, slug);
    expect(await screen.findByRole('heading', { name: product.name })).toBeTruthy();
    expect(screen.getByRole('img', { name: product.name }).getAttribute('src')).toContain('slab.jpg');
    expect(request.mock.calls[0][1]?.credentials).toBe('include');
    fireEvent.click(screen.getByRole('button', { name: /Close Up/ }));
    expect(screen.getByRole('img', { name: product.name }).classList.contains('zoomed')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Full Slab/ }));
    expect(screen.getByRole('img', { name: product.name }).classList.contains('zoomed')).toBe(false);
  });
  it('does not fetch before authentication resolves', () => {
    auth.loading = true; page(); expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: product.name })).toBeNull();
  });
  it('shows an unavailable state for an unknown product', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    request.mockResolvedValue(Response.json([])); page();
    expect(await screen.findByText('This color is not available right now.')).toBeTruthy();
  });
  it('keeps a navigation-state product visible during a failed refresh', async () => {
    request.mockResolvedValue(new Response('', { status: 503 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    page({ product });
    expect(screen.getByRole('heading', { name: product.name })).toBeTruthy();
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(screen.queryByText(product.price)).toBeNull();
  });
  it.each([['guest', false], ['customer', true], ['staff', false], ['permitted', true], ['admin', true]])('gates pricing for %s', async (type, visible) => {
    if (type !== 'guest') auth.user = { id: 'u1', type: type === 'customer' ? 'customer' : 'internal', role: type === 'admin' ? 'admin' : 'sales_rep', permissions: type === 'permitted' ? ['view_product_prices'] : [] };
    request.mockResolvedValue(Response.json([product])); page();
    await screen.findByRole('heading', { name: product.name });
    expect(Boolean(screen.queryByText(product.price))).toBe(visible);
  });
  it('returns to the collection with the original category', async () => {
    request.mockResolvedValue(Response.json([product])); page({ fromCategory: 'Granite' });
    await screen.findByRole('heading', { name: product.name });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Collection')).toBeTruthy();
  });
  it('opens a bundle lightbox, cycles its images, and restores scrolling on close', async () => {
    request.mockResolvedValue(Response.json([{ ...product, bundles: [{ bundleNumber: 'B1', images: ['/one.jpg', '/two.jpg'], location: 'Seattle' }] }]));
    const { container } = page();
    fireEvent.click(await screen.findByRole('img', { name: 'Bundle B1' }));
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('img', { name: 'Bundle B1 View' }).getAttribute('src')).toContain('one.jpg');
    fireEvent.click(container.querySelector('.lightbox-nav-btn.next')!);
    expect(screen.getByRole('img', { name: 'Bundle B1 View' }).getAttribute('src')).toContain('two.jpg');
    fireEvent.click(container.querySelector('.lightbox-nav-btn.next')!);
    expect(screen.getByRole('img', { name: 'Bundle B1 View' }).getAttribute('src')).toContain('one.jpg');
    fireEvent.click(container.querySelector('.lightbox-close')!);
    expect(screen.queryByRole('img', { name: 'Bundle B1 View' })).toBeNull();
    expect(document.body.style.overflow).toBe('auto');
  });
});
