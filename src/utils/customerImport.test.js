import { describe, it, expect } from 'vitest';
import { buildImportPlan, IMPORT_FIELDS, importRowKey } from './customerImport.js';

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

const plan = (rows, existing = [], extra = {}) => buildImportPlan({
  headers: IMPORT_FIELDS,
  rows,
  mapping,
  branchByKey: new Map(),
  repByKey: new Map(),
  existing,
  ...extra
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

describe('existing customers — fill blanks only', () => {
  // Same company and email as the existing record: a single strong match,
  // so the row plans an update rather than a create or a review.
  const sameBusiness = (over = {}) => ({
    company: 'Acme Tile',
    contactName: 'Jane Doe',
    email: 'jane@acmetile.com',
    ...over
  });

  it('fills a blank phone and street, and leaves a city the CRM already has', () => {
    const result = plan(
      [sameBusiness({ phone: '206-555-0199', street: '1 Main St', city: 'Tacoma' })],
      [existingCustomer({ phone: '', address: { city: 'Seattle' } })]
    );

    const row = result.planned[0];
    expect(row.action).toBe('update');
    expect(row.apply.phone).toBe('206-555-0199');
    expect(row.apply['address.street']).toBe('1 Main St');
    expect(row.apply['address.city']).toBeUndefined();
    expect(row.changes.map(c => c.field)).toEqual(expect.arrayContaining(['phone', 'street']));
  });

  it('marks the geocode pending when it fills any part of the address, so the backfill script picks it up', () => {
    const result = plan(
      [sameBusiness({ street: '1 Main St' })],
      [existingCustomer({ address: { city: 'Seattle' } })]
    );

    expect(result.planned[0].apply['geocode.status']).toBe('pending');
  });

  it('never overwrites a value the CRM already holds', () => {
    const result = plan(
      [sameBusiness({ phone: '999-999-9999', quickNote: 'From the sheet' })],
      [existingCustomer({ quickNote: 'Typed by a rep' })]
    );

    expect(result.planned[0].action).toBe('unchanged');
  });

  it("treats 'N/A' as blank", () => {
    const result = plan(
      [sameBusiness({ contactName: 'Real Person' })],
      [existingCustomer({ contactName: 'N/A' })]
    );

    expect(result.planned[0].apply.contactName).toBe('Real Person');
  });

  it("replaces an earlier import's placeholder email with the sheet's real one", () => {
    const result = plan(
      [{ company: 'Acme Tile', phone: '206-555-0100', email: 'real@acmetile.com' }],
      [existingCustomer({ email: 'na+acmetile@easystones-client.com' })]
    );

    const row = result.planned[0];
    expect(row.action).toBe('update');
    expect(row.apply.email).toBe('real@acmetile.com');
  });
});

describe('remembered choices from earlier uploads', () => {
  // A company-name-only match: resembles the existing customer, not closely
  // enough to be sure — the row goes to review unless something settles it.
  const lookalike = {
    company: 'Acme Tile',
    contactName: 'New Contact',
    email: 'newcontact@totallydifferent.org',
    phone: '999-999-9999'
  };
  const lookalikeKey = importRowKey({ ...lookalike, email: lookalike.email.toLowerCase() });
  const target = () => existingCustomer({ email: 'contact@differentdomain.com', phone: '111-111-1111' });

  it('settles a flagged row with a remembered decision instead of asking again', () => {
    const result = plan([lookalike], [target()], { decisionsByKey: { [lookalikeKey]: 'existing1' } });

    expect(result.planned[0].action).not.toBe('review');
    expect(result.planned[0].targetId).toBe('existing1');
    expect(result.rememberedDecisionsUsed).toBe(1);
  });

  it('lets a decision made in this upload override the remembered one', () => {
    const result = plan([lookalike], [target()], {
      decisionsByKey: { [lookalikeKey]: 'existing1' },
      decisions: { 2: 'create' }
    });

    expect(result.planned[0].action).toBe('create');
    expect(result.rememberedDecisionsUsed).toBe(0);
  });

  it('ignores a remembered decision naming a customer the row does not match', () => {
    const result = plan([lookalike], [target()], { decisionsByKey: { [lookalikeKey]: 'someone-else' } });

    expect(result.planned[0].action).toBe('review');
  });

  it('stops asking about a sales rep decided as "leave unassigned"', () => {
    const result = plan(
      [{ company: 'Fresh Co', email: 'x@freshco.com', phone: '111-222-3333', salesRep: 'Brian Standow' }],
      [],
      { repByKey: new Map([['brianstandow', false]]) }
    );

    const row = result.planned[0];
    expect(result.unresolvedReps).toEqual([]);
    expect(row.warnings.some(w => w.includes('not a selectable sales rep'))).toBe(false);
    expect(row.create.salesRep).toBeUndefined();
  });
});

describe('importRowKey', () => {
  it('is the same for the same business however the sheet formats it', () => {
    expect(importRowKey({ company: 'Great Floors LLC-Boise', email: 'AP@greatfloors.com', phone: '(208) 475-9996' }))
      .toBe(importRowKey({ company: 'GREAT FLOORS LLC - BOISE', email: 'ap@greatfloors.com', phone: '208-475-9996' }));
  });

  it('tells apart branches that share one email', () => {
    expect(importRowKey({ company: 'Great Floors LLC-Boise', email: 'ap@greatfloors.com', phone: '2084759996' }))
      .not.toBe(importRowKey({ company: 'Great Floors LLC-Caldwell', email: 'ap@greatfloors.com', phone: '2084755309' }));
  });

  it('only uses characters that are safe in a Mongo map key', () => {
    expect(importRowKey({ company: 'A.B. & Co.', email: 'x.y@z.com', phone: '+1 (206) 555.0100' })).toMatch(/^[a-z0-9|]*$/);
  });
});
