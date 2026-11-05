// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductProvider } from './ProductProvider';
import { useProducts } from './ProductContext';

const auth = vi.hoisted(() => ({ user: null as { id: string; type: string; role?: string; permissions?: string[] } | null, loading: false }));
vi.mock('./AuthContext', () => ({ useAuth: () => auth }));
const request = vi.fn<typeof fetch>();
const product = { id: 1, name: 'Lincoln', category: 'Quartz', image: '/slab.jpg', availability: 'In Stock', price: '$25', cost: 10, priceLevels: { retail: 25 } };
function Consumer() {
  const { products, loading, error, refreshProducts } = useProducts();
  return <><output data-testid="products">{JSON.stringify(products)}</output><p>{loading ? 'Loading' : 'Ready'}</p>{error && <p role="alert">{error}</p>}<button onClick={refreshProducts}>Refresh</button></>;
}
const tree = () => <ProductProvider><Consumer /></ProductProvider>;
beforeEach(() => { auth.user = null; auth.loading = false; localStorage.clear(); request.mockReset(); vi.stubGlobal('fetch', request); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Product provider', () => {
  it('sanitizes old cached prices before rendering and waits for authentication', () => {
    auth.loading = true; localStorage.setItem('cached_products', JSON.stringify([product]));
    render(tree());
    expect(screen.getByTestId('products').textContent).toContain('Lincoln');
    expect(screen.getByTestId('products').textContent).not.toContain('price');
    expect(localStorage.getItem('cached_products')).not.toContain('cost');
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['not-json', '{}'])('tolerates invalid cache data: %s', cached => {
    auth.loading = true; localStorage.setItem('cached_products', cached);
    render(tree()); expect(screen.getByTestId('products').textContent).toBe('[]');
  });
  it('uses current prices in memory while persisting only public fields', async () => {
    request.mockResolvedValue(Response.json([product])); render(tree());
    await screen.findByText('Ready');
    expect(screen.getByTestId('products').textContent).toContain('"price":"$25"');
    const cached = JSON.parse(localStorage.getItem('cached_products')!);
    expect(cached[0]).toMatchObject({ id: 1, name: 'Lincoln' });
    expect(cached[0]).not.toHaveProperty('price');
    expect(cached[0]).not.toHaveProperty('cost');
    expect(cached[0]).not.toHaveProperty('priceLevels');
  });
  it.each(['server', 'network'])('keeps cached products usable on a %s failure', async kind => {
    localStorage.setItem('cached_products', JSON.stringify([product]));
    if (kind === 'server') request.mockResolvedValue(new Response('', { status: 503 }));
    else request.mockRejectedValue(new Error('offline'));
    render(tree());
    expect((await screen.findByRole('alert')).textContent).toBe(kind === 'server' ? 'Failed to fetch products' : 'Connection error');
    expect(screen.getByTestId('products').textContent).toContain('Lincoln');
  });
  it('retries on refresh and clears a previous error', async () => {
    request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json([product]));
    render(tree()); await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByTestId('products').textContent).toContain('Lincoln');
  });
  it('ignores an old account response after logout and strips its prices immediately', async () => {
    auth.user = { id: 'u1', type: 'internal', permissions: ['view_product_prices'] };
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    request.mockResolvedValueOnce(Response.json([product]))
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
    const { rerender } = render(tree()); await screen.findByText('Ready');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    auth.user = null; rerender(tree());
    expect(screen.getByTestId('products').textContent).not.toContain('"price"');
    await act(async () => { resolveOld(Response.json([{ ...product, price: '$999' }])); });
    expect(screen.getByTestId('products').textContent).not.toContain('$999');
    await act(async () => { resolveNew(Response.json([{ id: 1, name: 'Public Lincoln' }])); });
    expect(screen.getByTestId('products').textContent).toContain('Public Lincoln');
    expect(screen.getByTestId('products').textContent).not.toContain('"price"');
  });
});
