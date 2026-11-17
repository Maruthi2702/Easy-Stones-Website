import { describe, it, expect } from 'vitest';
import { directionsUrlFor } from './directions';

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
