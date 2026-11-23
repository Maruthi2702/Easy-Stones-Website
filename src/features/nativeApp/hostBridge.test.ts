// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { shimFor } from '../../../mobile/src/host/protocol';
import type { Plugins } from '../../../mobile/src/host/protocol';
import HostRouter from '../../../mobile/src/host/router';

/**
 * The React Native app stands in for Capacitor's native side (mobile/src/host). This runs the REAL @capacitor/core against the shim the
 * app injects and the router that answers it, so the website's existing plugin calls (promises, listeners, a watcher with a callback)
 * are proven to round-trip without a phone. Capacitor reads its host once per process, so the host is set up once for all the tests.
 */
const g = globalThis as unknown as Record<string, unknown>;
const state = { stopped: { app: false, watcher: false }, fire: null as null | ((d: unknown) => void) };

const plugins: Plugins = {
  LocationHealth: { calls: {
    status: async () => ({ authorization: 'always', batteryPct: 80 }),
    requestAlways: () => { throw Object.assign(new Error('nope'), { code: 'DENIED' }); }
  }, callbacks: {}, events: {} },
  App: { calls: {}, callbacks: {}, events: { appStateChange: (emit) => { state.fire = emit; return () => { state.stopped.app = true; }; } } },
  BackgroundGeolocation: {
    calls: { removeWatcher: () => ({}) },
    callbacks: { addWatcher: (o: { distanceFilter?: number }, emit, fail) => {
      emit({ latitude: 47.6, longitude: -122.3, accuracy: 5, time: 1, distance: o.distanceFilter });
      fail({ message: 'denied', code: 'NOT_AUTHORIZED' });
      return () => { state.stopped.watcher = true; };
    } },
    events: {}
  }
};

let core: typeof import('@capacitor/core');
beforeAll(async () => {
  const router = new HostRouter(plugins, (script) => { new Function('window', script)(g); });
  g.ReactNativeWebView = { postMessage: (m: string) => { void router.handle(m); } };
  new Function('window', shimFor('android', plugins))(g);
  core = await import('@capacitor/core');
});

describe('React Native host bridge', () => {
  it('makes the website see a native app on the right platform', () => {
    expect(core.Capacitor.isNativePlatform()).toBe(true);
    expect(core.Capacitor.getPlatform()).toBe('android');
  });

  it('answers a promise call and rejects with the native code', async () => {
    const health = core.registerPlugin<{ status(): Promise<{ authorization: string }>; requestAlways(): Promise<unknown>; missing(): Promise<void> }>('LocationHealth');
    expect(await health.status()).toEqual({ authorization: 'always', batteryPct: 80 });
    await expect(health.requestAlways()).rejects.toMatchObject({ message: 'nope', code: 'DENIED' });
    await expect(health.missing()).rejects.toBeTruthy();                          // not in the header: "not implemented"
  });

  it('delivers listener events and stops them on remove()', async () => {
    const App = core.registerPlugin<{ addListener(e: string, cb: (d: { isActive: boolean }) => void): Promise<{ remove(): Promise<void> }> }>('App');
    const seen: boolean[] = [];
    const handle = await App.addListener('appStateChange', (d) => seen.push(d.isActive));
    await vi.waitFor(() => expect(state.fire).not.toBeNull());
    state.fire!({ isActive: true }); state.fire!({ isActive: false });
    await vi.waitFor(() => expect(seen).toEqual([true, false]));
    await handle.remove();
    expect(state.stopped.app).toBe(true);
  });

  it('runs a watcher: positions arrive on the callback, errors carry the code, removeWatcher stops it', async () => {
    const bg = core.registerPlugin<{ addWatcher(o: object, cb: (l?: { latitude: number }, e?: { code?: string }) => void): Promise<string>; removeWatcher(o: { id: string }): Promise<void> }>('BackgroundGeolocation');
    const got: unknown[] = [];
    const id = await bg.addWatcher({ distanceFilter: 25 }, (l, e) => got.push(l ?? e));
    await vi.waitFor(() => expect(got).toHaveLength(2));
    expect(got[0]).toMatchObject({ latitude: 47.6, distance: 25 });
    expect(got[1]).toMatchObject({ code: 'NOT_AUTHORIZED' });
    await bg.removeWatcher({ id });
    expect(state.stopped.watcher).toBe(true);
  });
});
