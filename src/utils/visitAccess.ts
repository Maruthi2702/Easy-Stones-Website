import type { Loose } from '../types/records.ts';
/**
 * Who may add, see, change and delete visits (and resources, which follow the
 * same rules), decided by the permissions on the person's role (Users & Roles
 * → Visits) rather than by role name, so any of it can be granted to any role.
 *
 *   add_visits           → log visits and add resources
 *
 *   view_all_visits      → everyone's visits on the dashboard
 *   view_branch_visits   → the visits of everyone working at the person's
 *                          assigned locations ('*' = all) — by the REP's
 *                          branch, not the customer's (2026-10-31)
 *   neither              → only the visits they logged themselves
 *
 *   edit_own_visits      → edit visits they logged themselves
 *   edit_branch_visits   → edit visits logged by anyone at their locations
 *   edit_all_visits      → edit anyone's
 *   delete_own_visits    → delete visits they logged themselves
 *   delete_branch_visits → delete visits logged by anyone at their locations
 *   delete_all_visits    → delete anyone's
 *
 * "Anyone at their locations" is the person's team, from teammatesOf in
 * teamScope.js (ALL_PEOPLE or a Set of user ids), passed in as `team`.
 *
 * The server enforces all of it (requirePermission/requireAnyPermission on the
 * visit and resource routes, visiblePeople in teamScope.js for viewing,
 * canModifyVisit on PUT and canDeleteVisit on DELETE); the dashboard and
 * customer page call the same functions to decide what to show and which
 * buttons to offer, so the two can't drift apart.
 */
export const VISIT_PERMISSIONS = Object.freeze({
  ADD: 'add_visits',
  EDIT_OWN: 'edit_own_visits',
  DELETE_OWN: 'delete_own_visits',
  VIEW_ALL: 'view_all_visits',
  VIEW_BRANCH: 'view_branch_visits',
  EDIT_ALL: 'edit_all_visits',
  EDIT_BRANCH: 'edit_branch_visits',
  DELETE_ALL: 'delete_all_visits',
  DELETE_BRANCH: 'delete_branch_visits'
});

const permsOf = (user: Loose | null | undefined) => (Array.isArray(user?.permissions) ? user.permissions : []);
const locationsOf = (user: Loose | null | undefined) =>
  (Array.isArray(user?.assignedLocations) ? user.assignedLocations.filter(Boolean) : []);

/**
 * Which branches' visits a person sees, from their permissions:
 *   { kind: 'all' } | { kind: 'branches', locations } | { kind: 'own' }.
 * view_all wins over view_branch; a '*' branch assignment counts as all.
 * `user` is { permissions, assignedLocations }.
 */
type VisitViewScope = {kind: 'all'} | {kind: 'branches'; locations: string[]} | {kind: 'own'};

export const visitViewScope = (user: Loose | null | undefined): VisitViewScope => {
  const perms = permsOf(user);
  if (perms.includes(VISIT_PERMISSIONS.VIEW_ALL)) return { kind: 'all' };
  if (perms.includes(VISIT_PERMISSIONS.VIEW_BRANCH)) {
    const locations = locationsOf(user);
    return locations.includes('*') ? { kind: 'all' } : { kind: 'branches', locations };
  }
  return { kind: 'own' };
};

/** Whether `user` may log a visit or add a resource. */
export const canAddVisit = (user: Loose | null | undefined) => permsOf(user).includes(VISIT_PERMISSIONS.ADD);

// Anyone's with the "all" permission; your own with the "own" one; anyone's on
// your team (teamScope.js: ALL_PEOPLE or a Set of ids) with the "branch" one.
const mayActOn = (user: Loose | null | undefined, visit: Loose | null | undefined, team: '*' | ReadonlySet<string> | null | undefined, { all, own, branch }: Loose) => {
  if (!user || !visit) return false;
  const perms = permsOf(user);
  if (perms.includes(all)) return true;
  const userId = String(user.id ?? user._id ?? '');
  const author = visit.createdBy ? String(visit.createdBy) : '';
  if (perms.includes(own) && userId && author === userId) return true;
  if (perms.includes(branch)) {
    return team === '*' || (Boolean(author) && team instanceof Set && team.has(author));
  }
  return false;
};

const EDIT = { all: VISIT_PERMISSIONS.EDIT_ALL, own: VISIT_PERMISSIONS.EDIT_OWN, branch: VISIT_PERMISSIONS.EDIT_BRANCH };
const DELETE = { all: VISIT_PERMISSIONS.DELETE_ALL, own: VISIT_PERMISSIONS.DELETE_OWN, branch: VISIT_PERMISSIONS.DELETE_BRANCH };

/** Every permission that can allow editing some visit — the routes' cheap first gate. */
export const ANY_EDIT_VISIT_PERMISSIONS = Object.freeze(Object.values(EDIT));
/** Every permission that can allow deleting some visit. */
export const ANY_DELETE_VISIT_PERMISSIONS = Object.freeze(Object.values(DELETE));

/**
 * Whether `user` may edit `visit` ({ createdBy }), given the user's `team`
 * (teammatesOf in teamScope.js). `user` is { id | _id, permissions }.
 */
export const canModifyVisit = (user: Loose | null | undefined, visit: Loose | null | undefined, team: '*' | ReadonlySet<string> | null | undefined) => mayActOn(user, visit, team, EDIT);

/** Whether `user` may delete `visit` — same shape as canModifyVisit, with the delete permissions. */
export const canDeleteVisit = (user: Loose | null | undefined, visit: Loose | null | undefined, team: '*' | ReadonlySet<string> | null | undefined) => mayActOn(user, visit, team, DELETE);
