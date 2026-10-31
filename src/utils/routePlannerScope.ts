import type { Loose } from '../types/records.ts';
/**
 * Which sales reps — and so which customers — the Route Planner offers one
 * person. Shared by the server (GET /api/customers/map and /map/rep-counts
 * enforce it) and the screen (the Filter's rep list is built from it), so the
 * list a person is shown and what the server will actually send can't differ.
 *
 *   admin, or every location ('*')  → every rep and every customer
 *   anyone else                     → the reps working at their own locations
 *                                     (and themselves), their customers, and
 *                                     the customers nobody owns at those
 *                                     locations ("Unassigned")
 *
 * Decided by the locations assigned in Users & Roles, not by role name. For
 * now a sales rep gets the same as a manager (the owner's call, 2026-10-18);
 * narrowing a rep to their own customers later is a change to `repsInScope`
 * and `inScopePins` only.
 */
import { isSalesRep } from './salesReps.ts';

/** The key a customer with no owning rep is filtered and loaded under. */
export const UNASSIGNED = 'unassigned';

const lower = (v: unknown) => String(v || '').toLowerCase();
const idOf = (user: Loose) => String(user?.id ?? user?._id ?? '');

/** `null` = every location; otherwise the locations they work at (can be empty). */
export const scopeLocationsOf = (user: Loose) => {
  if (!user) return [];
  const own = [...(Array.isArray(user.assignedLocations) ? user.assignedLocations : []), user.location].filter(Boolean);
  if (lower(user.role) === 'admin' || own.includes('*')) return null;
  return [...new Set(own)];
};

const repLocations = (rep: Loose) =>
  [...(Array.isArray(rep?.assignedLocations) ? rep.assignedLocations : []), rep?.location].filter(Boolean);

/**
 * The reps this person may see, from the whole staff directory: sales reps
 * (isSalesRep) working at one of their locations, plus themselves if they sell.
 * Deactivated reps stay (their customers still need finding), sorted by the caller.
 */
export const repsInScope = (user: Loose, staff: Loose[] = []) => {
  const locations = scopeLocationsOf(user);
  const me = idOf(user);
  return staff.filter((rep) => {
    if (!isSalesRep(rep)) return false;
    if (locations === null) return true;
    if (String(rep._id) === me) return true;
    const theirs = repLocations(rep);
    return theirs.includes('*') || theirs.some((l) => locations.includes(l));
  });
};

/** A customer's key in the rep filter. */
export const repKeyOf = (pin: Loose) => (pin?.salesRep ? String(pin.salesRep) : UNASSIGNED);

/**
 * The customers this person may see: owned by a rep in scope, or owned by
 * nobody and at one of their locations.
 */
export const inScopePins = (pins: Loose[] = [], user: Loose, staff: Loose[] = []) => {
  const locations = scopeLocationsOf(user);
  const allowed = new Set(repsInScope(user, staff).map((r) => String(r._id)));
  return pins.filter((p) => {
    if (p.salesRep) return locations === null ? true : allowed.has(String(p.salesRep));
    return locations === null || locations.includes(p.location);
  });
};

/** Of already-scoped pins, those owned by the asked-for reps (`UNASSIGNED` included). */
export const pinsForReps = (scoped: Loose[] = [], keys: string[] = []) => {
  const want = new Set(keys.map(String));
  return scoped.filter((p) => want.has(repKeyOf(p)));
};

/** { [rep key]: how many customers } over already-scoped pins. */
export const repCountsOf = (scoped: Loose[] = []) => {
  const tally: Loose = {};
  for (const p of scoped) {
    const key = repKeyOf(p);
    tally[key] = (tally[key] || 0) + 1;
  }
  return tally;
};

/** The rep keys a request named — `reps=a,b,unassigned` — or null when it named none (= everyone in scope). */
export const parseRepKeys = (value: Loose[]) => {
  if (value == null) return null;
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
};
