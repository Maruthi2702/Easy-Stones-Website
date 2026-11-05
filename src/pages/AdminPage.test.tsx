// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminPage from './AdminPage';

const mocks = vi.hoisted(() => ({ request: vi.fn<typeof fetch>(), refreshProducts: vi.fn(), logout: vi.fn(), setAuthToken: vi.fn() }));
vi.mock('../api/authFetch', () => ({ authFetch: mocks.request }));
vi.mock('../api/authToken', () => ({ setAuthToken: mocks.setAuthToken }));
vi.mock('../context/ProductContext', () => ({ useProducts: () => ({ refreshProducts: mocks.refreshProducts }) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout: mocks.logout }) }));
const products = [
  { id: 1, name: 'Lincoln', category: 'Quartz', collection: 'Basic', availability: 'In Stock', image: '/lincoln.jpg', thickness: ['3CM'], sizes: [], finishes: ['Polished'], applications: ['Countertops'] },
  { id: 2, name: 'Nero', category: 'Granite', collection: 'Luxe', availability: 'In Stock', image: '/nero.jpg' }
];
beforeEach(() => {
  vi.clearAllMocks(); mocks.request.mockReset(); window.history.replaceState({}, '', '/admin');
  mocks.request.mockImplementation(async (url, options) => {
    const path = String(url);
    if (options?.method === 'POST') return Response.json({ success: true, token: 'rotated' });
    if (path.endsWith('/products/list')) return Response.json(products);
    if (path.endsWith('/products/1')) return Response.json(products[0]);
    if (path.endsWith('/products/2')) return Response.json(products[1]);
    if (path.endsWith('/users')) return Response.json([{ _id: 'u1', username: 'alex', name: 'Alex', role: 'sales_rep', assignedLocations: ['Seattle'] }]);
    return Response.json([]);
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const page = () => render(<MemoryRouter><AdminPage /></MemoryRouter>);

describe('Admin page', () => {
  it('loads and filters the product list', async () => {
    page(); await screen.findByText('Lincoln');
    fireEvent.change(screen.getByPlaceholderText('Search products...'), { target: { value: 'lin' } });
    expect(screen.getByText('Lincoln')).toBeTruthy();
    expect(screen.queryByText('Nero')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search products...'), { target: { value: 'absent' } });
    expect(screen.getByText('No products found')).toBeTruthy();
  });
  it('loads full details on selection and persists an edited product', async () => {
    page(); fireEvent.click(await screen.findByText('Lincoln'));
    const name = await screen.findByDisplayValue('Lincoln');
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/products\/1$/)));
    fireEvent.change(name, { target: { value: 'Lincoln Updated' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Changes' })[0]);
    expect(await screen.findByText('Changes saved successfully!')).toBeTruthy();
    const saved = mocks.request.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(String(saved[1]?.body)).products[0].name).toBe('Lincoln Updated');
    expect(mocks.refreshProducts).toHaveBeenCalledTimes(1);
  });
  it('creates a draft product without saving until requested', async () => {
    page(); await screen.findByText('Lincoln');
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByDisplayValue('New Product')).toBeTruthy();
    expect(mocks.request.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Changes' })[0]);
    await screen.findByText('Changes saved successfully!');
    const saved = mocks.request.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(String(saved[1]?.body)).products[0]).toMatchObject({ id: 3, name: 'New Product' });
  });
  it('keeps products when deletion is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    page(); fireEvent.click(await screen.findByText('Lincoln'));
    await screen.findByDisplayValue('Lincoln');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Lincoln')).toBeTruthy();
    expect(mocks.request.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  it('persists the remaining products after a confirmed deletion', async () => {
    page(); fireEvent.click(await screen.findByText('Lincoln')); await screen.findByDisplayValue('Lincoln');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('Changes saved successfully!');
    expect(screen.queryByText('Lincoln')).toBeNull();
    const saved = mocks.request.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(String(saved[1]?.body)).products.map((p: { id: number }) => p.id)).toEqual([2]);
  });
  it('reports save failures without claiming success', async () => {
    mocks.request.mockImplementation(async (_url, options) => options?.method === 'POST' ? Response.json({ success: false, details: 'Storage unavailable' }, { status: 500 }) : Response.json(products));
    page(); await screen.findByText('Lincoln');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Failed to save: Storage unavailable')).toBeTruthy();
    expect(mocks.refreshProducts).not.toHaveBeenCalled();
  });
  it('validates password confirmation in Settings', async () => {
    window.history.replaceState({}, '', '/admin?tab=settings'); page();
    await screen.findByPlaceholderText('Enter current password');
    fireEvent.change(screen.getByPlaceholderText('Enter new password (min 6 characters)'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'different' } });
    fireEvent.submit(document.querySelector('.password-form')!);
    expect(screen.getByText('New passwords do not match')).toBeTruthy();
    expect(mocks.request.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  it('rotates the session token after an administrator changes their password', async () => {
    window.history.replaceState({}, '', '/admin?tab=settings'); page();
    await screen.findByPlaceholderText('Enter current password');
    for (const [placeholder, value] of [['Enter current password', 'old-password'], ['Enter new password (min 6 characters)', 'new-password'], ['Confirm new password', 'new-password']]) {
      fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
    }
    fireEvent.submit(document.querySelector('.password-form')!);
    expect(await screen.findByText('Password changed successfully!')).toBeTruthy();
    expect(mocks.setAuthToken).toHaveBeenCalledWith('rotated');
    expect((screen.getByPlaceholderText('Enter current password') as HTMLInputElement).value).toBe('');
  });
});
