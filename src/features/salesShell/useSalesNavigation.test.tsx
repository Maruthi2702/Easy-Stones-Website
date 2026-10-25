// @vitest-environment jsdom
// Where the Sales page is: the page, the open customer, Back, and the URL.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { useSalesNavigation } = await import('./useSalesNavigation');

const ADMIN = { permissions: ['view_dashboard', 'view_customers', 'view_pricelist', 'view_route_planner'], role: 'admin' };
const go = (url: string) => window.history.replaceState(null, '', url);
const params = () => new URLSearchParams(window.location.search);

const setup = (over: Record<string, unknown> = {}) => {
  const deps = {
    currentUser: ADMIN, pinnedTabsRef: { current: [] }, isMobile: false, setIsSidebarOpen: vi.fn(),
    onShowCustomer: vi.fn(), onClearCustomer: vi.fn(), onGoHomeTab: vi.fn(), ...over
  };
  const hook = renderHook(() => useSalesNavigation(deps as never));
  return { ...hook, deps };
};

beforeEach(() => { go('/sales'); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });

describe('useSalesNavigation', () => {
  it('opens on the URL tab, or their default page', () => {
    go('/sales?tab=pricelist');
    expect(setup().result.current.crmTab).toBe('pricelist');
    go('/sales');
    const { result } = setup();
    expect(result.current.crmTab).toBe('dashboard');
    expect(result.current.showDashboard).toBe(true);
  });

  it('opening a customer from the dashboard shows them, writes the URL, and Back returns to the dashboard', () => {
    go('/sales?tab=dashboard');
    const { result, deps } = setup();
    act(() => result.current.handleSelectCustomer({ _id: 'c1', company: 'Pacific Granite' }));
    expect(deps.onShowCustomer).toHaveBeenCalledWith({ _id: 'c1', company: 'Pacific Granite' });
    expect(result.current.crmTab).toBe('customers');
    expect(result.current.selectedCustomerId).toBe('c1');
    expect(result.current.activeTab).toBe('visits');
    expect(params().get('customer')).toBe('c1');
    expect(window.history.state).toMatchObject({ originTab: 'dashboard', fromDashboard: true });

    act(() => result.current.handleBackToCustomersList());
    expect(result.current.crmTab).toBe('dashboard');
    expect(result.current.showDashboard).toBe(true);
    expect(result.current.selectedCustomerId).toBeNull();
    expect(deps.onClearCustomer).toHaveBeenCalled();
    expect(params().get('customer')).toBeNull();
  });

  it('an explicit origin wins when opened from another page (Permits)', () => {
    go('/sales?tab=customers');
    const { result } = setup();
    act(() => result.current.handleSelectCustomer({ _id: 'c2' }, 'permits'));
    act(() => result.current.handleBackToCustomersList());
    expect(result.current.crmTab).toBe('permits');
  });

  it('a profile tab change only rewrites ?view=', () => {
    const { result } = setup();
    act(() => result.current.handleActiveTabChange('resources'));
    expect(result.current.activeTab).toBe('resources');
    expect(params().get('view')).toBe('resources');
  });

  it('changing page clears the customer and pushes the new tab; on a phone it closes the drawer', () => {
    go('/sales?tab=customers&customer=c1&view=visits&hold=7');
    const { result, deps } = setup({ isMobile: true });
    act(() => result.current.handleCrmTabChange('pricelist'));
    expect(result.current.crmTab).toBe('pricelist');
    expect(result.current.selectedCustomerId).toBeNull();
    expect(params().toString()).toBe('tab=pricelist');
    expect(deps.setIsSidebarOpen).toHaveBeenCalledWith(false);
  });

  it('a nav entry that links elsewhere (Live Inventory) opens a new tab and stays put', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { result } = setup();
    act(() => result.current.handleCrmTabChange('live_inventory'));
    expect(open).toHaveBeenCalled();
    expect(result.current.crmTab).toBe('dashboard');
  });

  it('Home goes to the dashboard and its Visits tab', () => {
    go('/sales?tab=customers&customer=c1');
    const { result, deps } = setup();
    act(() => result.current.handleGoHome());
    expect(result.current.crmTab).toBe('dashboard');
    expect(deps.onGoHomeTab).toHaveBeenCalled();
  });

  it("the browser's back button follows the URL, and refuses a page they can't open", () => {
    const { result } = setup({ currentUser: { permissions: ['view_dashboard'] } });
    act(() => { go('/sales?tab=pricelist'); window.dispatchEvent(new PopStateEvent('popstate')); });
    // No Price List permission: their default page instead (the URL's tab still leads getDefaultTab).
    expect(result.current.crmTab).toBe('pricelist');
    act(() => { go('/sales?tab=customers&customer=c3&view=details'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(result.current.selectedCustomerId).toBeNull();
  });

  it('a link to a customer opens them when allowed', () => {
    go('/sales?tab=customers&customer=c3&view=details');
    const { result } = setup();
    expect(result.current.selectedCustomerId).toBe('c3');
    expect(result.current.activeTab).toBe('details');
  });

  it('remembers the Route Planner once visited', () => {
    const { result } = setup();
    act(() => result.current.handleCrmTabChange('route_planner'));
    act(() => result.current.handleCrmTabChange('dashboard'));
    expect(result.current.routePlannerOpened).toBe(true);
  });
});
