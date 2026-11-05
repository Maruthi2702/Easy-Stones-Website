// @vitest-environment jsdom
// The Delivery module renders: the office board (every kind of ticket, Pending,
// Cancelled), Add / Edit delivery, the ePOD viewer, the phone cards, the
// read-only board and the driver's stops. API and socket are faked.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

// Dated from today so the tickets land in the week on screen.
const day = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const week = [
  { id: 'd1', deliveryType: 'jobsite', truckId: 'drv_angel', date: day(0), routeNumber: 1, status: 'scheduled', customerName: 'Pacific Granite', address: '1 Main St, Seattle', soNumber: 'SO-48213', salesRepName: 'Krish', location: 'Seattle' },
  { id: 'd2', deliveryType: 'return', truckId: 'drv_angel', date: day(1), routeNumber: 1, status: 'delayed', customerName: 'Stone River', soNumber: 'SO-48300', location: 'Seattle' },
  { id: 'd3', deliveryType: 'transfer', truckId: 'drv_angel', date: day(2), routeNumber: 1, status: 'scheduled', soNumber: 'TRF-10482', transferOrigin: 'Seattle', transferDestination: 'Spokane', expectedArrivalDate: day(3), location: 'Seattle' },
  { id: 'd4', deliveryType: 'will_call', truckId: '', date: day(3), routeNumber: 1, status: 'scheduled', customerName: 'Granite Works', pickupInfo: 'ABC-123', soNumber: 'SO-48400', location: 'Seattle' },
  { id: 'd5', deliveryType: 'jobsite', truckId: 'drv_angel', date: day(0), routeNumber: 2, status: 'completed', customerName: 'Harbor Kitchens', soNumber: 'SO-48111', location: 'Seattle',
    pod: { verified: true, signeeName: 'Tom Hale', signedAt: '2026-10-19T19:00:00.000Z', signedPdfUrl: 'https://files.example/s.pdf' } }
];
const pending = [{ id: 'p1', deliveryType: 'jobsite', truckId: '', date: '', status: 'pending', customerName: 'Cascade Stone', soNumber: 'SO-50001', location: 'Seattle' }];
const cancelled = [{ id: 'x1', deliveryType: 'jobsite', truckId: 'drv_angel', date: day(1), status: 'cancelled', customerName: 'Evergreen Tile', soNumber: 'SO-40404', location: 'Seattle' }];
const reps = { data: [{ _id: 'u3', name: 'Angel', username: 'angel', role: 'driver', isDeliveryDriver: true, isActive: true, assignedLocations: ['Seattle'] }] };
const routes: [RegExp, unknown][] = [
  [/\/api\/deliveries\/d5(\?|$)/, week[4]],
  [/\/api\/deliveries\?.*pending=true/, pending],
  [/\/api\/deliveries\?.*cancelled=true/, cancelled],
  [/\/api\/deliveries\?/, week],
  [/\/api\/salesreps/, reps],
  [/\/api\/delivery-columns/, {}],
  [/\/api\/daily-reports\/submitted-days/, { days: [] }]
];
const answer = (url: string) => {
  const hit = routes.find(([re]) => re.test(url));
  return Promise.resolve(new Response(JSON.stringify(hit ? hit[1] : []), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
vi.mock('../../api/authFetch', () => ({ authFetch: (u: string) => answer(u), resetSessionExpiredGuard() {} }));
vi.mock('socket.io-client', () => ({ io: () => ({ on() { return this; }, off() { return this; }, emit() { return this; }, disconnect() {}, connected: false }) }));
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function scrollIntoView() {};

const { DeliveryScheduleTab } = await import('./index');
const { clearScheduleCache } = await import('../../api/deliverySchedule');

const OFFICE = {
  _id: 'u1', id: 'u1', username: 'krish', name: 'Krish', role: 'admin', location: 'Seattle', assignedLocations: ['*'],
  permissions: ['view_delivery_schedule', 'edit_delivery_schedule', 'delete_delivery_schedule', 'arrange_delivery_columns', 'clear_pod_signatures']
};
const settle = async () => { for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const open = async (user = OFFICE) => {
  const r = render(<DeliveryScheduleTab currentUser={user} locationsList={['Seattle', 'Spokane']} customerOptions={[]} />);
  await settle();
  return r;
};
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });

beforeEach(() => { clearScheduleCache(); try { sessionStorage.clear(); localStorage.clear(); } catch { /* */ } });
afterEach(() => { cleanup(); setWidth(1024); });

describe('Delivery Schedule', () => {
  it('office board: every kind of ticket, Pending and Cancelled', async () => {
    await open();
    for (const t of ['Pacific Granite', 'Stone River', 'TRF-10482', 'Granite Works', 'Harbor Kitchens', 'Cascade Stone', 'Evergreen Tile']) {
      expect(screen.getAllByText(t, { exact: false }).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Pending Delivery')).toBeTruthy();
    expect(screen.getByText('Cancelled Orders')).toBeTruthy();
    expect(screen.getAllByText('Angel').length).toBeGreaterThan(0);
  });

  it('opens Add delivery and Edit on a ticket', async () => {
    await open();
    fireEvent.click(screen.getByLabelText('Add delivery'));
    await settle();
    expect(screen.getByText('Delivery type')).toBeTruthy();
    cleanup();
    clearScheduleCache();
    await open();
    const chip = [...document.querySelectorAll('.manifest-ticket-chip')].find((e) => e.textContent?.includes('Pacific Granite')) as Element;
    fireEvent.click(chip);
    await settle();
    expect((document.getElementById('df-soNumber') as HTMLInputElement).value).toBe('SO-48213');
  });

  it('opens the ePOD viewer on a signed delivery', async () => {
    await open();
    fireEvent.click(document.querySelector('.epod-chip-verified') as Element);
    await settle();
    expect(screen.getAllByText(/Tom Hale/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Clear signatures').length).toBeGreaterThan(0);
  });

  it('phone width: the board as day cards', async () => {
    setWidth(500);
    await open();
    expect(document.querySelector('.ux-day-pills-bar')).toBeTruthy();
    expect(document.querySelector('.manifest-dispatch-table')).toBeNull();
  });

  it('view only: the read-only board', async () => {
    await open({ ...OFFICE, permissions: ['view_delivery_schedule'] });
    expect(screen.getByText('Read-only · contact office to schedule')).toBeTruthy();
    expect(screen.queryByLabelText('Add delivery')).toBeNull();
  });

  it('driver view: their own stops', async () => {
    await open({ ...OFFICE, name: 'Angel', username: 'angel', permissions: ['view_delivery_schedule', 'delivery_driver_view'] });
    fireEvent.click(document.querySelectorAll('.dv-day')[0]);
    expect(screen.getByText('Pacific Granite')).toBeTruthy();
    expect(screen.getAllByText('Delivered / Sign ePOD').length).toBeGreaterThan(0);
  });
});

describe('Add delivery date defaults', () => {
  beforeEach(() => {
    // Thursday: using Monday as the default must fail even when this suite
    // happens to run on a Monday. Keep normal timers for the real form.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 12));
    setWidth(1280);
  });
  afterEach(() => { vi.useRealTimers(); });

  it.each(['current', 'previous', 'next'])('the header defaults to today while viewing the %s week', async shownWeek => {
    await open();
    if (shownWeek !== 'current') {
      fireEvent.click(screen.getByTitle(shownWeek === 'previous' ? 'Previous Week' : 'Next Week'));
      await settle();
    }
    fireEvent.click(screen.getByLabelText('Add delivery'));
    await settle();
    expect(document.getElementById('df-date')?.textContent).toContain('Thu, Nov 5, 2026');
  });

  it('uses the day clicked on the desktop board', async () => {
    await open();
    fireEvent.click(screen.getByTitle('Add delivery — Angel on Friday'));
    await settle();
    expect(document.getElementById('df-date')?.textContent).toContain('Fri, Nov 6, 2026');
  });

  it('uses the selected day when adding from a phone day card', async () => {
    setWidth(500);
    await open();
    const friday = [...document.querySelectorAll('.ux-day-pill-card')].find(button => button.textContent?.includes('FRI'))!;
    fireEvent.click(friday);
    fireEvent.click(screen.getByTitle('Add stop for Angel'));
    await settle();
    expect(document.getElementById('df-date')?.textContent).toContain('Fri, Nov 6, 2026');
  });

  it('lets the user change the default date', async () => {
    await open();
    fireEvent.click(screen.getByLabelText('Add delivery'));
    await settle();
    fireEvent.click(document.getElementById('df-date')!);
    fireEvent.click(screen.getByRole('button', { name: 'Friday, November 6, 2026' }));
    expect(document.getElementById('df-date')?.textContent).toContain('Fri, Nov 6, 2026');
  });

  it('uses the local day late at night', async () => {
    vi.setSystemTime(new Date(2026, 10, 5, 23, 30));
    await open();
    fireEvent.click(screen.getByLabelText('Add delivery'));
    await settle();
    expect(document.getElementById('df-date')?.textContent).toContain('Thu, Nov 5, 2026');
  });

  it('uses the new current day if the board was left open overnight', async () => {
    await open();
    vi.setSystemTime(new Date(2026, 10, 6, 0, 1));
    fireEvent.click(screen.getByLabelText('Add delivery'));
    await settle();
    expect(document.getElementById('df-date')?.textContent).toContain('Fri, Nov 6, 2026');
  });
});
