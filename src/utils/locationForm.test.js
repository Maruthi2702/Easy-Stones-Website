import { describe, it, expect } from 'vitest';
import {
  emptyLocationValues, locationToFormValues, locationRecordFromValues, validateLocationValues,
  countLocationChanges, parseLocationBody, addressLines, letterheadFor, publicLocationFields, DEFAULT_LETTERHEAD
} from './locationForm.js';

// The company-location record the form was modelled on.
const charlotte = {
  _id: 'clt',
  name: 'Charlotte',
  fullName: 'Easy Stones - Charlotte',
  shortCode: 'CLT',
  region: 'Carolinas - North-South Carolinas',
  rdc: 'Charleston',
  profitCenter: true,
  warehouse: true,
  primaryContact: {
    name: 'Abhinav Meduri', email: 'info.clt@easystones.com', phone: '(980) 201-9506', fax: '(980) 225-7952',
    website: 'www.easystones.com',
    address: { street: '1440 Westinghouse Blvd', suite: 'Suite A', city: 'Charlotte', state: 'NC', zipCode: '28273' }
  },
  accountingSameAsPrimary: true,
  salesDefaults: { salesRep: 'Abhi', priceLevel: 2, paymentTerms: 'C.O.D', salesTaxArea: 'NC - Mecklenburg', salesTaxRate: 7.25 },
  costOverrides: { avgUnitFreight: 1.5, unitOverheadPct: 35 }
};
const others = [
  { _id: 'sea', name: 'Seattle', shortCode: 'SEA' },
  { _id: 'chs', name: 'Charleston', shortCode: 'CHS' },
  charlotte
];
const valid = () => ({
  ...emptyLocationValues(),
  fullName: 'Easy Stones - Portland', name: 'Portland', shortCode: 'pdx',
  street: '1 Main St', city: 'Portland', state: 'or', zip: '97201'
});

describe('round trip', () => {
  it('turns a record into form values and back without losing anything', () => {
    const back = locationRecordFromValues(locationToFormValues(charlotte));
    expect(back.fullName).toBe('Easy Stones - Charlotte');
    expect(back.primaryContact).toEqual(charlotte.primaryContact);
    expect(back.salesDefaults).toEqual(charlotte.salesDefaults);
    expect(back.costOverrides).toEqual(charlotte.costOverrides);
    expect(back.profitCenter && back.warehouse).toBe(true);
  });

  it('uppercases the short code and state, formats phones, turns blank numbers into null', () => {
    const r = locationRecordFromValues({ ...valid(), phone: '9802019506' });
    expect(r.shortCode).toBe('PDX');
    expect(r.primaryContact.address.state).toBe('OR');
    expect(r.primaryContact.phone).toBe('(980) 201-9506');
    expect(r.salesDefaults.priceLevel).toBeNull();
    expect(r.costOverrides.avgUnitFreight).toBeNull();
  });

  it('clears the accounting contact while "same as primary" is ticked', () => {
    const r = locationRecordFromValues({ ...valid(), acctSameAsPrimary: true, acctName: 'Old name' });
    expect(r.accountingContact.name).toBe('');
  });

  it('treats an old record without the new fields as an empty form', () => {
    const v = locationToFormValues({ _id: 'x', name: 'Spokane', shortCode: 'SPK' });
    expect(v.name).toBe('Spokane');
    expect(v.street).toBe('');
    expect(v.acctSameAsPrimary).toBe(true);
  });
});

describe('validateLocationValues', () => {
  it('accepts a minimal valid location', () => {
    expect(validateLocationValues(valid(), { others })).toEqual({});
  });

  it('requires the names and the address', () => {
    const e = validateLocationValues(emptyLocationValues(), { others });
    expect(Object.keys(e).sort()).toEqual(['city', 'fullName', 'name', 'state', 'street', 'zip']);
  });

  it('flags a short name or code another location already has', () => {
    const e = validateLocationValues({ ...valid(), name: 'seattle', shortCode: 'chs' }, { others });
    expect(e.name).toBe('seattle already exists');
    expect(e.shortCode).toMatch(/CHS is already used/);
  });

  it('does not flag the location against itself when editing', () => {
    const e = validateLocationValues(locationToFormValues(charlotte), { isEdit: true, selfId: 'clt', others });
    expect(e).toEqual({});
  });

  it('only allows another existing location as the RDC', () => {
    expect(validateLocationValues({ ...valid(), rdc: 'Charleston' }, { others }).rdc).toBeUndefined();
    expect(validateLocationValues({ ...valid(), rdc: 'Nowhere' }, { others }).rdc).toBe('Choose another location');
    expect(validateLocationValues({ ...valid(), rdc: 'Portland' }, { others }).rdc).toBe('Choose another location');
  });

  it('checks formats of optional fields only when filled', () => {
    const e = validateLocationValues({
      ...valid(), state: 'Oregon', zip: '972', phone: '(503) 555', fax: '123', email: 'a@b', website: 'not a site',
      salesTaxRate: '25', avgUnitFreight: 'abc', unitOverheadPct: '101', priceLevel: '7', paymentTerms: 'Net 90'
    }, { others });
    expect(Object.keys(e).sort()).toEqual([
      'avgUnitFreight', 'email', 'fax', 'paymentTerms', 'phone', 'priceLevel', 'salesTaxRate', 'state', 'unitOverheadPct', 'website', 'zip'
    ]);
  });

  it('checks the accounting contact only when it is separate', () => {
    const bad = { acctEmail: 'nope', acctZip: '1', acctState: 'Carolina', acctPhone: '12' };
    expect(validateLocationValues({ ...valid(), ...bad, acctSameAsPrimary: true }, { others })).toEqual({});
    expect(Object.keys(validateLocationValues({ ...valid(), ...bad, acctSameAsPrimary: false }, { others })).sort())
      .toEqual(['acctEmail', 'acctPhone', 'acctState', 'acctZip']);
  });

  it('only accepts C.O.D as payment terms for now, and new locations start on it', () => {
    expect(emptyLocationValues().paymentTerms).toBe('C.O.D');
    expect(validateLocationValues({ ...valid(), paymentTerms: 'Net 30' }, { others }).paymentTerms).toBe('Choose payment terms');
    expect(validateLocationValues({ ...valid(), paymentTerms: '' }, { others }).paymentTerms).toBeUndefined();
  });

  it('caps text length', () => {
    expect(validateLocationValues({ ...valid(), region: 'x'.repeat(301) }, { others }).region).toBe('Too long');
  });
});

describe('countLocationChanges', () => {
  it('counts text and checkbox changes, ignoring surrounding spaces', () => {
    const initial = locationToFormValues(charlotte);
    expect(countLocationChanges({ ...initial, region: ' Carolinas - North-South Carolinas ' }, initial)).toBe(0);
    expect(countLocationChanges({ ...initial, warehouse: false, phone: '' }, initial)).toBe(2);
  });
});

describe('parseLocationBody (server)', () => {
  it('returns the record for a valid body', () => {
    const { record, errors } = parseLocationBody(locationRecordFromValues(valid()), { others });
    expect(errors).toBeUndefined();
    expect(record.name).toBe('Portland');
  });

  it('returns the same errors the form shows', () => {
    const { errors } = parseLocationBody({ name: 'Seattle' }, { others });
    expect(errors.name).toBe('Seattle already exists');
    expect(errors.street).toBe('Enter the street address');
  });

  it('never renames a location on edit', () => {
    const body = { ...charlotte, name: 'Renamed' };
    const { record } = parseLocationBody(body, { isEdit: true, current: charlotte, others });
    expect(record.name).toBe('Charlotte');
  });
});

describe('letterhead', () => {
  it('prints the location’s own address, without the contact line for now', () => {
    expect(letterheadFor(charlotte)).toEqual({
      addressLine: '1440 Westinghouse Blvd, Suite A, Charlotte, NC 28273',
      contactLine: ''
    });
  });

  it('falls back to the Kent address for a location with none yet', () => {
    expect(letterheadFor({ name: 'Spokane' })).toEqual(DEFAULT_LETTERHEAD);
    expect(letterheadFor(null)).toEqual(DEFAULT_LETTERHEAD);
  });

  it('formats address lines without empty parts', () => {
    expect(addressLines({ street: '1 Main St', city: 'Portland', state: 'OR' })).toEqual(['1 Main St', 'Portland, OR']);
  });
});

describe('publicLocationFields', () => {
  it('drops accounting, sales defaults and cost overrides', () => {
    const p = publicLocationFields(charlotte);
    expect(p.primaryContact).toEqual(charlotte.primaryContact);
    expect(p).not.toHaveProperty('costOverrides');
    expect(p).not.toHaveProperty('salesDefaults');
    expect(p).not.toHaveProperty('accountingContact');
  });
});
