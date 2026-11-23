import { afterEach, describe, expect, it, vi } from 'vitest';
import { GEOLOCATION_SHIM } from './geolocationShim';
import { fixWithin, forgetFix, rememberFix } from './lastFix';

type Call = { plugin: string; method: string; options: any };
const fix = (timestamp: number) => ({ timestamp, coords: { latitude: 47.6, longitude: -122.3, accuracy: 12, altitude: null, altitudeAccuracy: null, speed: null, heading: null } });

/** Run the injected script against a fake page whose Capacitor bridge answers with `answer`. */
function page(answer: (c: Call) => unknown) {
  const calls: Call[] = [];
  const nativePromise = vi.fn(async (plugin: string, method: string, options: any) => {
    const c = { plugin, method, options }; calls.push(c);
    const r = answer(c); if (r instanceof Error) throw r; return r;
  });
  const origQuery = vi.fn(async () => ({ state: 'prompt' }));
  const navigator: any = { permissions: { query: origQuery } };
  const window: any = { Capacitor: { nativePromise } };
  new Function('window', 'navigator', GEOLOCATION_SHIM)(window, navigator);
  return { navigator, window, calls, origQuery };
}
const read = (nav: any, o?: any) => new Promise<any>((res, rej) => nav.geolocation.getCurrentPosition(res, rej, o));

afterEach(() => { vi.useRealTimers(); forgetFix(); });

describe('page geolocation shim', () => {
  it('answers getCurrentPosition from the app, allowing a 20 s old point', async () => {
    const p = page(() => fix(1000));
    expect((await read(p.navigator)).coords.latitude).toBe(47.6);
    expect(p.calls[0]).toMatchObject({ plugin: 'Geolocation', method: 'getCurrentPosition', options: { maximumAge: 20_000 } });
  });
  it('keeps a larger maximumAge the page asked for', async () => {
    const p = page(() => fix(1));
    await read(p.navigator, { maximumAge: 60_000, enableHighAccuracy: true });
    expect(p.calls[0].options).toMatchObject({ maximumAge: 60_000, enableHighAccuracy: true });
  });
  it('turns a refusal into a PositionError-like code 1, a timeout into 3', async () => {
    expect(await read(page(() => new Error('Location permission was denied')).navigator).catch((e) => e.code)).toBe(1);
    expect(await read(page(() => new Error('Timeout expired')).navigator).catch((e) => e.code)).toBe(3);
    expect(await read(page(() => new Error('boom')).navigator).catch((e) => e.code)).toBe(2);
  });
  it('reports the app permission through permissions.query, and leaves other permissions alone', async () => {
    const p = page((c) => (c.method === 'checkPermissions' ? { location: 'granted' } : null));
    expect((await p.navigator.permissions.query({ name: 'geolocation' })).state).toBe('granted');
    await p.navigator.permissions.query({ name: 'camera' });
    expect(p.origQuery).toHaveBeenCalledWith({ name: 'camera' });
  });
  it('watchPosition reads now and every 5 s until cleared', async () => {
    vi.useFakeTimers();
    const p = page(() => fix(1));
    const seen = vi.fn();
    const id = p.navigator.geolocation.watchPosition(seen, undefined, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen).toHaveBeenCalledTimes(2);
    p.navigator.geolocation.clearWatch(id);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(seen).toHaveBeenCalledTimes(2);
  });
  it('does nothing without the bridge (a plain browser)', () => {
    const navigator: any = { geolocation: 'browser' };
    new Function('window', 'navigator', GEOLOCATION_SHIM)({}, navigator);
    expect(navigator.geolocation).toBe('browser');
  });
});

describe('lastFix', () => {
  it('serves a point only while it is young enough, never for maxAge 0', () => {
    rememberFix(fix(10_000));
    expect(fixWithin(20_000, 25_000)?.timestamp).toBe(10_000);
    expect(fixWithin(20_000, 40_000)).toBeNull();
    expect(fixWithin(0, 10_000)).toBeNull();
  });
  it('keeps the newest point', () => {
    rememberFix(fix(5)); rememberFix(fix(3));
    expect(fixWithin(1000, 6)?.timestamp).toBe(5);
  });
});
