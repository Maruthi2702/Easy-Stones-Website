import { describe, it, expect } from 'vitest';
import { LETTER_HIDE, parseHide, hideParam, addressLinesOf, letterModel } from './holdLetter.js';
import { expiryMoments } from './holdRules.js';

const NOW = new Date('2026-10-10T15:37:00Z'); // Oct 10, 8:37 AM in Seattle
const line = (serial, over = {}) => ({
  slabKey: serial, serial, barcode: `ES${serial.replace(/\D/g, '')}`, product: 'Taj Mahal 3CM', bundle: '007766AG/14744',
  slabNumber: '14', block: '004143', bin: 'A-12', location: 'Seattle', dimensions: '119" x 78"', sfHundredths: 6446, priceCentsPerSf: 2450, note: '', ...over
});
const hold = (over = {}) => ({
  _id: 'h1', number: 25, status: 'active', state: 'active', branch: 'Seattle', expiresOn: '2026-10-16', ...expiryMoments('2026-10-16', 'Seattle'),
  createdAt: '2026-10-09T16:00:00Z', createdBy: { name: 'Krish' }, job: 'Miller kitchen', notes: 'INTERNAL', commissionNotes: 'SECRET', chanceToClose: 75,
  customer: { name: 'Granite and Marble Specialties', address: '18640 68th Ave S\nKent, WA 98032', contact: 'Kurt Karimov', phone: '425-282-6323', email: 'olena@granitemarblewa.com' },
  lines: [line('14744-29'), line('14744-30')], ...over
});
const LH = { addressLine: '6012 S 196th St, Kent, WA 98032', contactLine: '' };

describe('hide options', () => {
  it('parse the ?hide= list, keep their own order and drop unknown keys', () => {
    expect(LETTER_HIDE.map((h) => h.key)).toEqual(['inventory', 'unitPrice', 'pricing', 'totals']);
    expect(parseHide('totals, unitPrice,bogus')).toEqual({ totals: true, unitPrice: true });
    expect(parseHide(undefined)).toEqual({});
    expect(hideParam({ totals: true, inventory: true, nope: true })).toBe('inventory,totals');
    expect(hideParam({})).toBe('');
  });
});

describe('letterModel', () => {
  it('has the letterhead, number, dates and the branch clock', () => {
    const m = letterModel(hold(), { letterhead: LH, now: NOW });
    expect(m).toMatchObject({ title: 'Hold Information Letter - Customer', company: 'Easy Stones - Seattle', number: '25', date: 'Oct 9, 2026' });
    expect(m.address).toEqual(['6012 S 196th St', 'Kent, WA 98032']);
    expect(m.printed).toBe('printed on Saturday, October 10, 2026 at 8:37 AM');
    expect(m.info.map((i) => i.value)).toEqual(['Krish', 'Oct 16, 2026', 'Seattle']);
    expect(m.standing).toBe('These slabs are held for you until the end of Oct 16, 2026.');
  });

  it('never carries internal notes, commission notes or chance to close', () => {
    const text = JSON.stringify(letterModel(hold(), { letterhead: LH, now: NOW }));
    expect(text).not.toMatch(/INTERNAL|SECRET|75%/);
  });

  it('bills to the customer, line by line', () => {
    expect(letterModel(hold(), { now: NOW }).billTo).toEqual([
      'Granite and Marble Specialties', '18640 68th Ave S', 'Kent, WA 98032', 'Kurt Karimov', 'P: 425-282-6323', 'E: olena@granitemarblewa.com'
    ]);
  });

  it('prices a product once when its slabs share a price, per slab when they differ', () => {
    const same = letterModel(hold(), { now: NOW }).groups[0];
    expect(same).toMatchObject({ title: 'Taj Mahal 3CM (2)', quantity: '128.92 SF', unit: '$24.50', extended: '$3,158.54' });
    expect(same.rows[0]).toMatchObject({ serial: '14744-29', quantity: '119" x 78" = 64.46', unit: '', extended: '' });
    const differ = letterModel(hold({ lines: [line('14744-29'), line('14744-30', { priceCentsPerSf: 2600 })] }), { now: NOW }).groups[0];
    expect(differ.unit).toBe('Varies');
    expect(differ.rows.map((r) => [r.unit, r.extended])).toEqual([['$24.50', '$1,579.27'], ['$26.00', '$1,675.96']]);
  });

  it('marks what is priced so far when a slab has no price', () => {
    const m = letterModel(hold({ lines: [line('14744-29'), line('14744-30', { priceCentsPerSf: null })] }), { now: NOW });
    expect(m.groups[0].extended).toBe('$1,579.27*');
    expect(m.totals).toMatchObject({ label: 'Total so far', amount: '$1,579.27', missing: '* 1 slab has no price yet' });
  });

  it('hides what the boxes say', () => {
    const noList = letterModel(hold(), { hide: { inventory: true }, now: NOW });
    expect(noList.groups[0].rows).toEqual([]);
    expect(noList.columns.inventory).toBe(false);
    const noUnit = letterModel(hold(), { hide: { unitPrice: true }, now: NOW });
    expect(noUnit.groups[0]).toMatchObject({ unit: '', extended: '$3,158.54' });
    expect(noUnit.columns).toMatchObject({ unit: false, extended: true });
    const noPricing = letterModel(hold(), { hide: { pricing: true }, now: NOW });
    expect(noPricing.groups[0]).toMatchObject({ unit: '', extended: '' });
    expect(noPricing.totals).toBeNull();
    expect(letterModel(hold(), { hide: { totals: true }, now: NOW }).totals).toBeNull();
  });

  it('says plainly when a hold has expired or was released', () => {
    expect(letterModel(hold({ state: 'expired', expiresOn: '2026-10-08' }), { now: NOW }).standing).toBe('This hold expired on Oct 8, 2026. Contact your sales rep to keep these slabs.');
    expect(letterModel(hold({ state: 'released', status: 'released', releasedAt: '2026-10-10T01:00:00Z' }), { now: NOW }).standing).toBe('This hold was released on Oct 9, 2026. These slabs are no longer held.');
  });

  it('splits a one-line address for the letterhead', () => {
    expect(addressLinesOf('6012 S 196th St, Kent, WA 98032')).toEqual(['6012 S 196th St', 'Kent, WA 98032']);
    expect(addressLinesOf('Just a street')).toEqual(['Just a street']);
    expect(addressLinesOf('')).toEqual([]);
  });
});
