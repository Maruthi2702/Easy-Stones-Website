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

describe('SPS export fields — Retail type, suite numbers, account holds', () => {
  it('maps "Retail" to Dealer instead of falling back to Fabricator', () => {
    const result = plan([{
      company: 'Retail Stone Co',
      contactName: 'A Buyer',
      email: 'buyer@retailstone.com',
      phone: '111-111-1111',
      customerType: 'Retail'
    }]);

    expect(result.planned[0].create.customerType).toBe('Dealer');
    // A recognised synonym, not an unmapped value — no "not one of ours" warning.
    expect(result.planned[0].warnings.some(w => w.includes('not one of ours'))).toBe(false);
  });

  it('appends the suite/unit column to the street line rather than dropping it', () => {
    const result = plan([{
      company: 'Suite Co',
      contactName: 'Someone',
      email: 'someone@suiteco.com',
      phone: '222-222-2222',
      street: '3032 Cedar St',
      street2: 'Suite B'
    }]);

    expect(result.planned[0].create.address.street).toBe('3032 Cedar St, Suite B');
  });

  it('leaves the street line alone when there is no suite/unit', () => {
    const result = plan([{
      company: 'No Suite Co',
      contactName: 'Someone',
      email: 'someone@nosuiteco.com',
      phone: '222-222-3333',
      street: '100 Main St'
    }]);

    expect(result.planned[0].create.address.street).toBe('100 Main St');
  });

  it('folds the account alert and delivery instructions into quickNote, alert first', () => {
    const result = plan([{
      company: 'Flagged Co',
      contactName: 'Someone',
      email: 'someone@flaggedco.com',
      phone: '333-333-3333',
      accountAlert: 'BAD DEBT',
      quickNote: 'Prefers email',
      deliveryInstructions: 'Will call only'
    }]);

    expect(result.planned[0].create.quickNote).toBe('⚠ BAD DEBT | Prefers email | Delivery: Will call only');
  });

  it('produces a plain quickNote when there is no alert or delivery instructions', () => {
    const result = plan([{
      company: 'Plain Co',
      contactName: 'Someone',
      email: 'someone@plainco.com',
      phone: '333-333-4444',
      quickNote: 'Just a note'
    }]);

    expect(result.planned[0].create.quickNote).toBe('Just a note');
  });
});
