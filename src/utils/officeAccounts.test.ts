import { describe, it, expect } from 'vitest';
import { customerAfterTypeChange, isOfficeVisitType, officeAccountName, officeOptionFor, OFFICE_CUSTOMER_TYPE } from './officeAccounts';

const options = [
    { value: 'k', label: 'Office – Kent', customerType: OFFICE_CUSTOMER_TYPE },
    { value: 's', label: 'Office – Seattle', customerType: OFFICE_CUSTOMER_TYPE },
    { value: 'c1', label: 'Riverside Granite', customerType: 'Fabricator' },
    { value: 'fake', label: 'Office – Kent', customerType: 'Fabricator' }
];

describe('office accounts', () => {
    it('knows the two office visit types by their stored names', () => {
        expect(isOfficeVisitType('In Office Administration Day')).toBe(true);
        expect(isOfficeVisitType('Personal Time Off')).toBe(true);
        expect(isOfficeVisitType('Quick Note')).toBe(false);
        expect(isOfficeVisitType(undefined)).toBe(false);
    });
    it('names the account for the location', () => {
        expect(officeAccountName(' Kent ')).toBe('Office – Kent');
    });
    it('finds a location\'s office only among office-type accounts', () => {
        expect(officeOptionFor(options, 'Kent')?.value).toBe('k');
        expect(officeOptionFor(options, 'Tacoma')).toBeNull();
    });
    it('fills in the home office when an office type is picked with no customer', () => {
        expect(customerAfterTypeChange({ typeName: 'Personal Time Off', customerId: '', options, home: 'Seattle' })).toBe('s');
    });
    it('replaces a real customer left in the box when an office type is picked', () => {
        expect(customerAfterTypeChange({ typeName: 'In Office Administration Day', customerId: 'c1', options, home: 'Kent' })).toBe('k');
    });
    it('keeps an office the rep chose themselves', () => {
        expect(customerAfterTypeChange({ typeName: 'In Office Administration Day', customerId: 's', options, home: 'Kent' })).toBeNull();
    });
    it('leaves it alone when there is no home location or no office yet', () => {
        expect(customerAfterTypeChange({ typeName: 'Personal Time Off', customerId: '', options, home: '' })).toBeNull();
        expect(customerAfterTypeChange({ typeName: 'Personal Time Off', customerId: '', options, home: 'Tacoma' })).toBeNull();
    });
    it('clears an office account when the type goes back to a normal visit', () => {
        expect(customerAfterTypeChange({ typeName: 'Quick Note', customerId: 'k', options, home: 'Kent' })).toBe('');
        expect(customerAfterTypeChange({ typeName: 'Quick Note', customerId: 'c1', options, home: 'Kent' })).toBeNull();
    });
});
