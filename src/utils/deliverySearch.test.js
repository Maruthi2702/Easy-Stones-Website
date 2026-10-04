import { describe, it, expect } from 'vitest';
import {
  normalizeSearchTerm, buildDeliverySearchFilter, sortSearchResults,
  longDateLabel, describeSearchResult
} from './deliverySearch.js';

describe('normalizeSearchTerm', () => {
  it('pulls the bare number out of SO#-style input', () => {
    expect(normalizeSearchTerm('SO#18356').orderNumber).toBe('18356');
    expect(normalizeSearchTerm('so 18356').orderNumber).toBe('18356');
    expect(normalizeSearchTerm('S.O. # 18356').orderNumber).toBe('18356');
    expect(normalizeSearchTerm('#18356').orderNumber).toBe('18356');
    expect(normalizeSearchTerm('18356').orderNumber).toBe('18356');
  });

  it('leaves company names alone', () => {
    expect(normalizeSearchTerm('Solid Surface')).toEqual({ text: 'Solid Surface', orderNumber: '' });
    expect(normalizeSearchTerm('  acme   stone ').text).toBe('acme stone');
  });
});

describe('buildDeliverySearchFilter', () => {
  const regexSource = (re) => re.source;

  it('needs at least 2 characters and some assigned location', () => {
    expect(buildDeliverySearchFilter('a', ['Seattle'])).toBeNull();
    expect(buildDeliverySearchFilter('acme', [])).toBeNull();
    expect(buildDeliverySearchFilter('acme', undefined)).toBeNull();
  });

  it("only returns the user's own locations (and transfers heading to them)", () => {
    const f = buildDeliverySearchFilter('acme', ['Seattle', 'Spokane']);
    expect(f.$and[1]).toEqual({
      $or: [
        { location: { $in: ['Seattle', 'Spokane'] } },
        { deliveryType: 'transfer', transferDestination: { $in: ['Seattle', 'Spokane'] } }
      ]
    });
    // Unlike the board's scope, blank/missing locations are NOT included.
    expect(JSON.stringify(f)).not.toContain('"location":{"$in":["Seattle","Spokane",""');
  });

  it("doesn't scope an admin ('*')", () => {
    const f = buildDeliverySearchFilter('acme', ['*']);
    expect(f.$and).toBeUndefined();
    expect(f.$or).toHaveLength(3);
  });

  it('matches SO#/invoice on the bare number and the name on the raw text', () => {
    const f = buildDeliverySearchFilter('SO#18356', ['*']);
    const [name, so, inv] = f.$or;
    expect(regexSource(name.customerName)).toBe('SO#18356');
    expect(regexSource(so.soNumber)).toBe('18356');
    expect(regexSource(inv.invoiceNumber)).toBe('18356');
  });

  it('escapes regex characters so input is matched literally', () => {
    const f = buildDeliverySearchFilter('A+B (Co.)', ['*']);
    const re = f.$or[0].customerName;
    expect(re.test('a+b (co.) granite')).toBe(true);
    expect(re.test('aab co')).toBe(false);
  });
});

describe('sortSearchResults', () => {
  it('puts undated orders first, then newest date first', () => {
    const out = sortSearchResults([
      { id: 'old', date: '2026-08-01' },
      { id: 'undated', date: '' },
      { id: 'future', date: '2026-10-20' },
      { id: 'mid', date: '2026-09-15' }
    ]).map(d => d.id);
    expect(out).toEqual(['undated', 'future', 'mid', 'old']);
  });
});

describe('longDateLabel', () => {
  it('formats without timezone drift', () => {
    expect(longDateLabel('2026-09-30')).toBe('Wed, Sep 30, 2026');
    expect(longDateLabel('')).toBe('');
  });
});

describe('describeSearchResult', () => {
  const today = '2026-10-03';
  const base = { id: 'x', truckId: 'trk_1', deliveryType: 'jobsite', status: 'scheduled', date: '2026-10-07' };

  it('delivered → Delivered on its date, on the board', () => {
    const r = describeSearchResult({ ...base, status: 'completed', date: '2026-09-30' }, { today });
    expect(r).toEqual({ status: 'delivered', label: 'Delivered', when: 'Wed, Sep 30, 2026', place: 'board', boardDate: '2026-09-30' });
  });

  it('uses pickup/return wording when done', () => {
    expect(describeSearchResult({ ...base, truckId: '', deliveryType: 'will_call', status: 'completed' }, { today }).label).toBe('Picked up');
    expect(describeSearchResult({ ...base, deliveryType: 'return', status: 'completed' }, { today }).label).toBe('Returned');
  });

  it('upcoming → Scheduled; past and not completed → Not marked delivered', () => {
    expect(describeSearchResult(base, { today }).status).toBe('scheduled');
    const past = describeSearchResult({ ...base, date: '2026-09-29' }, { today });
    expect(past.status).toBe('overdue');
    expect(past.label).toBe('Not marked delivered');
  });

  it('no driver → Pending, in the Pending list', () => {
    const r = describeSearchResult({ ...base, truckId: '', date: '' }, { today });
    expect(r).toMatchObject({ status: 'pending', place: 'pending', boardDate: '', when: 'No date yet · waiting on customer' });
    expect(describeSearchResult({ ...base, truckId: '' }, { today }).when).toBe('Wed, Oct 7, 2026 · no driver yet');
  });

  it('cancelled wins over everything else', () => {
    const r = describeSearchResult({ ...base, status: 'cancelled' }, { today });
    expect(r).toMatchObject({ status: 'cancelled', place: 'cancelled', boardDate: '' });
  });

  it('a transfer shows ship → arrival, and the destination jumps to the arrival day', () => {
    const t = { ...base, deliveryType: 'transfer', location: 'Seattle', transferDestination: 'Spokane', date: '2026-10-06', expectedArrivalDate: '2026-10-08' };
    const origin = describeSearchResult(t, { today, viewerLocations: ['Seattle'] });
    expect(origin.when).toBe('Ships Tue, Oct 6, 2026 → arrives Thu, Oct 8, 2026');
    expect(origin.boardDate).toBe('2026-10-06');
    expect(describeSearchResult(t, { today, viewerLocations: ['Spokane'] }).boardDate).toBe('2026-10-08');
  });
});
