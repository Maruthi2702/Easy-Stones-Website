// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';

const auth = vi.hoisted(() => ({ user: null as { type: string; role: string; permissions: string[] } | null, loading: false, passwordSetup: null as object | null, authError: null as string | null, retryAuth: vi.fn() }));
vi.mock('./context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./context/AuthProvider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('./context/ProductProvider', () => ({ ProductProvider: ({ children }: { children: ReactNode }) => children }));
// Route tests deliberately isolate pages. Each real page has its own behavior
// tests; here we verify the app's public aliases and authentication boundary.
vi.mock('./pages/HomePage', () => ({ default: () => <h1>Product collection</h1> }));
vi.mock('./pages/ProductDetail', () => ({ default: () => <h1>Product detail</h1> }));
vi.mock('./pages/ContactPage', () => ({ default: () => <h1>Contact</h1> }));
vi.mock('./pages/WarrantyPage', () => ({ default: () => <h1>Warranty</h1> }));
vi.mock('./pages/CustomerLoginPage', () => ({ default: () => <h1>Portal login</h1> }));
vi.mock('./pages/LoginPage', () => ({ default: () => <h1>Staff login</h1> }));
vi.mock('./pages/SalesPage', () => ({ default: () => <h1>Sales workspace</h1> }));
vi.mock('./pages/AdminPage', () => ({ default: () => <h1>Admin workspace</h1> }));
vi.mock('./pages/ChoosePasswordPage', () => ({ default: () => <h1>Choose password</h1> }));
vi.mock('./pages/SetPasswordPage', () => ({ default: () => <h1>Invitation</h1> }));
vi.mock('./features/checkin/staff/CheckInPage', () => ({ default: ({ isSelfCheckIn }: { isSelfCheckIn?: boolean }) => <h1>{isSelfCheckIn ? 'Self check-in' : 'Staff check-in'}</h1> }));
vi.mock('./features/checkin/CheckInLogPage', () => ({ default: () => <h1>Check-in log</h1> }));
vi.mock('./components/Header', () => ({ default: () => <header>Site header</header> }));
vi.mock('./components/Footer', () => ({ default: () => <footer>Site footer</footer> }));
vi.mock('./components/PresenceReporter', () => ({ default: () => null }));
vi.mock('./components/ScrollToTop', () => ({ default: () => null }));
beforeEach(() => { auth.user = null; auth.loading = false; auth.passwordSetup = null; auth.authError = null; });
afterEach(cleanup);
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function page(path: string) { return render(<MemoryRouter initialEntries={[path]}><App /><Location /></MemoryRouter>); }

describe('App routes and authentication boundary', () => {
  it.each([
    ['/', 'Product collection'], ['/products', 'Product collection'], ['/product/lincoln', 'Product detail'],
    ['/contact', 'Contact'], ['/warranty', 'Warranty'], ['/login', 'Portal login'], ['/customer/login', 'Portal login'],
    ['/admin/login', 'Staff login'], ['/set-password?token=invite', 'Invitation'], ['/admin/set-password?token=invite', 'Invitation'],
    ['/self-checkin', 'Self check-in']
  ])('opens public route %s', async (path, heading) => {
    page(path); expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
  });
  it.each(['/sales?tab=team_files', '/admin', '/checkin', '/checkin-log'])('preserves %s through a login redirect', async path => {
    page(path); await screen.findByRole('heading', { name: 'Portal login' });
    const query = screen.getByTestId('location').textContent!.split('?')[1];
    expect(new URLSearchParams(query).get('redirect')).toBe(path);
  });
  it.each([['/sales', 'Sales workspace'], ['/admin', 'Admin workspace'], ['/checkin', 'Staff check-in'], ['/checkin-log', 'Check-in log']])('opens %s for authenticated staff', async (path, heading) => {
    auth.user = { type: 'internal', role: 'sales_rep', permissions: ['view_dashboard'] };
    page(path); expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
  });
  it('requires a first password before protected pages load', async () => {
    auth.passwordSetup = { username: 'alex' };
    page('/sales');
    expect(await screen.findByRole('heading', { name: 'Choose password' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Sales workspace' })).toBeNull();
  });
  it('keeps customer accounts outside the staff portal', async () => {
    auth.user = { type: 'customer', role: 'customer', permissions: [] };
    page('/sales'); expect(await screen.findByRole('heading', { name: 'Portal login' })).toBeTruthy();
  });
  it('waits for authentication before deciding whether to redirect', () => {
    auth.loading = true; page('/sales');
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/sales');
  });
  it('offers session recovery during a verification outage', () => {
    auth.authError = 'Session service unavailable'; page('/sales');
    expect(screen.getByRole('alert').textContent).toContain('Session service unavailable');
    expect(screen.getByTestId('location').textContent).toBe('/sales');
  });
  it('redirects a staff home visit to Sales', async () => {
    auth.user = { type: 'internal', role: 'sales_rep', permissions: ['view_dashboard'] };
    page('/'); expect(await screen.findByRole('heading', { name: 'Sales workspace' })).toBeTruthy();
  });
  it('sends a check-in-only account to its kiosk instead of Sales', async () => {
    auth.user = { type: 'internal', role: 'kiosk', permissions: ['create_checkins'] };
    page('/sales'); expect(await screen.findByRole('heading', { name: 'Staff check-in' })).toBeTruthy();
  });
  it('recovers unknown URLs to the public home', async () => {
    page('/unknown'); expect(await screen.findByRole('heading', { name: 'Product collection' })).toBeTruthy();
  });
  it('hides marketing navigation on the self check-in kiosk', async () => {
    page('/self-checkin'); await screen.findByRole('heading', { name: 'Self check-in' });
    expect(screen.queryByText('Site header')).toBeNull();
    expect(screen.queryByText('Site footer')).toBeNull();
  });
});
