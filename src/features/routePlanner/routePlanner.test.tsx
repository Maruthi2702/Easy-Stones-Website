// @vitest-environment jsdom
// The Route Planner renders: the map's pins, the Filter, Tools with a radius
// draw, Customers, Schedule, a customer opened with the map's actions, the
// "Schedule a visit" sheet, and the no-key notice. Google Maps is faked (the
// loader, the map — which reports its bounds once — and markers as buttons),
// and so is the API.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const pins = [
  { _id: 'c1', company: 'Pacific Granite', city: 'Seattle', coordinates: { lat: 47.61, lng: -122.33 }, salesRep: 'u1', salesRepName: 'Krish', customerType: 'Fabricator', status: 'Onboarded', lastVisitAt: day(-2) },
  { _id: 'c2', company: 'Stone River', city: 'Bellevue', coordinates: { lat: 47.6, lng: -122.2 }, salesRep: 'u2', salesRepName: 'Rita', customerType: 'Contractor', status: 'Onboarded', lastVisitAt: day(-50) },
  { _id: 'c3', company: 'Harbor Floors', city: 'Seattle', coordinates: { lat: 47.65, lng: -122.35 }, customerType: '', status: 'New Lead' }
];
const schedule = [{ _id: 's1', customerId: { _id: 'c1', company: 'Pacific Granite' }, startTime: `${day(0)}T10:00:00.000`, endTime: `${day(0)}T10:45:00.000`, activityType: 'Visit', status: 'Scheduled', notes: 'Bring the binder' }];
const routes: [RegExp, unknown][] = [
  [/\/api\/customers\/map\/rep-counts/, { u1: 1, u2: 1, unassigned: 1 }],
  [/\/api\/customers\/map(\?|$)/, pins],
  [/\/api\/customers\/c1(\?|$)/, { ...pins[0], contactName: 'Vlad', visits: [], contacts: [] }],
  [/\/api\/salesreps/, { data: [{ _id: 'u1', name: 'Krish', username: 'krish', role: 'admin' }, { _id: 'u2', name: 'Rita', username: 'rita', role: 'sales_rep', assignedLocations: ['Seattle'] }] }],
  [/\/api\/admin\/locations/, [{ name: 'Seattle' }]],
  [/\/api\/schedule/, schedule]
];
const calls: string[] = [];
const answer = (url: string) => {
  calls.push(url);
  const hit = routes.find(([re]) => re.test(url));
  return Promise.resolve(new Response(JSON.stringify(hit ? hit[1] : []), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
vi.mock('../../api/authFetch', () => ({ authFetch: (u: string) => answer(u), resetSessionExpiredGuard() {} }));

const gm = vi.hoisted(() => ({
  isLoaded: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: null as any
}));
vi.mock('@react-google-maps/api', async () => {
  const React = await import('react');
  const h = React.createElement;
  const ll = (lat: number, lng: number) => ({ lat: () => lat, lng: () => lng });
  const fakeMap = () => {
    const listeners: Record<string, ((e?: unknown) => void)[]> = {};
    gm.map = {
      listeners,
      addListener(name: string, fn: (e?: unknown) => void) { (listeners[name] ||= []).push(fn); if (name === 'idle') setTimeout(() => fn(), 0); return { name, fn }; },
      getBounds: () => ({ getNorthEast: () => ll(48.2, -121.5), getSouthWest: () => ll(47.0, -123.0) }),
      getCenter: () => null, panTo() {}, panBy() {}, setZoom() {}, setOptions() {}, getDiv: () => ({ clientHeight: 700 })
    };
    return gm.map;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type P = any;
  return {
    useJsApiLoader: () => ({ isLoaded: gm.isLoaded, loadError: undefined }),
    GoogleMap: ({ mapContainerClassName, onLoad, children }: P) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      React.useEffect(() => { onLoad?.(fakeMap()); }, []);
      return h('div', { className: mapContainerClassName }, children);
    },
    Marker: ({ title, onClick }: P) => h('button', { type: 'button', className: 'mk', title, onClick }),
    DirectionsRenderer: () => null,
    TrafficLayer: () => null
  };
});
const googleFake = {
  maps: {
    Size: class { w: number; h: number; constructor(w: number, h: number) { this.w = w; this.h = h; } },
    Point: class { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } },
    SymbolPath: { CIRCLE: 0 },
    TravelMode: { DRIVING: 'DRIVING' },
    event: { trigger() {}, removeListener() {} },
    Circle: class { r: number; constructor(o: { radius: number }) { this.r = o.radius; } setRadius(r: number) { this.r = r; } getRadius() { return this.r; } setMap() {} },
    Polygon: class { setPath() {} setMap() {} },
    DirectionsService: class { route(_r: unknown, cb: (res: unknown, status: string) => void) { cb(null, 'ZERO_RESULTS'); } }
  }
};
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function scrollIntoView() {};

const { RoutePlannerV2 } = await import('./index');

const ADMIN = {
  _id: 'u1', id: 'u1', username: 'krish', name: 'Krish', role: 'admin', location: 'Seattle', assignedLocations: ['*'],
  permissions: ['view_route_planner', 'create_route_plan', 'edit_route_plan', 'delete_route_plan', 'view_customers', 'view_customer_profile', 'manage_customers']
};
const settle = async () => { for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const open = async (user: Record<string, unknown> = ADMIN) => {
  const r = render(<RoutePlannerV2 currentUser={user} theme="dark" onOpenCustomer={() => {}} onAddVisit={() => {}} onAddResource={() => {}} />);
  await settle();
  return r;
};
const marker = (name: string) => [...document.querySelectorAll('button.mk')].find((e) => e.getAttribute('title')?.startsWith(name)) as Element;
const mapEvent = (name: string, e?: unknown) => act(() => { gm.map.listeners[name]?.slice().forEach((fn: (e?: unknown) => void) => fn(e)); });
const at = (lat: number, lng: number) => ({ latLng: { lat: () => lat, lng: () => lng } });

beforeEach(() => {
  gm.isLoaded = true; calls.length = 0;
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key');
  (window as unknown as { google: unknown }).google = googleFake;
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* */ }
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); delete (window as unknown as { google?: unknown }).google; });

describe('Route Planner', () => {
  it('loads the checked reps’ customers and draws a pin for each', async () => {
    await open();
    expect(calls.some((u) => /\/api\/customers\/map\?reps=/.test(u))).toBe(true);
    for (const name of ['Pacific Granite', 'Stone River', 'Harbor Floors']) expect(marker(name)).toBeTruthy();
    expect(screen.getByLabelText('Selection tools')).toBeTruthy();
  });

  it('opens the Filter with reps, types and visit ages', async () => {
    await open();
    fireEvent.click(screen.getByLabelText('Filter customers'));
    expect(screen.getByText('Filter by')).toBeTruthy();
    expect(screen.getByText('Sales reps')).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
    expect(screen.getByText('Days since last visit')).toBeTruthy();
  });

  it('Tools: a radius draw selects and numbers the stops; Schedule shows the day', async () => {
    await open();
    fireEvent.click(screen.getByLabelText('Selection tools'));
    expect(screen.getByText('Nothing selected yet.')).toBeTruthy();
    fireEvent.click(screen.getByText('Radius'));
    mapEvent('mousedown', at(47.61, -122.3));
    mapEvent('mousemove', at(47.61, -122.05));
    mapEvent('mouseup');
    await settle();
    expect(screen.getByText('Selected customers (3)')).toBeTruthy();
    expect(screen.getByText('Stop 1')).toBeTruthy();
    fireEvent.click(screen.getByText('Schedule'));
    expect(screen.getByText(/Put 3 stops on/)).toBeTruthy();
  });

  it('Customers and Schedule panels', async () => {
    await open();
    fireEvent.click(screen.getByLabelText('Customers'));
    expect(screen.getByPlaceholderText('Search by name, city, or sales rep')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Schedule'));
    expect(screen.getByText('Bring the binder')).toBeTruthy();
    expect(screen.getByText('1 today')).toBeTruthy();
  });

  it('a pin opens the shared customer panel with the map’s actions, and Add to calendar opens the sheet', async () => {
    await open();
    fireEvent.click(marker('Pacific Granite'));
    await settle();
    expect(screen.getByText('Reschedule')).toBeTruthy();
    expect(screen.getByText('Remove from calendar')).toBeTruthy();
    cleanup();
    await open();
    fireEvent.click(marker('Harbor Floors'));
    await settle();
    fireEvent.click(screen.getByText('Add to calendar'));
    await settle();
    expect(screen.getByText('Schedule a visit')).toBeTruthy();
  });

  it('without a Maps key it says so instead of drawing a map', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    await open();
    expect(screen.getByText('The map needs a Google Maps key')).toBeTruthy();
  });
});
