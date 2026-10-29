import { describe, it, expect } from 'vitest';
import { planHeaderMenu, telHref, directionsHref, deleteSummary, hasAnyContact } from './profileHeaderRules';

const none = { canEditCustomer: false, canDeleteCustomer: false, canChangeStatus: false, hasPhone: false, hasAddress: false };

describe('planHeaderMenu', () => {
  it('shows Edit and Delete only to a login that has them, and no button when there is nothing to put in it', () => {
    expect(planHeaderMenu(none)).toMatchObject({ edit: false, delete: false, button: 'none' });
    expect(planHeaderMenu({ ...none, canEditCustomer: true })).toMatchObject({ edit: true, delete: false, button: 'always' });
    expect(planHeaderMenu({ ...none, canDeleteCustomer: true })).toMatchObject({ edit: false, delete: true, button: 'always' });
  });
  it('a login with only the status switch gets the button up to 700px; only a phone number or address, on a phone', () => {
    expect(planHeaderMenu({ ...none, canChangeStatus: true }).button).toBe('narrow');
    expect(planHeaderMenu({ ...none, hasPhone: true }).button).toBe('phone');
    expect(planHeaderMenu({ ...none, hasAddress: true }).button).toBe('phone');
    expect(planHeaderMenu({ ...none, canChangeStatus: true, hasPhone: true }).button).toBe('narrow');
  });
  it('Call and Directions need a phone number and an address', () => {
    expect(planHeaderMenu({ ...none, hasPhone: true })).toMatchObject({ call: true, directions: false });
    expect(planHeaderMenu({ ...none, hasAddress: true })).toMatchObject({ call: false, directions: true });
  });
});

describe('links', () => {
  it('tel keeps digits and a leading +', () => {
    expect(telHref('(206) 555-0147')).toBe('tel:2065550147');
    expect(telHref('+1 206 555 0147')).toBe('tel:+12065550147');
    expect(telHref(undefined)).toBe('tel:');
  });
  it('directions encode the address', () => {
    expect(directionsHref('221 SE Timber Ave, Redmond, OR')).toBe('https://www.google.com/maps/dir/?api=1&destination=221%20SE%20Timber%20Ave%2C%20Redmond%2C%20OR');
  });
});

describe('deleteSummary', () => {
  it('lists what goes with the customer, with the right plurals', () => {
    expect(deleteSummary({ visits: [1], resources: [1, 2], contacts: [1, 2] })).toBe('This also removes its 1 visit, 2 resources and 2 contacts.');
    expect(deleteSummary({ visits: [1, 2, 3] })).toBe('This also removes its 3 visits.');
    expect(deleteSummary({ resources: [1], contacts: [1] })).toBe('This also removes its 1 resource and 1 contact.');
  });
  it('says only that the customer goes when it has nothing', () => {
    expect(deleteSummary({})).toBe('This removes the customer.');
    expect(deleteSummary(null)).toBe('This removes the customer.');
  });
});

describe('hasAnyContact', () => {
  it('counts the main contact (name, phone or email) and the extra contacts', () => {
    expect(hasAnyContact({})).toBe(false);
    expect(hasAnyContact(null)).toBe(false);
    expect(hasAnyContact({ phone: '2065550147' })).toBe(true);
    expect(hasAnyContact({ contacts: [{ _id: 'k1' }] })).toBe(true);
  });
});
