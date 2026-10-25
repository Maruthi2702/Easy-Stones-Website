// @vitest-environment jsdom
// The Sales page shell's hooks: the theme, and what each live update runs.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type Handler = (payload?: unknown) => void;
const listeners: Record<string, Handler> = {};
const emit = vi.fn();
const disconnect = vi.fn();
vi.mock('socket.io-client', () => ({
  io: () => ({ on: (event: string, fn: Handler) => { listeners[event] = fn; }, emit, disconnect })
}));
vi.mock('../../api/authToken', () => ({ getAuthToken: () => 'tok' }));
const refreshCustomers = vi.fn();
vi.mock('../../api/customerOptions', () => ({ refreshCustomers: () => refreshCustomers() }));
const reservationsChanged = vi.fn();
vi.mock('../holds', () => ({ cartActions: { reservationsChanged: (k: string[]) => reservationsChanged(k) } }));
const clearInventoryCache = vi.fn();
vi.mock('../../api/inventoryAnalysisCache', () => ({ clearInventoryCache: () => clearInventoryCache() }));

// Node's own (empty) localStorage shadows jsdom's here; an in-memory one stands in.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear()
});

const { useSalesTheme } = await import('./useSalesTheme');
const { useSalesLiveUpdates } = await import('./useSalesLiveUpdates');

beforeEach(() => {
  try { localStorage.clear(); } catch { /* */ }
  document.body.className = '';
  for (const k of Object.keys(listeners)) delete listeners[k];
  vi.clearAllMocks();
});

describe('useSalesTheme', () => {
  it('starts light, marks the body, and a toggle saves dark', () => {
    const { result } = renderHook(() => useSalesTheme());
    expect(result.current.theme).toBe('light');
    expect(document.body.classList.contains('light-theme-active')).toBe(true);
    const changed = vi.fn();
    window.addEventListener('checkin_theme_changed', changed);
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('checkin_theme')).toBe('dark');
    expect(document.body.classList.contains('light-theme-active')).toBe(false);
    expect(changed).toHaveBeenCalled();
  });
  it('follows a change made in another tab', () => {
    const { result } = renderHook(() => useSalesTheme());
    localStorage.setItem('checkin_theme', 'dark');
    act(() => { window.dispatchEvent(new Event('storage')); });
    expect(result.current.theme).toBe('dark');
  });
});

describe('useSalesLiveUpdates', () => {
  const setup = (userId: string | null = 'u1') => {
    const h = {
      refreshCheckInsRef: { current: vi.fn() }, currentUserIdRef: { current: userId },
      onCustomersChanged: vi.fn(), onResourcesChanged: vi.fn(), onLocationsChanged: vi.fn(),
      onInventoryChanged: vi.fn(), onMySchedulesChanged: vi.fn(), onStart: vi.fn()
    };
    const hook = renderHook(() => useSalesLiveUpdates(h));
    return { h, hook };
  };
  it('loads on start and joins its check-in rooms on connect', () => {
    const { h } = setup();
    expect(h.onStart).toHaveBeenCalledTimes(1);
    listeners.connect();
    expect(emit).toHaveBeenCalledWith('join_checkin_rooms', { token: 'tok' });
  });
  it('runs the right refresh for each update', () => {
    const { h } = setup();
    listeners.checkin_update(); expect(h.refreshCheckInsRef.current).toHaveBeenCalled();
    listeners.customer_update(); expect(h.onCustomersChanged).toHaveBeenCalled(); expect(refreshCustomers).toHaveBeenCalled();
    listeners.resource_update(); expect(h.onResourcesChanged).toHaveBeenCalled();
    listeners.location_update(); expect(h.onLocationsChanged).toHaveBeenCalled();
    listeners.slab_reservations_changed({ slabKeys: ['A-1'] }); expect(reservationsChanged).toHaveBeenCalledWith(['A-1']);
    listeners.inventory_analysis_update(); expect(clearInventoryCache).toHaveBeenCalled(); expect(h.onInventoryChanged).toHaveBeenCalled();
  });
  it("reloads the calendar only for the viewer's own (or unaddressed) changes", () => {
    const { h } = setup('u1');
    listeners.schedule_update({ userId: 'u2' }); expect(h.onMySchedulesChanged).not.toHaveBeenCalled();
    listeners.schedule_update({ userId: 'u1' }); expect(h.onMySchedulesChanged).toHaveBeenCalledTimes(1);
    listeners.schedule_update({}); expect(h.onMySchedulesChanged).toHaveBeenCalledTimes(2);
  });
  it('registers once and disconnects on unmount', () => {
    const { hook, h } = setup();
    hook.rerender();
    expect(h.onStart).toHaveBeenCalledTimes(1);
    hook.unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
