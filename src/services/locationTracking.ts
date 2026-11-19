/**
 * The server's side of location tracking (src/utils/locationTracking.ts holds
 * the rules): who is on the staff list with their home branch, and which roles
 * are tracked. Read fresh each time, like teamDirectory.ts, so a change in
 * Users & Roles applies at once.
 */
import * as staffData from '../db/staff/index.ts';
import { TRACKING } from '../utils/locationTracking.ts';
import { displayNameOf } from '../utils/salesReps.ts';

export type StaffRow = { id: string; name: string; role: string; branch: string; active: boolean; location: string; assignedLocations: string[] };

/** A person's home branch: their location, else the first branch they're assigned (never '*'), else Seattle. */
export const homeBranchOf = (person: { location?: unknown; assignedLocations?: unknown } | null | undefined): string => {
  const loc = String(person?.location || '').trim();
  if (loc && loc !== '*') return loc;
  const assigned = (Array.isArray(person?.assignedLocations) ? person.assignedLocations : []).map(String).find(l => l && l !== '*');
  return assigned || 'Seattle';
};

export type Directory = {
  staff(): Promise<StaffRow[]>;
  /** Names of the roles that hold `track_location`. */
  trackedRoles(): Promise<Set<string>>;
};

export const staffDirectory: Directory = {
  async staff() {
    const users = await staffData.findUsers({}, { select: '_id location assignedLocations displayName username role isActive' });
    return users.map(u => ({
      id: String(u._id), name: displayNameOf(u), role: String(u.role || ''), branch: homeBranchOf(u),
      active: u.isActive !== false, location: String(u.location || ''), assignedLocations: Array.isArray(u.assignedLocations) ? u.assignedLocations.map(String) : []
    }));
  },
  async trackedRoles() {
    const roles = await staffData.findRoles({}, { select: 'name permissions' });
    return new Set(roles.filter(r => Array.isArray(r.permissions) && r.permissions.includes(TRACKING.TRACKED)).map(r => String(r.name)));
  }
};
