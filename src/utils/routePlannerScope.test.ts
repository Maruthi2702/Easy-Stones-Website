import type { Loose } from '../types/records.ts';
import { describe, it, expect } from 'vitest';
import {
  UNASSIGNED, scopeLocationsOf, repsInScope, inScopePins, pinsForReps, repCountsOf, repKeyOf, parseRepKeys
} from './routePlannerScope.ts';

const rep = (id: unknown, location: string, extra: Loose = {}): Loose => ({ _id: id, username: id, role: 'sales_rep', location, assignedLocations: [location], ...extra });
const staff = [
  rep('dana', 'Kent'), rep('marcus', 'Kent'), rep('alex', 'Seattle'), rep('chris', 'Spokane'),
  { _id: 'drv', username: 'drv', role: 'driver', location: 'Kent', assignedLocations: ['Kent'] },
  { _id: 'adm', username: 'admin', role: 'admin', location: 'Kent', assignedLocations: ['*'] },
  { _id: 'both', username: 'both', role: 'manager', location: 'Seattle', assignedLocations: ['Seattle', 'Spokane'] }
];
const pin = (id: unknown, salesRep: unknown, location: string): Loose => ({ _id: id, salesRep, location });
const pins = [
  pin(1, 'dana', 'Kent'), pin(2, 'marcus', 'Kent'), pin(3, 'alex', 'Seattle'), pin(4, 'chris', 'Spokane'),
  pin(5, null, 'Kent'), pin(6, null, 'Spokane'), pin(7, null, 'Seattle')
];
const manager = { id: 'mgr', role: 'manager', assignedLocations: ['Kent', 'Seattle'], location: 'Kent' };
const kentRep = { id: 'dana', role: 'sales_rep', assignedLocations: ['Kent'], location: 'Kent' };

describe('scopeLocationsOf', () => {
  it('is everything for an admin or an all-locations login', () => {
    expect(scopeLocationsOf({ role: 'admin', assignedLocations: ['Kent'] })).toBeNull();
    expect(scopeLocationsOf({ role: 'manager', assignedLocations: ['*'] })).toBeNull();
  });
  it('is their assigned locations plus home, no repeats, for anyone else', () => {
    expect(scopeLocationsOf(manager)).toEqual(['Kent', 'Seattle']);
  });
  it('is nothing for nobody', () => expect(scopeLocationsOf(null)).toEqual([]));
});

describe('repsInScope', () => {
  const ids = (user: Loose) => repsInScope(user, staff).map((r) => r._id);
  it('shows a manager only the reps at their locations — never Spokane', () => {
    expect(ids(manager)).toEqual(['dana', 'marcus', 'alex', 'both']);
  });
  it('gives a sales rep every rep at their location for now', () => {
    expect(ids(kentRep)).toEqual(['dana', 'marcus']);
  });
  it('includes a rep who is assigned several locations when one matches', () => {
    expect(ids({ id: 'x', role: 'manager', assignedLocations: ['Spokane'] })).toContain('both');
  });
  it('gives admins and all-location logins everyone who can own accounts — never drivers or the shared admin login', () => {
    expect(ids({ id: 'a', role: 'admin' })).toEqual(['dana', 'marcus', 'alex', 'chris', 'both']);
  });
  it('gives someone with no locations only themselves', () => {
    expect(repsInScope({ id: 'dana', role: 'sales_rep' }, staff).map((r) => r._id)).toEqual(['dana']);
  });
});

describe('inScopePins', () => {
  const ids = (user: Loose) => inScopePins(pins, user, staff).map((p) => p._id);
  it('never includes another location’s customers or unassigned ones', () => {
    expect(ids(manager)).toEqual([1, 2, 3, 5, 7]);
  });
  it('limits a Kent rep to Kent', () => expect(ids(kentRep)).toEqual([1, 2, 5]));
  it('gives an admin everything', () => expect(ids({ id: 'a', role: 'admin' })).toEqual([1, 2, 3, 4, 5, 6, 7]));
  it('drops customers whose rep is out of scope even at an in-scope location', () => {
    const outsider = pin(8, 'chris', 'Kent');
    expect(inScopePins([outsider], manager, staff)).toEqual([]);
  });
});

describe('asking for reps', () => {
  const scoped = inScopePins(pins, manager, staff);
  it('returns only the named reps’ customers', () => {
    expect(pinsForReps(scoped, ['dana']).map((p) => p._id)).toEqual([1]);
    expect(pinsForReps(scoped, ['dana', UNASSIGNED]).map((p) => p._id)).toEqual([1, 5, 7]);
  });
  it('can’t be used to reach a rep outside the scope', () => {
    expect(pinsForReps(scoped, ['chris'])).toEqual([]);
  });
  it('counts per rep key', () => {
    expect(repCountsOf(scoped)).toEqual({ dana: 1, marcus: 1, alex: 1, [UNASSIGNED]: 2 });
    expect(repKeyOf({})).toBe(UNASSIGNED);
  });
  it('reads the reps a request names', () => {
    expect(parseRepKeys('a, b,,unassigned')).toEqual(['a', 'b', UNASSIGNED]);
    expect(parseRepKeys('')).toEqual([]);
    expect(parseRepKeys(undefined)).toBeNull();
  });
});
