import { describe, it, expect } from 'vitest';
import {
  statusMeta, STATUSES, companyOf, contactOf, cityLineOf, initialsOf, primaryEmailOf,
  extraContactCount, dataIssues, savedViewQuery, letterQuery, addDays, scopedFilterOptions,
  groupRepsByLocation, contactCard, emailListFor, isSavedView
} from './customerList.js';

describe('statusMeta', () => {
  it('gives short labels and marks closed-out statuses', () => {
    expect(statusMeta('Trying to Onboard')).toMatchObject({ short: 'Onboarding', closed: false });
    expect(statusMeta('Contacted / In Discussion').short).toBe('In discussion');
    expect(statusMeta('Different Sales Person')).toMatchObject({ short: 'Other rep', closed: true });
    expect(statusMeta('Inactive').closed).toBe(true);
  });
  it('treats an unknown or missing status as closed rather than crashing', () => {
    expect(statusMeta(undefined)).toMatchObject({ short: 'No status', closed: true });
    expect(statusMeta('Something new').short).toBe('Something new');
  });
  it('lists all seven stored statuses', () => {
    expect(STATUSES).toHaveLength(7);
  });
});

describe('display helpers', () => {
  it('falls back from company to name to contact', () => {
    expect(companyOf({ company: ' GDS ' })).toBe('GDS');
    expect(companyOf({ name: 'Ash' })).toBe('Ash');
    expect(companyOf({})).toBe('Customer');
  });
  it('hides a contact that only repeats the company or is "Unknown"', () => {
    expect(contactOf({ company: 'Ash', contactName: 'Ash' })).toBe('');
    expect(contactOf({ company: 'X', contactName: 'Unknown' })).toBe('');
    expect(contactOf({ company: 'X', contactName: 'Derek' })).toBe('Derek');
  });
  it('builds a city line from whatever parts exist', () => {
    expect(cityLineOf({ address: { city: 'Mukilteo', state: 'WA', zipCode: '98275' } })).toBe('Mukilteo, WA 98275');
    expect(cityLineOf({ city: 'Auburn' })).toBe('Auburn');
    expect(cityLineOf({})).toBe('');
  });
  it('makes initials', () => {
    expect(initialsOf('Five Star Granite, Inc.')).toBe('FS');
    expect(initialsOf('')).toBe('?');
  });
});

describe('emails and contacts', () => {
  it('skips placeholder and own-domain addresses', () => {
    expect(primaryEmailOf({ email: 'noemail@x.com, real@shop.com' })).toBe('real@shop.com');
    expect(primaryEmailOf({ email: 'vishnu@easystones.com' })).toBe('');
  });
  it('counts extra addresses in the field plus the contacts list', () => {
    expect(extraContactCount({ email: 'a@shop.com,b@shop.com', contactsCount: 2 })).toBe(3);
    expect(extraContactCount({ email: 'a@shop.com', contacts: [{}] })).toBe(1);
    expect(extraContactCount({ email: 'a@shop.com' })).toBe(0);
  });
});

describe('dataIssues', () => {
  const complete = {
    phone: '(425) 295-5383', email: 'derek@fsgranite.com',
    address: { street: '1 Main St', city: 'Mukilteo' }, geocode: { status: 'ok' }
  };
  it('is empty for a complete record', () => {
    expect(dataIssues(complete)).toEqual([]);
  });
  it('names each missing piece', () => {
    expect(dataIssues({ ...complete, phone: '' })).toEqual(['No phone']);
    expect(dataIssues({ ...complete, email: 'temp@temp-customer.com' })).toEqual(['No email']);
    expect(dataIssues({ ...complete, address: { city: 'X' } })).toEqual(['No street address']);
    expect(dataIssues({ ...complete, geocode: { status: 'failed' } })).toEqual(['Address not found on map']);
  });
  it('does not flag a geocode that simply has not run yet', () => {
    expect(dataIssues({ ...complete, geocode: { status: 'pending' } })).toEqual([]);
  });
});

describe('savedViewQuery', () => {
  it('scopes "My accounts" to the caller, through the id converter', () => {
    expect(savedViewQuery('mine', { userId: 'u1', toId: (x) => `oid(${x})` })).toEqual({ salesRep: 'oid(u1)' });
  });
  it('matches nothing for "My accounts" without a user, rather than everything', () => {
    expect(savedViewQuery('mine', {})).toEqual({ _id: null });
  });
  it('matches nothing when the id cannot be converted, rather than the unassigned accounts', () => {
    expect(savedViewQuery('mine', { userId: 'bad', toId: () => null })).toEqual({ _id: null });
  });
  it('looks a week ahead for follow-ups, inclusive', () => {
    expect(savedViewQuery('followups', { today: '2026-10-02' })).toEqual({
      visits: { $elemMatch: { followUpDate: { $gte: '2026-10-02', $lte: '2026-10-09' } } }
    });
  });
  it('knows its keys', () => {
    expect(savedViewQuery('unassigned')).toEqual({ salesRep: { $in: [null] } });
    expect(savedViewQuery('nope')).toBeNull();
    expect(isSavedView('incomplete')).toBe(true);
    expect(isSavedView('nope')).toBe(false);
  });
});

describe('addDays', () => {
  it('crosses month ends', () => {
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04');
  });
});

describe('letterQuery', () => {
  it('matches the company, or the name when there is no company', () => {
    const q = letterQuery('g');
    expect(q.$or[0].company.test('GDS Countertops')).toBe(true);
    expect(q.$or[0].company.test('Absolute')).toBe(false);
  });
  it('uses # for names that start with a non-letter', () => {
    expect(letterQuery('#').$or[0].company.test('1 Stop Interiors')).toBe(true);
    expect(letterQuery('#').$or[0].company.test('ABI Granite')).toBe(false);
  });
  it('ignores anything that is not a single letter or #', () => {
    expect(letterQuery('')).toBeNull();
    expect(letterQuery('ab')).toBeNull();
    expect(letterQuery('.*')).toBeNull();
  });
});

describe('scopedFilterOptions', () => {
  const reps = [
    { _id: 'k', name: 'Krish', location: 'Seattle' },
    { _id: 'v', name: 'Vishnu', location: 'Seattle' },
    { _id: 's', name: 'Sam', location: 'Spokane' }
  ];
  const locations = ['Seattle', 'Spokane', 'Dallas'];

  it('gives admins and directors everything', () => {
    const o = scopedFilterOptions({ user: { id: 'k', permissions: ['view_all_visits'] }, salesReps: reps, locations });
    expect(o.reps.map(r => r._id)).toEqual(['k', 'v', 's']);
    expect(o.locations).toEqual(locations);
  });
  it('gives a manager the reps and locations in their branches', () => {
    const o = scopedFilterOptions({
      user: { id: 'm', permissions: ['view_branch_visits'], assignedLocations: ['Spokane'] }, salesReps: reps, locations
    });
    expect(o.reps.map(r => r._id)).toEqual(['s']);
    expect(o.locations).toEqual(['Spokane']);
  });
  it('treats a * branch assignment as all', () => {
    const o = scopedFilterOptions({
      user: { id: 'm', permissions: ['view_branch_visits'], assignedLocations: ['*'] }, salesReps: reps, locations
    });
    expect(o.scope).toBe('all');
  });
  it('gives a sales rep only themselves and their own location', () => {
    const o = scopedFilterOptions({
      user: { id: 'k', permissions: [], location: 'Seattle' }, salesReps: reps, locations: [{ name: 'Seattle' }, { name: 'Dallas' }]
    });
    expect(o.reps.map(r => r._id)).toEqual(['k']);
    expect(o.locations).toEqual(['Seattle']);
  });
});

describe('groupRepsByLocation', () => {
  it('keeps the given order within and across groups', () => {
    const g = groupRepsByLocation([{ name: 'A', location: 'Seattle' }, { name: 'B', location: 'Spokane' }, { name: 'C', location: 'Seattle' }]);
    expect(g.map(x => [x.location, x.reps.map(r => r.name)])).toEqual([['Seattle', ['A', 'C']], ['Spokane', ['B']]]);
  });
});

describe('copying', () => {
  it('formats a contact card for Outlook', () => {
    expect(contactCard({ name: 'Derek', email: 'd@x.com', phone: '(425) 1' })).toBe('Derek <d@x.com>, (425) 1');
    expect(contactCard({ email: 'd@x.com' })).toBe('d@x.com');
  });
  it('dedupes emails across customers and drops placeholders', () => {
    expect(emailListFor([{ email: 'a@x.com, b@x.com' }, { email: 'A@x.com' }, { email: 'noemail@foo.com' }])).toBe('a@x.com; b@x.com');
  });
});
