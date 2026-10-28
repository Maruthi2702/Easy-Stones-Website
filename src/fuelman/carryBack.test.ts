import { describe, expect, it } from 'vitest';
import { impliedAssignments } from './carryBack';
import type { DriverOption, ReviewDriver } from './types';
const user = (key: string, locations: string[]): DriverOption => ({ key, name: key, active: true, locations, kind: 'user' });
const driver = (over: Partial<ReviewDriver> = {}) => ({ externalId: 'A', name: 'Driver Alp', suggestedFrom: '2026-08-01',
  carriedFrom: { driverKey: 'u1', driverName: 'Driver Alpha', location: 'Seattle', since: '2026-09-01' }, ...over }) as ReviewDriver;
describe('carrying a later month\'s match back without asking', () => {
  it('does so only when the driver\'s account has that one location, ending where the later match begins', () => {
    expect(impliedAssignments([driver()], [user('u1', ['Seattle'])])).toEqual([{ id: 'implied:A', externalId: 'A', reportedName: 'Driver Alp', driverKey: 'u1', driverName: 'Driver Alpha',
      from: '2026-08-01', to: '2026-09-01', allocations: [{ location: 'Seattle', basisPoints: 10000 }], implied: true }]);
  });
  it('asks a person when the account is for several locations, all of them, another one, or is gone', () => {
    for (const locations of [['Seattle', 'Spokane'], ['*'], ['Spokane'], []]) expect(impliedAssignments([driver()], [user('u1', locations)])).toEqual([]);
    expect(impliedAssignments([driver()], [])).toEqual([]);
    expect(impliedAssignments([driver({ carriedFrom: undefined })], [user('u1', ['Seattle'])])).toEqual([]);
  });
});
