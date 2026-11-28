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
    Polyline: () => null,
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
    Polygon: class { setPath() {} setMap() {} }
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
    expect(screen.getByText('Days since last visit')).toBeTruthy();
    // Reps are a dropdown (RepFilterPicker): its list holds Unassigned, then
    // the reps under their branch with a count, and stays open while ticking.
    const reps = screen.getByRole('button', { name: 'Sales reps' });
    expect(reps.textContent).toBe('All reps');
    expect(screen.queryByText('Unassigned')).toBeNull();
    fireEvent.click(reps);
    const unassigned = screen.getByRole('checkbox', { name: /Unassigned/ });
    expect(unassigned.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(unassigned);
    expect(screen.getByRole('checkbox', { name: /Unassigned/ }).getAttribute('aria-checked')).toBe('false');
    expect(reps.textContent).toMatch(/^\d+ of \d+ reps$/);
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
    expect(screen.getByText('Customers (3)')).toBeTruthy();
    expect(screen.getByText('Stop 1')).toBeTruthy();
    fireEvent.click(screen.getByText('Schedule'));
    expect(screen.getByText(/Put 3 stops on/)).toBeTruthy();
  });

  it('Tools: the Leads tab lists the found leads inside the drawn area', async () => {
    await open();
    fireEvent.click(screen.getByLabelText('Selection tools'));
    fireEvent.click(screen.getByRole('tab', { name: /Leads \(0\)/ }));
    expect(screen.getByText(/Draw a Radius or Lasso/)).toBeTruthy();
    fireEvent.click(screen.getByText('Radius'));
    mapEvent('mousedown', at(47.61, -122.3));
    mapEvent('mousemove', at(47.61, -122.05));
    mapEvent('mouseup');
    await settle();
    expect(screen.getByText('No leads in this area yet. Search above to find some.')).toBeTruthy();
    expect(screen.getByLabelText('Search for leads inside the drawn area')).toBeTruthy();
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

// The phone's Find new leads (leadsPhone/): ⋯ → Find new leads opens a search bar at the top and
// a sheet of results at the bottom. Places is faked: it answers with whatever `placesAnswer` holds.
describe('Route Planner: Find new leads on a phone', () => {
  const place = (id: string, name: string, lat: number, lng: number, phone = '') => ({
    id, displayName: name, formattedAddress: `1 ${name} St, Kent, WA`, internationalPhoneNumber: phone, types: ['countertop_store'],
    location: { lat: () => lat, lng: () => lng },
    addressComponents: [{ longText: 'Kent', shortText: 'Kent', types: ['locality'] }]
  });
  let placesAnswer: unknown[] = [];
  const searches: unknown[] = [];
  beforeEach(() => {
    placesAnswer = [];
    searches.length = 0;
    (window as unknown as { google: { maps: Record<string, unknown> } }).google.maps.importLibrary = async () => ({
      Place: { searchByText: async (req: unknown) => { searches.push(req); return { places: placesAnswer }; } }
    });
  });
  const openLeads = async () => {
    await open();
    fireEvent.click(screen.getByLabelText('More map options'));
    fireEvent.click(screen.getByText('Find new leads'));
    await settle();
  };
  const searchFor = async (text: string) => {
    const box = screen.getByLabelText('Search for new leads by business type');
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await settle();
  };

  it('opens a search bar under the top edge, not an input inside the menu', async () => {
    await openLeads();
    expect(screen.getByTestId('leads-phone')).toBeTruthy();
    expect(screen.getByText(/the map area on screen/)).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    expect((screen.getByLabelText('Search for new leads by business type') as HTMLInputElement).className).toContain('no-capitalize');
  });

  it('lists what it finds nearest first, and saving keeps the lead on the list as Saved', async () => {
    placesAnswer = [place('p2', 'Far Stone', 47.9, -122.3, '(206) 555-0100'), place('p1', 'Near Stone', 47.601, -122.3)];
    await openLeads();
    await searchFor('countertops');
    expect(screen.getByText('2 leads')).toBeTruthy();
    const names = [...document.querySelectorAll('.lp-nm b')].map((e) => e.textContent);
    expect(names.length).toBe(2);
    expect(searches.length).toBe(1);
    expect(document.querySelectorAll('a[href^="tel:"]').length).toBe(1);
    const before = calls.length;
    fireEvent.click(screen.getByLabelText('Save Far Stone as a lead'));
    await settle();
    expect(calls.length).toBeGreaterThan(before);
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('Far Stone')).toBeTruthy();
  });

  it('opens one lead’s card from its row and goes back to the list', async () => {
    placesAnswer = [place('p1', 'Near Stone', 47.601, -122.3, '(206) 555-0100')];
    await openLeads();
    await searchFor('countertops');
    fireEvent.click(screen.getByText('Near Stone'));
    expect(screen.getByRole('heading', { name: 'Near Stone' })).toBeTruthy();
    expect(screen.getByText('Directions')).toBeTruthy();
    fireEvent.click(screen.getByText('1 lead'));
    expect(screen.getByText('this map area', { exact: false })).toBeTruthy();
  });

  it('says so when nothing matched, and offers another word', async () => {
    await openLeads();
    await searchFor('countertops');
    expect(screen.getByText('No “countertops” found here')).toBeTruthy();
    expect(screen.getByText('stone fabricator')).toBeTruthy();
  });

  // A map the fake can answer questions about: where its centre is and how wide it shows.
  const mapShowing = (widthDeg: number) => {
    gm.map.getCenter = () => ({ lat: () => 47.6, lng: () => -122.3 });
    gm.map.getZoom = () => 13;
    gm.map.getBounds = () => ({ getNorthEast: () => ({ lat: () => 47.7, lng: () => -122.3 + widthDeg / 2 }), getSouthWest: () => ({ lat: () => 47.5, lng: () => -122.3 - widthDeg / 2 }) });
  };
  const milesAcross = (req: unknown) => {
    const b = (req as { locationRestriction: { east: number; west: number } }).locationRestriction;
    return (b.east - b.west) * 69 * Math.cos((47.6 * Math.PI) / 180);
  };

  it('never asks the rep to zoom: a map wider than 10 miles searches a 10 mile box around its centre', async () => {
    placesAnswer = [place('p1', 'Near Stone', 47.601, -122.3)];
    await openLeads();
    mapShowing(1.5);
    await searchFor('countertops');
    expect(screen.queryByText(/Zoom in/)).toBeNull();
    expect(searches.length).toBe(1);
    expect(milesAcross(searches[0])).toBeCloseTo(10, 0);
    expect(screen.getByText('1 lead')).toBeTruthy();
    expect(screen.getByText('countertops · 10 mi around the map centre')).toBeTruthy();
  });

  it('a map no wider than 10 miles searches what is on screen', async () => {
    placesAnswer = [place('p1', 'Near Stone', 47.601, -122.3)];
    await openLeads();
    mapShowing(0.08);
    await searchFor('countertops');
    expect(screen.getByText('countertops · this map area')).toBeTruthy();
  });

  it('Search wider fits the map to 25 miles, searches there, and stops offering at 50', async () => {
    placesAnswer = [place('p1', 'Near Stone', 47.601, -122.3)];
    await openLeads();
    mapShowing(1.5);
    const fits: unknown[] = [];
    gm.map.fitBounds = (box: unknown) => { fits.push(box); };
    await searchFor('countertops');
    fireEvent.click(screen.getByText('Not finding enough? Search wider · 25 mi'));
    await settle();
    expect(fits.length).toBe(1);
    expect(searches.length).toBe(2);
    expect(milesAcross(searches[1])).toBeCloseTo(25, 0);
    fireEvent.click(screen.getByText('Not finding enough? Search wider · 50 mi'));
    await settle();
    expect(milesAcross(searches[2])).toBeCloseTo(50, 0);
    expect(screen.queryByText(/Search wider/)).toBeNull();
  });

  it('✕ closes it and takes the pins off the map', async () => {
    placesAnswer = [place('p1', 'Near Stone', 47.601, -122.3)];
    await openLeads();
    await searchFor('countertops');
    expect(marker('Near Stone')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close lead search'));
    await settle();
    expect(screen.queryByTestId('leads-phone')).toBeNull();
    expect(marker('Near Stone')).toBeFalsy();
  });
});
