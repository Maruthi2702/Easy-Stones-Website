import { describe, it, expect } from 'vitest';
import { buildImportPlan, IMPORT_FIELDS } from './customerImport.js';

/**
 * Maps every importable field straight to a same-named header, so a test row
 * can just be written as { fieldName: value, ... } without a real spreadsheet
 * (and its header-detection guesswork) in between.
 */
const mapping = Object.fromEntries(IMPORT_FIELDS.map(f => [f, f]));

const existingCustomer = (over = {}) => ({
  _id: 'existing1',
  company: 'Acme Tile',
  contactName: 'Jane Doe',
  email: 'jane@acmetile.com',
  phone: '206-555-0100',
  address: { city: 'Seattle' },
  salesRep: null,
  salesRepName: '',
  location: 'Seattle',
  isActive: true,
  createdAt: '2026-01-01',
  ...over
});

const plan = (rows, existing = []) => buildImportPlan({
  headers: IMPORT_FIELDS,
  rows,
  mapping,
  branchByKey: new Map(),
  repByKey: new Map(),
  existing
});

describe('needsReview threshold — the review queue on a routine re-import', () => {
  it('does not stop for a match that only shares an email domain', () => {
    const result = plan(
      [{
        company: 'Totally Different LLC',
        contactName: 'Bob Smith',
        email: 'bob@acmetile.com', // same domain as the existing customer, nothing else in common
        phone: '425-555-9999'
      }],
      [existingCustomer()]
    );

    expect(result.planned).toHaveLength(1);
    expect(result.planned[0].action).toBe('create');
    expect(result.planned[0].warnings.some(w => w.includes('Shares only an email domain'))).toBe(true);
  });

  it('still stops for a match on company name alone', () => {
    const result = plan(
      [{
        company: 'Acme Tile', // same normalized company key as the existing customer
        contactName: 'New Contact',
        email: 'newcontact@totallydifferent.org',
        phone: '999-999-9999'
      }],
      [existingCustomer({ email: 'contact@differentdomain.com', phone: '111-111-1111' })]
    );

    expect(result.planned).toHaveLength(1);
    expect(result.planned[0].action).toBe('review');
  });

  it('still stops for a match on phone alone', () => {
    const result = plan(
      [{
        company: 'Something Else Inc',
        contactName: 'New Contact',
        email: 'new@another-domain.org',
        phone: '206-555-0100' // same as the existing customer
      }],
      [existingCustomer({ company: 'Unrelated Co', email: 'x@unrelated-domain.com' })]
    );

    expect(result.planned).toHaveLength(1);
    expect(result.planned[0].action).toBe('review');
  });

  it('still stops when two existing customers are both plausible matches', () => {
    const result = plan(
      [{
        company: 'Acme Tile',
        contactName: 'New Contact',
        email: 'new@acmetile.com', // shares company key with #1 and domain with both
        phone: '206-555-0200' // shares phone with #2
      }],
      [
        existingCustomer({ _id: 'existing1', email: 'jane@acmetile.com', phone: '111-111-1111' }),
        existingCustomer({ _id: 'existing2', company: 'Different Co', email: 'x@acmetile.com', phone: '206-555-0200' })
      ]
    );

    expect(result.planned).toHaveLength(1);
    expect(result.planned[0].action).toBe('review');
  });
});

describe('marketingEmail / receiveMarketing / quickNote import', () => {
  it('carries all three through to the create payload', () => {
    const result = plan([{
      company: 'Fresh Co',
      contactName: 'Fresh Contact',
      email: 'fresh@freshco.com',
      phone: '111-222-3333',
      marketingEmail: 'MARKETING@freshco.com',
      receiveMarketing: 'No',
      quickNote: 'Prefers email contact'
    }]);

    expect(result.planned).toHaveLength(1);
    const { create } = result.planned[0];
    expect(create.marketingEmail).toBe('marketing@freshco.com');
    expect(create.receiveMarketing).toBe(false);
    expect(create.quickNote).toBe('Prefers email contact');
  });

  it('defaults marketingEmail to the stored email when the sheet has none', () => {
    const result = plan([{
      company: 'NoMarketing Co',
      contactName: 'No One',
      email: 'x@nomarketing.com',
      phone: '444-555-6666'
    }]);

    const { create } = result.planned[0];
    expect(create.marketingEmail).toBe(create.email);
    expect(create.email).toBe('x@nomarketing.com');
  });

  it('defaults receiveMarketing to true when the sheet has none, matching the schema default', () => {
    const result = plan([{
      company: 'NoMarketing Co',
      contactName: 'No One',
      email: 'x@nomarketing2.com',
      phone: '444-555-7777'
    }]);

    expect(result.planned[0].create.receiveMarketing).toBe(true);
  });
});
