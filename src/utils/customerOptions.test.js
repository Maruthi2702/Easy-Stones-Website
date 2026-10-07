import { describe, it, expect } from 'vitest';
import { customerLabel, customerAddressParts, customerOption, toCustomerOptions, matchesOption } from './customerOptions.js';

describe('customerLabel', () => {
    it('company, then contact, then first + last', () => {
        expect(customerLabel({ company: 'Western Tile Inc.', contactName: 'Alex' })).toBe('Western Tile Inc.');
        expect(customerLabel({ company: '', contactName: 'Alex' })).toBe('Alex');
        expect(customerLabel({ firstName: 'Jane', lastName: 'Moon' })).toBe('Jane Moon');
        expect(customerLabel({})).toBe('Unknown');
    });
    it('skips filler like N/A', () => {
        expect(customerLabel({ company: 'N/A', contactName: 'Stan' })).toBe('Stan');
    });
});

describe('customerAddressParts', () => {
    it('reads the nested address the forms save', () => {
        expect(customerAddressParts({ address: { street: '1 Main St', city: 'Kent', state: 'WA' } }))
            .toEqual({ street: '1 Main St', city: 'Kent', state: 'WA' });
    });
    it('falls back to the older flat and shipping fields', () => {
        expect(customerAddressParts({ city: 'Lacey', street: '9 Oak Rd', state: 'WA' })).toEqual({ street: '9 Oak Rd', city: 'Lacey', state: 'WA' });
        expect(customerAddressParts({ shippingAddress: { city: 'Pasco' } }).city).toBe('Pasco');
    });
});

describe('customerOption', () => {
    it('has the name, the city under it, and what a search can match', () => {
        const o = customerOption({ _id: 'c1', company: 'Western Tile Inc.', contactName: 'Alex', address: { street: '1 Main St', city: 'Kent', state: 'WA' }, salesRepName: 'Krish', customerType: 'Fabricator' });
        expect(o).toEqual({
            value: 'c1', label: 'Western Tile Inc.', description: 'Kent', keywords: 'Alex Kent WA',
            city: 'Kent', address: '1 Main St', fullAddress: '1 Main St, Kent, WA', salesRepName: 'Krish', customerType: 'Fabricator'
        });
    });
    it('no city, no line under the name', () => {
        expect(customerOption({ _id: 'c2', company: 'A' }).description).toBeUndefined();
    });
});

describe('toCustomerOptions', () => {
    it('sorts A–Z ignoring case, numbers in order, one per id', () => {
        const list = toCustomerOptions([
            { _id: '3', company: 'b stone' }, { _id: '1', company: 'Acme' }, { _id: '2', company: '10 Granite' },
            { _id: '4', company: '2 Tile' }, { _id: '1', company: 'Acme again' }, null, { company: 'no id' }
        ]);
        expect(list.map((o) => o.label)).toEqual(['2 Tile', '10 Granite', 'Acme', 'b stone']);
    });
});

describe('matchesOption', () => {
    const o = customerOption({ _id: 'c1', company: 'Western Tile Inc.', contactName: 'Alex', address: { city: 'Kent' } });
    it('matches the name, the city and the contact', () => {
        expect(matchesOption(o, 'western')).toBe(true);
        expect(matchesOption(o, 'kent')).toBe(true);
        expect(matchesOption(o, 'alex')).toBe(true);
        expect(matchesOption(o, 'seattle')).toBe(false);
        expect(matchesOption(o, '  ')).toBe(true);
    });
});
