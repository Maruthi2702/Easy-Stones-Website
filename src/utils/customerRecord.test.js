import { describe, it, expect } from 'vitest';
import {
    PROTECTED_CUSTOMER_FIELDS, priceLevelOf, addressFrom, suppliedPoint, placeholderEmail,
    newCustomerFields, customerUpdateFields
} from './customerRecord.js';

const formBody = {
    customerName: 'Alex', company: 'Western Tile Inc.', phone: '206-931-0865',
    email: 'Office@WesternTile.com', marketingEmail: 'News@WesternTile.com', receiveMarketing: false,
    notes: 'Verify contact info', status: 'Onboarded', level: 'Level - 2', customerType: 'Fabricator',
    modaDisplay: 'Yes', modaBinder: '3', salesRep: 'rep1', location: 'Seattle',
    address: { street: '1 Main St', city: 'Kent', state: 'WA', zipCode: '98032' }
};

describe('newCustomerFields', () => {
    it('keeps everything the Add / Edit customer form sends', () => {
        const { fields } = newCustomerFields(formBody);
        expect(fields).toEqual({
            company: 'Western Tile Inc.',
            contactName: 'Alex',
            email: 'office@westerntile.com',
            marketingEmail: 'news@westerntile.com',
            receiveMarketing: false,
            phone: '206-931-0865',
            quickNote: 'Verify contact info',
            level: 'Level - 2',
            priceLevel: 2,
            customerType: 'Fabricator',
            modaDisplay: 'Yes',
            modaBinder: '3',
            location: 'Seattle',
            address: { street: '1 Main St', city: 'Kent', state: 'WA', zipCode: '98032' },
            status: 'Onboarded'
        });
    });

    it('refuses a customer with no company', () => {
        expect(newCustomerFields({ company: '  ' })).toEqual({ error: 'Company name is required' });
    });

    it('fills what the route planner leaves out', () => {
        const { fields } = newCustomerFields(
            { company: 'Stone Pros', status: 'New Lead', phone: '' },
            { now: 1, random: () => 0.123456789 }
        );
        expect(fields.contactName).toBe('Stone Pros');
        expect(fields.email).toMatch(/^sales_1_[a-z0-9]+@temp-customer\.com$/);
        expect(fields.marketingEmail).toBe('');
        expect(fields.level).toBe('Level - 3');
        expect(fields.priceLevel).toBe(3);
        expect(fields.location).toBe('Seattle');
        expect(fields.status).toBe('New Lead');
    });

    it('marketing email follows the email when not given', () => {
        expect(newCustomerFields({ company: 'A', email: 'a@b.com' }).fields.marketingEmail).toBe('a@b.com');
    });

    it('leaves status to the schema default when not sent', () => {
        expect('status' in newCustomerFields({ company: 'A' }).fields).toBe(false);
    });

    it('never carries a password, login or map field from the body', () => {
        const { fields } = newCustomerFields({ company: 'A', password: 'x', isVerified: true, coordinates: { lat: 1, lng: 2 }, salesRepName: 'Me' });
        for (const k of ['password', 'isVerified', 'coordinates', 'salesRepName']) expect(k in fields).toBe(false);
    });
});

describe('customerUpdateFields', () => {
    it('strips every protected field', () => {
        const body = Object.fromEntries(PROTECTED_CUSTOMER_FIELDS.map((k) => [k, 'x']));
        expect(customerUpdateFields({ ...body, status: 'Inactive' })).toEqual({ status: 'Inactive' });
    });

    it('maps the old screens’ names', () => {
        const u = customerUpdateFields({ name: 'Stan', notes: 'Call first', level: 'Level - 1', city: 'Kent', salesRep: 'r', address: {} });
        expect(u).toEqual({ contactName: 'Stan', quickNote: 'Call first', level: 'Level - 1', priceLevel: 1 });
    });

    it('prefers contactName and an explicit quickNote', () => {
        const u = customerUpdateFields({ contactName: 'Alex', customerName: 'Other', notes: 'a', quickNote: 'b' });
        expect(u.contactName).toBe('Alex');
        expect(u.quickNote).toBe('b');
    });

    it('lowercases emails and defaults a cleared location', () => {
        expect(customerUpdateFields({ email: ' A@B.COM ', location: '' })).toEqual({ email: 'a@b.com', location: 'Seattle' });
    });

    it('leaves a status-only edit as just that', () => {
        expect(customerUpdateFields({ status: 'Onboarded' })).toEqual({ status: 'Onboarded' });
    });
});

describe('helpers', () => {
    it('priceLevelOf', () => {
        expect(priceLevelOf('Level - 3')).toBe(3);
        expect(priceLevelOf('')).toBeNull();
    });
    it('addressFrom takes a bare city', () => {
        expect(addressFrom({ city: 'Kent' })).toEqual({ street: '', city: 'Kent', state: '', zipCode: '' });
    });
    it('suppliedPoint checks the range', () => {
        expect(suppliedPoint({ lat: 47.6, lng: -122.3 })).toEqual({ lat: 47.6, lng: -122.3 });
        expect(suppliedPoint({ lat: 91, lng: 0 })).toBeNull();
        expect(suppliedPoint({ lat: 0, lng: 0 })).toBeNull();
        expect(suppliedPoint(undefined)).toBeNull();
    });
    it('placeholderEmail is recognisable as a placeholder', () => {
        expect(placeholderEmail(5, () => 0.5)).toMatch(/@temp-customer\.com$/);
    });
});
