// @vitest-environment jsdom
// SalesTabViews: each page shows only on its tab and with its permission, and
// its menu button opens or toggles the side nav as it always did.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// Stand-ins for the lazily loaded pages: each prints its name and its menu button.
const stub = (name: string) => ({ default: (p: { sidebarToggle?: React.ReactNode }) => <div data-testid="page">{name}{p.sidebarToggle}</div> });
vi.mock('../../components/sales/PriceListPanel', () => stub('PriceList'));
vi.mock('../../components/sales/HoldsTab', () => stub('Holds'));
vi.mock('../holds/HoldsTab', () => stub('Holds'));
vi.mock('../../components/sales/freight/FreightTab', () => stub('Freight'));
vi.mock('../../components/sales/permits/PermitsTab', () => stub('Permits'));
vi.mock('../delivery/DeliveryScheduleTab', () => stub('Delivery'));
vi.mock('../routePlanner/RoutePlannerV2', () => stub('RoutePlanner'));
vi.mock('../../components/sales/UserProfileTab', () => stub('Profile'));

const { default: SalesTabViews } = await import('./SalesTabViews');
afterEach(() => cleanup());

const base = (over: Record<string, unknown> = {}) => ({
  ready: true, crmTab: 'pricelist', currentUser: { permissions: ['view_pricelist', 'view_route_planner'] }, theme: 'light',
  isSidebarOpen: false, isMobile: false, onOpenSidebar: vi.fn(), onToggleSidebar: vi.fn(),
  checkInLog: {} as never, locations: [], fetchLocations: () => {}, customersList: [], customerOptions: [], isDropdownLoading: false,
  inventoryRefreshSignal: 0, navOrder: null, onSaveNavOrder: () => {}, canSeeHolds: false, routePlannerOpened: false, routePreselect: null,
  canAddVisits: true, onGoHome: () => {}, onOpenCustomer: () => {}, onCreatePrefilledCustomer: null, onAddVisitForPin: () => {}, onAddResourceForPin: () => {},
  ...over
});

describe('SalesTabViews', () => {
  it('shows the open page when they may see it', async () => {
    render(<SalesTabViews {...base()} />);
    expect((await screen.findByTestId('page')).textContent).toContain('PriceList');
  });
  it('shows nothing until permissions load, or without the permission', () => {
    const { rerender } = render(<SalesTabViews {...base({ ready: false })} />);
    expect(document.body.textContent).toBe('');
    rerender(<SalesTabViews {...base({ currentUser: { permissions: [] } })} />);
    expect(document.body.textContent).toBe('');
    rerender(<SalesTabViews {...base({ crmTab: 'holds', canSeeHolds: false })} />);
    expect(document.body.textContent).toBe('');
  });
  it("the Price List's menu button opens the nav; Freight's toggles it", async () => {
    const p = base();
    const { rerender } = render(<SalesTabViews {...p} />);
    fireEvent.click(await screen.findByRole('button'));
    expect(p.onOpenSidebar).toHaveBeenCalled();
    rerender(<SalesTabViews {...p} crmTab="freight" currentUser={{ permissions: ['view_freight_charges'] }} />);
    expect((await screen.findByTestId('page')).textContent).toContain('Freight');
    fireEvent.click(screen.getByRole('button'));
    expect(p.onToggleSidebar).toHaveBeenCalled();
  });
  it('no menu button while the side nav is docked open on desktop', async () => {
    render(<SalesTabViews {...base({ isSidebarOpen: true })} />);
    await screen.findByTestId('page');
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('the Route Planner stays mounted, hidden, once opened', async () => {
    render(<SalesTabViews {...base({ routePlannerOpened: true, crmTab: 'pricelist' })} />);
    const planner = await screen.findByText('RoutePlanner');
    expect(planner.parentElement!.style.display).toBe('none');
    expect(screen.getByText('PriceList')).toBeTruthy();
  });
});
