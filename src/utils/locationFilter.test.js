import { describe, it, expect } from 'vitest';
import {
  ALL_LOCATIONS, locationNames, accessibleLocations, homeLocationOf,
  defaultLocationFor, defaultLocationsFor, resolveStoredLocation, resolveStoredLocations,
  homeLocationProblem, fallbackHomeLocation
} from './locationFilter.js';

const BRANCHES = ['Seattle', 'Spokane', 'Salt Lake City', 'Dallas'];
const manager = { location: 'Spokane', assignedLocations: ['Seattle', 'Spokane'] };
const admin = { location: 'Dallas', assignedLocations: ['*'] };

describe('locationNames', () => {
  it('reads names from strings and Location documents, dropping blanks, repeats and *', () => {
    expect(locationNames(['Seattle', { name: 'Spokane' }, { locationName: 'Dallas' }, '', ' Seattle ', '*', null]))
      .toEqual(['Seattle', 'Spokane', 'Dallas']);
  });

  it('treats a missing list as empty', () => {
    expect(locationNames(undefined)).toEqual([]);
  });
});

describe('accessibleLocations', () => {
  it('gives someone assigned * every branch', () => {
    expect(accessibleLocations(admin, BRANCHES)).toEqual(BRANCHES);
  });

  it("gives everyone else only their assigned branches, in the list's order", () => {
    expect(accessibleLocations({ assignedLocations: ['Spokane', 'Seattle'] }, BRANCHES)).toEqual(['Seattle', 'Spokane']);
  });

  it('gives nobody-assigned nothing', () => {
    expect(accessibleLocations({}, BRANCHES)).toEqual([]);
  });
});

describe('homeLocationOf', () => {
  it('is the stored location when it is one of theirs', () => {
    expect(homeLocationOf(manager)).toBe('Spokane');
    expect(homeLocationOf(admin)).toBe('Dallas');
  });

  it('is blank when the stored location was taken off their assigned list', () => {
    expect(homeLocationOf({ location: 'Dallas', assignedLocations: ['Seattle'] })).toBe('');
  });

  it("is blank for the old '*' the Users & Roles form used to store", () => {
    expect(homeLocationOf({ location: '*', assignedLocations: ['*'] })).toBe('');
  });

  it('is blank when none is set', () => {
    expect(homeLocationOf({ assignedLocations: ['Seattle', 'Spokane'] })).toBe('');
    expect(homeLocationOf(null)).toBe('');
  });
});

describe('defaultLocationFor', () => {
  it('opens on the home location when the filter offers it', () => {
    expect(defaultLocationFor(manager, ['Seattle', 'Spokane'])).toBe('Spokane');
  });

  it('opens on All when the home location is not among the options', () => {
    expect(defaultLocationFor(manager, ['Seattle', 'Dallas'])).toBe(ALL_LOCATIONS);
  });

  it('opens on All with no home location set', () => {
    expect(defaultLocationFor({ assignedLocations: ['*'] }, BRANCHES)).toBe(ALL_LOCATIONS);
  });

  it('stays on All when there is nothing to choose between (the filter is hidden)', () => {
    expect(defaultLocationFor(manager, ['Spokane'])).toBe(ALL_LOCATIONS);
    expect(defaultLocationFor(manager, [])).toBe(ALL_LOCATIONS);
  });

  it('opens on All until the options have loaded, then the home location', () => {
    expect(defaultLocationFor(manager, [])).toBe(ALL_LOCATIONS);
    expect(defaultLocationFor(manager, [{ name: 'Seattle' }, { name: 'Spokane' }])).toBe('Spokane');
  });
});

describe('defaultLocationsFor', () => {
  it('ticks just the home location', () => {
    expect(defaultLocationsFor({ location: 'Spokane', assignedLocations: ['Spokane'] }, BRANCHES)).toEqual(['Spokane']);
  });

  it('ticks nothing (all) without a home location among the options', () => {
    expect(defaultLocationsFor({ assignedLocations: ['*'] }, BRANCHES)).toEqual([]);
  });
});

describe('resolveStoredLocation', () => {
  it('keeps a remembered branch that is still offered', () => {
    expect(resolveStoredLocation('Seattle', BRANCHES)).toBe('Seattle');
  });

  it('keeps a remembered All', () => {
    expect(resolveStoredLocation(ALL_LOCATIONS, BRANCHES)).toBe(ALL_LOCATIONS);
  });

  it('drops a branch that is no longer offered, or nothing remembered', () => {
    expect(resolveStoredLocation('Houston', BRANCHES)).toBeNull();
    expect(resolveStoredLocation(null, BRANCHES)).toBeNull();
    expect(resolveStoredLocation(undefined, BRANCHES)).toBeNull();
  });

  it('drops anything once there is no choice left to make', () => {
    expect(resolveStoredLocation('Seattle', ['Seattle'])).toBeNull();
  });
});

describe('resolveStoredLocations', () => {
  it('keeps the remembered branches still offered and drops the rest', () => {
    expect(resolveStoredLocations(['Seattle', 'Houston'], BRANCHES)).toEqual(['Seattle']);
  });

  it('keeps a remembered All ([])', () => {
    expect(resolveStoredLocations([], BRANCHES)).toEqual([]);
  });

  it('falls back to the default when none of them are offered any more', () => {
    expect(resolveStoredLocations(['Houston'], BRANCHES)).toBeNull();
    expect(resolveStoredLocations('Seattle', BRANCHES)).toBeNull();
  });
});

describe('homeLocationProblem', () => {
  it('accepts one of the assigned branches, or blank', () => {
    expect(homeLocationProblem('Spokane', ['Seattle', 'Spokane'], BRANCHES)).toBeNull();
    expect(homeLocationProblem('', ['Seattle', 'Spokane'], BRANCHES)).toBeNull();
    expect(homeLocationProblem(undefined, ['Seattle'], BRANCHES)).toBeNull();
  });

  it('refuses a branch the user is not assigned', () => {
    expect(homeLocationProblem('Dallas', ['Seattle', 'Spokane'], BRANCHES)).toMatch(/assigned locations/);
  });

  it('refuses *', () => {
    expect(homeLocationProblem('*', ['*'], BRANCHES)).toMatch(/one branch/);
  });

  it('accepts any real branch for someone assigned *, but not a made-up one', () => {
    expect(homeLocationProblem('Dallas', ['*'], BRANCHES)).toBeNull();
    expect(homeLocationProblem('Austin', ['*'], BRANCHES)).toMatch(/not a location/);
  });
});

describe('fallbackHomeLocation', () => {
  it('is the first assigned branch', () => {
    expect(fallbackHomeLocation(['Spokane', 'Seattle'])).toBe('Spokane');
  });

  it('is blank for * or nothing assigned', () => {
    expect(fallbackHomeLocation(['*'])).toBe('');
    expect(fallbackHomeLocation([])).toBe('');
    expect(fallbackHomeLocation(undefined)).toBe('');
  });
});
