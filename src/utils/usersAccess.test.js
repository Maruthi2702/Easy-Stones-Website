import { describe, it, expect } from 'vitest';
import {
  FULL_ACCESS, USERS, ROLES, LOCATIONS, NAV_ORDER, can, canOpenArea, canReadRoles,
  ALL_USERS_ROLES_KEYS, USERS_ROLES_SECTIONS
} from './usersAccess.js';

const user = (...permissions) => ({ permissions });

describe('can', () => {
  it('the master key holds every action', () => {
    for (const key of ALL_USERS_ROLES_KEYS) expect(can(user(FULL_ACCESS), key)).toBe(true);
  });
  it('anyone else holds only what they were given', () => {
    const u = user(USERS.DEACTIVATE);
    expect(can(u, USERS.DEACTIVATE)).toBe(true);
    expect(can(u, USERS.DELETE)).toBe(false);
    expect(can(u, ROLES.EDIT)).toBe(false);
    expect(can(null, USERS.VIEW)).toBe(false);
  });
});

describe('canOpenArea', () => {
  it('any action in an area opens that area only', () => {
    expect(canOpenArea(user(USERS.UNLOCK), 'users')).toBe(true);
    expect(canOpenArea(user(USERS.UNLOCK), 'roles')).toBe(false);
    expect(canOpenArea(user(LOCATIONS.EDIT), 'locations')).toBe(true);
    expect(canOpenArea(user(NAV_ORDER), 'users')).toBe(false);
  });
  it('the master key opens all of them', () => {
    expect(['users', 'roles', 'locations'].every((a) => canOpenArea(user(FULL_ACCESS), a))).toBe(true);
  });
  it('the user forms can read roles with any Users or Roles action', () => {
    expect(canReadRoles(user(USERS.ADD))).toBe(true);
    expect(canReadRoles(user(ROLES.VIEW))).toBe(true);
    expect(canReadRoles(user(LOCATIONS.VIEW))).toBe(false);
  });
});

describe('the Users & Roles card', () => {
  const cardKeys = USERS_ROLES_SECTIONS.flatMap((s) => s.actions.map((a) => a.key));
  it('has a switch for every key, once', () => {
    expect([...cardKeys].sort()).toEqual([...ALL_USERS_ROLES_KEYS].sort());
  });
  it('words every switch', () => {
    for (const a of USERS_ROLES_SECTIONS.flatMap((s) => s.actions)) {
      expect(a.label).toBeTruthy();
      expect(a.desc).toBeTruthy();
    }
  });
});
