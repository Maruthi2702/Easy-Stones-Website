import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const authFetch = vi.fn();
vi.mock('../../api/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

import { directionsUrlFor, openDirections, prepareDirections } from './directions';

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
        vi.stubGlobal('window', { open, location: { assign } });
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
