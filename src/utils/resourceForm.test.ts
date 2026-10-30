import { describe, expect, it } from 'vitest';
import {
    parseResourceQty, resourceQty, emptyResourceValues, resourceValuesFrom, validateResourceValues,
    countResourceChanges, resourceValuesToSave
} from './resourceForm';

describe('qty', () => {
    it('blank or missing is 1; a whole number 1–999 is kept; anything else is refused', () => {
        expect(parseResourceQty(undefined)).toBe(1);
        expect(parseResourceQty('')).toBe(1);
        expect(parseResourceQty('6')).toBe(6);
        expect(parseResourceQty(6)).toBe(6);
        expect(parseResourceQty(' 12 ')).toBe(12);
        expect(parseResourceQty('0')).toBeNull();
        expect(parseResourceQty('1000')).toBeNull();
        expect(parseResourceQty('2.5')).toBeNull();
        expect(parseResourceQty('-1')).toBeNull();
        expect(parseResourceQty('six')).toBeNull();
    });
    it('a resource saved before Qty counts as one', () => {
        expect(resourceQty({})).toBe(1);
        expect(resourceQty({ qty: 5 })).toBe(5);
        expect(resourceQty(null)).toBe(1);
    });
});

describe('the form', () => {
    const today = '2026-10-30';

    it('a new resource starts today, Active, one of it', () => {
        expect(emptyResourceValues(today, 'c1')).toEqual({
            customerId: 'c1', resourceType: '', qty: '1', date: today, status: 'Active', description: '', notes: ''
        });
    });

    it('reads a saved resource, its title standing in for a missing type', () => {
        expect(resourceValuesFrom({ customerId: 'c1', title: 'Moda Tower', date: '2026-10-09T00:00', qty: 6 }, today))
            .toMatchObject({ customerId: 'c1', resourceType: 'Moda Tower', date: '2026-10-09', qty: '6', status: 'Active' });
    });

    it('needs a customer, a type, a qty and a date', () => {
        const errors = validateResourceValues({ ...emptyResourceValues(today), qty: '0', date: '' });
        expect(Object.keys(errors)).toEqual(['customerId', 'resourceType', 'qty', 'date']);
        expect(validateResourceValues({ ...emptyResourceValues(today, 'c1'), resourceType: 'Binder' })).toEqual({});
        expect(validateResourceValues({ ...emptyResourceValues(today, 'c1'), resourceType: 'Binder', qty: '' })).toHaveProperty('qty');
    });

    it('counts changed fields, ignoring spaces at the ends', () => {
        const start = emptyResourceValues(today, 'c1');
        expect(countResourceChanges({ ...start, description: '  ' }, start)).toBe(0);
        expect(countResourceChanges({ ...start, qty: '3', notes: 'x' }, start)).toBe(2);
    });

    it('saves qty as a number and the type as the title', () => {
        expect(resourceValuesToSave({ ...emptyResourceValues(today, 'c1'), resourceType: ' Binder ', qty: '6', notes: ' hi ' }))
            .toEqual({ customerId: 'c1', resourceType: 'Binder', title: 'Binder', qty: 6, date: today, status: 'Active', description: '', notes: 'hi' });
    });
});
