import { describe, it, expect } from 'vitest';
import {
  STATUS_OPTIONS, LEVEL_OPTIONS, TYPE_OPTIONS, withCurrent, emptyCustomerValues, customerToFormValues,
  validateCustomerValues, withEmail, countCustomerChanges, applyCardScan, customerLastChangedText
} from './customerForm.js';

describe('options', () => {
  it('keep the stored values', () => {
    expect(STATUS_OPTIONS.map((o) => o.value)).toEqual([
      'New Lead', 'Trying to Onboard', 'Contacted / In Discussion', 'Onboarded', 'Different Sales Person', 'Not Interested', 'Inactive'
    ]);
    expect(LEVEL_OPTIONS.map((o) => o.value)).toEqual(['Level - 1', 'Level - 2', 'Level - 3', 'Level - 4']);
    expect(TYPE_OPTIONS.map((o) => o.value)).toEqual(['Fabricator', 'Contractor', 'Dealer', 'Floor Covering', 'Designer', 'Builder']);
  });

  it('withCurrent keeps a value that has left the list', () => {
    expect(withCurrent(TYPE_OPTIONS, 'Architect')[0]).toEqual({ value: 'Architect', label: 'Architect' });
    expect(withCurrent(TYPE_OPTIONS, 'Dealer')).toBe(TYPE_OPTIONS);
    expect(withCurrent(TYPE_OPTIONS, '')).toBe(TYPE_OPTIONS);
  });
});

describe('emptyCustomerValues', () => {
  const reps = [{ _id: 'u1', name: 'Krish' }];
  it('defaults the rep to the person entering it, and their branch', () => {
    const v = emptyCustomerValues({ salesReps: reps, locations: ['Seattle', 'Kent'], currentUser: { id: 'u1', location: 'Kent' } });
    expect(v.salesRep).toBe('u1');
    expect(v.location).toBe('Kent');
    expect(v.status).toBe('Onboarded');
    expect(v.level).toBe('Level - 3');
  });

  it('starts Unassigned for someone who is not a rep, on the first branch', () => {
    const v = emptyCustomerValues({ salesReps: reps, locations: ['Seattle', 'Kent'], currentUser: { id: 'admin', location: 'Nowhere' } });
    expect(v.salesRep).toBe('');
    expect(v.location).toBe('Seattle');
  });
});

describe('customerToFormValues', () => {
  it('maps a stored customer, with the old fallbacks', () => {
    const v = customerToFormValues({ contactName: 'Dana', company: 'Cascade', city: 'Kent', email: 'd@c.com', quickNote: 'Hi' });
    expect(v.customerName).toBe('Dana');
    expect(v.address.city).toBe('Kent');
    expect(v.marketingEmail).toBe('d@c.com');
    expect(v.notes).toBe('Hi');
    expect(v.location).toBe('Seattle');
    expect(v.receiveMarketing).toBe(true);
    expect(customerToFormValues({ receiveMarketing: false }).receiveMarketing).toBe(false);
  });
});

describe('validateCustomerValues', () => {
  it('requires company and email', () => {
    expect(validateCustomerValues({})).toEqual({ company: 'Enter the company name', email: 'Enter an email address' });
    expect(validateCustomerValues({ company: 'A', email: 'a@b.co' })).toEqual({});
  });
});

describe('withEmail', () => {
  it('carries the marketing email while they match, then leaves it', () => {
    expect(withEmail({ email: 'a@x.co', marketingEmail: 'a@x.co' }, 'b@x.co').marketingEmail).toBe('b@x.co');
    expect(withEmail({ email: '', marketingEmail: '' }, 'b@x.co').marketingEmail).toBe('b@x.co');
    expect(withEmail({ email: 'a@x.co', marketingEmail: 'm@x.co' }, 'b@x.co').marketingEmail).toBe('m@x.co');
  });
});

describe('countCustomerChanges', () => {
  const start = customerToFormValues({ company: 'Cascade', email: 'd@c.com', address: { city: 'Kent' } });
  it('counts flat and address fields', () => {
    expect(countCustomerChanges(start, start)).toBe(0);
    expect(countCustomerChanges({ ...start, company: 'Cascade ' }, start)).toBe(0);
    expect(countCustomerChanges({ ...start, phone: '1', address: { ...start.address, zipCode: '98032' } }, start)).toBe(2);
    expect(countCustomerChanges({ ...start, receiveMarketing: false }, start)).toBe(1);
  });
});

describe('applyCardScan', () => {
  const start = emptyCustomerValues();
  it('fills only what the card had', () => {
    const { values, found } = applyCardScan(start, { company: 'NW Granite', customerName: '', phone: '', email: 'm@nw.com', address: { city: 'Seattle' } });
    expect(found).toBe(true);
    expect(values.company).toBe('NW Granite');
    expect(values.email).toBe('m@nw.com');
    expect(values.marketingEmail).toBe('m@nw.com');
    expect(values.address.city).toBe('Seattle');
    expect(values.address.street).toBe('');
    expect(start.address.city).toBe('');
  });

  it('reports nothing found', () => {
    expect(applyCardScan(start, { company: '', address: {} }).found).toBe(false);
    expect(applyCardScan(start, null).found).toBe(false);
  });
});

describe('customerLastChangedText', () => {
  const now = new Date('2026-10-05T12:00:00');
  it('uses the last change, else when it was added', () => {
    expect(customerLastChangedText({ updatedAt: '2026-09-30T10:00:00' }, now)).toBe('Last changed Sep 30');
    expect(customerLastChangedText({ createdAt: '2026-08-01T10:00:00' }, now)).toBe('Added Aug 1');
    expect(customerLastChangedText({}, now)).toBe('');
  });
});
