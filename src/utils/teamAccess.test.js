import { describe, it, expect } from 'vitest';
import {
  TEAM_PERMISSION, hasFullUserAccess, hasTeamUserAccess, canOpenUsersPage,
  locationsWithin, canManageMember, cleanManageableRoles
} from './teamAccess.js';

describe('page access', () => {
  const team = { permissions: [TEAM_PERMISSION] };
  const admin = { permissions: ['manage_users'] };
  it('full access wins over team access', () => {
    expect(hasFullUserAccess(admin)).toBe(true);
    expect(hasTeamUserAccess(admin)).toBe(false);
    expect(hasTeamUserAccess({ permissions: ['manage_users', TEAM_PERMISSION] })).toBe(false);
    expect(hasTeamUserAccess(team)).toBe(true);
  });
  it('opens the Users page for either, not for nobody', () => {
    expect(canOpenUsersPage(team)).toBe(true);
    expect(canOpenUsersPage(admin)).toBe(true);
    expect(canOpenUsersPage({ permissions: ['view_customers'] })).toBe(false);
    expect(canOpenUsersPage(null)).toBe(false);
  });
});

describe('locationsWithin', () => {
  it('needs every one of their locations to be the manager\'s', () => {
    expect(locationsWithin(['Seattle', 'Kent'], ['Seattle'])).toBe(true);
    expect(locationsWithin(['Seattle'], ['Seattle', 'Spokane'])).toBe(false);
  });
  it('lets only an all-locations manager reach an all-locations or location-less person', () => {
    expect(locationsWithin(['*'], ['Spokane'])).toBe(true);
    expect(locationsWithin(['*'], ['*'])).toBe(true);
    expect(locationsWithin(['Seattle'], ['*'])).toBe(false);
    expect(locationsWithin(['Seattle'], [])).toBe(false);
    expect(locationsWithin(undefined, ['Seattle'])).toBe(false);
  });
});

describe('canManageMember', () => {
  const manager = { id: 'm1', assignedLocations: ['Seattle'] };
  const base = { manager, manageableRoles: ['sales_rep', 'driver'] };
  const rep = { _id: 'u1', role: 'sales_rep', assignedLocations: ['Seattle'] };
  it('allows a listed role at the manager\'s location', () => {
    expect(canManageMember({ ...base, target: rep })).toBe(true);
    expect(canManageMember({ ...base, target: { ...rep, role: ' Driver ' } })).toBe(true);
  });
  it('refuses a role that is not listed, an admin, and yourself', () => {
    expect(canManageMember({ ...base, target: { ...rep, role: 'manager' } })).toBe(false);
    expect(canManageMember({ ...base, manageableRoles: ['admin'], target: { ...rep, role: 'admin' } })).toBe(false);
    expect(canManageMember({ ...base, target: { ...rep, _id: 'm1' } })).toBe(false);
  });
  it('refuses someone who also works outside the manager\'s locations', () => {
    expect(canManageMember({ ...base, target: { ...rep, assignedLocations: ['Seattle', 'Spokane'] } })).toBe(false);
  });
  it('refuses everyone when no roles are listed', () => {
    expect(canManageMember({ manager, manageableRoles: [], target: rep })).toBe(false);
    expect(canManageMember({ manager, manageableRoles: undefined, target: rep })).toBe(false);
  });
});

describe('cleanManageableRoles', () => {
  it('lower-cases, de-duplicates, and drops admin and the role itself', () => {
    expect(cleanManageableRoles(['Driver', 'driver', 'admin', 'manager', ' sales_rep '], 'manager')).toEqual(['driver', 'sales_rep']);
    expect(cleanManageableRoles('nope', 'manager')).toEqual([]);
  });
});
