/**
 * Postgres user / role rows → the records MongoDB held (`_id`, `location` as the home
 * branch's name, `assignedLocations` as names with '*' for every branch, `password`).
 * Callers never learn which database answered (src/db/staff/README.md).
 *
 * One difference by design: a person's assigned locations come back A–Z, because
 * `user_locations` keeps no order (MongoDB kept the order they were ticked in).
 */
import type { users, roles } from '../schema/reference.ts';
import type { Loose } from '../../types/records.ts';

type UserRow = typeof users.$inferSelect;
type RoleRow = typeof roles.$inferSelect;

export interface UserJoins {
  /** The home location's name, or null. */
  homeName: string | null;
  /** Assigned location names (without '*'). */
  assignedNames: string[];
}

export const assignedLocationsOf = (allLocations: boolean, names: string[]): string[] =>
  [...(allLocations ? ['*'] : []), ...[...names].sort((a, b) => a.localeCompare(b))];

/** Everything `authenticate` reads, named fields only: no hash, no Google / iCloud tokens. */
export function authIdentityDoc(u: UserRow, j: UserJoins, permissions: string[]): Loose {
  return {
    _id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email ?? undefined,
    role: u.role,
    assignedLocations: assignedLocationsOf(u.allLocations, j.assignedNames),
    location: j.homeName ?? undefined,
    routePlannerFilters: u.routePlannerFilters,
    pinnedTabs: u.pinnedTabs,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    sessionVersion: u.sessionVersion,
    permissions
  };
}

export function roleDoc(r: RoleRow): Loose {
  return {
    _id: r.id, name: r.name, displayName: r.displayName, permissions: r.permissions,
    seededPermissions: r.seededPermissions, manageableRoles: r.manageableRoles,
    approvesCardReceiptsOf: r.approvesCardReceiptsOf, isSystem: r.isSystem,
    createdAt: r.createdAt, updatedAt: r.updatedAt
  };
}
