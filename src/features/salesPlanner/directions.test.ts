import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const authFetch = vi.fn();
vi.mock('../../api/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

import { directionsUrlFor, mapLinkFor, mapsAppsHere, openDirections, prepareDirections, readMapsApp, saveMapsApp } from './directions';

describe('directionsUrlFor', () => {
    it('goes to the stored map point when the customer has one', () => {
        expect(directionsUrlFor({ coordinates: { lat: 47.6, lng: -122.3 }, address: { street: '1 Main St' } }))
            .toBe('https://www.google.com/maps/dir/?api=1&destination=47.6%2C-122.3');
    });
    it('falls back to the address, and says nothing when there is none', () => {
        const url = directionsUrlFor({ address: { street: '12 Stone Way', city: 'Kent', state: 'WA', zipCode: '98032' } });
        expect(url).toContain('https://www.google.com/maps/dir/?api=1&destination=');
        expect(decodeURIComponent(url)).toContain('12 Stone Way');
        expect(directionsUrlFor({})).toBe('');
    });
});

describe('openDirections', () => {
    const open = vi.fn();
    const assign = vi.fn();
    let n = 0;
    const customer = () => `c${++n}`; // a fresh id each test: the link is cached per customer
    const record = (body: object) => authFetch.mockResolvedValue({ ok: true, json: async () => body });
    beforeEach(() => {
        open.mockReset(); assign.mockReset(); authFetch.mockReset();
        vi.stubGlobal('window', { open, location: { assign }, matchMedia: () => ({ matches: false }) });
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('opens the map in the same tap once the menu has read the customer, with no blank tab first', async () => {
        const id = customer();
        record({ coordinates: { lat: 47.6, lng: -122.3 } });
        prepareDirections(id);
        await vi.waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
        await new Promise((r) => setTimeout(r, 0));
        const done = openDirections(id);
        expect(open).toHaveBeenCalledTimes(1); // before anything is awaited
        expect(open.mock.calls[0][0]).toContain('https://www.google.com/maps/dir/');
        expect(open.mock.calls.some((c) => c[0] === '')).toBe(false);
        expect(await done).toBe('opened');
        expect(authFetch).toHaveBeenCalledTimes(1);
    });
    it('reads the customer first when tapped before it was ready, then opens the map (never an empty tab)', async () => {
        const id = customer();
        record({ address: { street: '12 Stone Way', city: 'Kent', state: 'WA' } });
        expect(await openDirections(id)).toBe('opened');
        expect(open).toHaveBeenCalledTimes(1);
        expect(open.mock.calls[0][0]).toContain('12%20Stone%20Way');
    });
    it('sends this page to the map when the browser blocks the new tab', async () => {
        const id = customer();
        record({ coordinates: { lat: 1, lng: 2 } });
        open.mockReturnValue(null);
        expect(await openDirections(id)).toBe('opened');
        expect(assign).toHaveBeenCalledTimes(1);
    });
    it('on an iPhone sends this window to the map, so no empty browser is left in front of the app', async () => {
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 });
        const id = customer();
        record({ coordinates: { lat: 47.6, lng: -122.3 } });
        expect(await openDirections(id)).toBe('opened');
        expect(open).not.toHaveBeenCalled();
        expect(assign).toHaveBeenCalledTimes(1);
        expect(assign.mock.calls[0][0]).toContain('google.com/maps/dir');
    });
    it('does the same in an installed web app on any device', async () => {
        vi.stubGlobal('window', { open, location: { assign }, matchMedia: () => ({ matches: true }) });
        const id = customer();
        record({ coordinates: { lat: 1, lng: 2 } });
        await openDirections(id);
        expect(open).not.toHaveBeenCalled();
        expect(assign).toHaveBeenCalledTimes(1);
    });
    it('opens nothing when the customer has no address or cannot be read', async () => {
        const noAddress = customer();
        record({});
        expect(await openDirections(noAddress)).toBe('no-address');
        const failed = customer();
        authFetch.mockResolvedValue({ ok: false });
        expect(await openDirections(failed)).toBe('failed');
        expect(open).not.toHaveBeenCalled();
    });
});

describe('other maps apps', () => {
    it('builds each app\'s link for a stored point and for an address', () => {
        expect(mapLinkFor('47.6,-122.3', 'apple')).toBe('https://maps.apple.com/?daddr=47.6%2C-122.3&dirflg=d');
        expect(mapLinkFor('47.6,-122.3', 'waze')).toBe('https://waze.com/ul?ll=47.6%2C-122.3&navigate=yes');
        expect(mapLinkFor('12 Stone Way, Kent, WA', 'waze')).toBe('https://waze.com/ul?q=12%20Stone%20Way%2C%20Kent%2C%20WA&navigate=yes');
        expect(mapLinkFor('12 Stone Way, Kent, WA', 'apple')).toContain('daddr=12%20Stone%20Way');
        expect(mapLinkFor('1,2')).toContain('google.com/maps/dir');
        expect(mapLinkFor('', 'waze')).toBe('');
    });
    it('keeps Google as the app for directionsUrlFor unless told otherwise', () => {
        expect(directionsUrlFor({ coordinates: { lat: 1, lng: 2 } })).toContain('google.com');
        expect(directionsUrlFor({ coordinates: { lat: 1, lng: 2 } }, 'waze')).toContain('waze.com');
    });
    describe('the remembered app', () => {
        const store = new Map<string, string>();
        beforeEach(() => {
            store.clear();
            vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } });
        });
        afterEach(() => vi.unstubAllGlobals());
        it('is Google Maps until one is chosen, then the choice', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone)', platform: 'iPhone' });
            expect(readMapsApp()).toBe('google');
            saveMapsApp('waze');
            expect(readMapsApp()).toBe('waze');
        });
        it('offers Apple Maps only on Apple devices, and falls back to Google when the saved app is not offered', () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32' });
            expect(mapsAppsHere()).toEqual(['google', 'waze']);
            saveMapsApp('apple');
            expect(readMapsApp()).toBe('google');
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone)', platform: 'iPhone' });
            expect(mapsAppsHere()).toEqual(['google', 'apple', 'waze']);
            expect(readMapsApp()).toBe('apple');
        });
    });
    it('opens the chosen app\'s link', async () => {
        const open = vi.fn();
        vi.stubGlobal('window', { open, location: { assign: vi.fn() }, matchMedia: () => ({ matches: false }) });
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 });
        authFetch.mockReset();
        authFetch.mockResolvedValue({ ok: true, json: async () => ({ coordinates: { lat: 47.6, lng: -122.3 } }) });
        expect(await openDirections('waze-customer', 'waze')).toBe('opened');
        expect(open.mock.calls[0][0]).toBe('https://waze.com/ul?ll=47.6%2C-122.3&navigate=yes');
        vi.unstubAllGlobals();
    });
});
