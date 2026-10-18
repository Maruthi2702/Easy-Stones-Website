import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  shouldAutoLocate, readLastPosition, rememberPosition, locationWasOk, forgetLocationOk, locationPermission
} from './geolocationAccess.js';

const store = new Map();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('window', { localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  } });
});
afterEach(() => vi.unstubAllGlobals());

describe('shouldAutoLocate', () => {
  it('follows quietly when the browser says it is allowed', () => {
    expect(shouldAutoLocate('granted', false)).toBe(true);
  });
  it('never asks when the browser says to prompt or has been told no', () => {
    expect(shouldAutoLocate('prompt', true)).toBe(false);
    expect(shouldAutoLocate('denied', true)).toBe(false);
  });
  it('trusts an earlier success only on a browser that cannot say', () => {
    expect(shouldAutoLocate('unknown', true)).toBe(true);
    expect(shouldAutoLocate('unknown', false)).toBe(false);
  });
});

describe('the last position', () => {
  it('is remembered with the fact that location works', () => {
    expect(readLastPosition()).toBeNull();
    rememberPosition({ lat: 47.6, lng: -122.3 });
    expect(readLastPosition()).toEqual({ lat: 47.6, lng: -122.3 });
    expect(locationWasOk()).toBe(true);
  });
  it('forgets that location works when the browser refuses, but keeps where we last were', () => {
    rememberPosition({ lat: 47.6, lng: -122.3 });
    forgetLocationOk();
    expect(locationWasOk()).toBe(false);
    expect(readLastPosition()).toEqual({ lat: 47.6, lng: -122.3 });
  });
  it('ignores a point that is not one', () => {
    rememberPosition({ lat: 'x', lng: 1 });
    rememberPosition({ lat: 200, lng: 0 });
    expect(readLastPosition()).toBeNull();
    store.set('rp_last_position', '{not json');
    expect(readLastPosition()).toBeNull();
  });
  it('works when storage is unavailable', () => {
    vi.stubGlobal('window', { localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } } });
    expect(() => rememberPosition({ lat: 1, lng: 1 })).not.toThrow();
    expect(readLastPosition()).toBeNull();
    expect(locationWasOk()).toBe(false);
  });
});

describe('locationPermission', () => {
  it('reads the browser’s answer', async () => {
    vi.stubGlobal('navigator', { permissions: { query: async () => ({ state: 'granted' }) } });
    expect(await locationPermission()).toBe('granted');
  });
  it('says unknown where the browser cannot tell', async () => {
    vi.stubGlobal('navigator', {});
    expect(await locationPermission()).toBe('unknown');
    vi.stubGlobal('navigator', { permissions: { query: async () => { throw new Error('unsupported'); } } });
    expect(await locationPermission()).toBe('unknown');
  });
});
