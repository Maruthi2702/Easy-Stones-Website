/**
 * Who may add, see, change and delete visits (and resources, which follow the
 * same rules), decided by the permissions on the person's role (Users & Roles
 * → Visits) rather than by role name, so any of it can be granted to any role.
 *
 *   add_visits           → log visits and add resources
 *
 *   view_all_visits      → every branch's visits on the dashboard
 *   view_branch_visits   → every rep's visits on customers in the person's
 *                          assigned branches ('*' = all)
 *   neither              → only the visits they logged themselves
 *
 *   edit_own_visits      → edit visits they logged themselves
 *   edit_branch_visits   → edit anyone's, on customers in their branches
 *   edit_all_visits      → edit anyone's
 *   delete_own_visits    → delete visits they logged themselves
 *   delete_branch_visits → delete anyone's, on customers in their branches
 *   delete_all_visits    → delete anyone's
 *
 * The server enforces all of it (requirePermission/requireAnyPermission on the
 * visit and resource routes, dashboardScope in dashboardMatch.js for viewing,
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

const permsOf = (user) => (Array.isArray(user?.permissions) ? user.permissions : []);
const locationsOf = (user) =>
  (Array.isArray(user?.assignedLocations) ? user.assignedLocations.filter(Boolean) : []);

/**
 * Which branches' visits a person sees, from their permissions:
 *   { kind: 'all' } | { kind: 'branches', locations } | { kind: 'own' }.
 * view_all wins over view_branch; a '*' branch assignment counts as all.
 * `user` is { permissions, assignedLocations }.
 */
export const visitViewScope = (user) => {
  const perms = permsOf(user);
  if (perms.includes(VISIT_PERMISSIONS.VIEW_ALL)) return { kind: 'all' };
  if (perms.includes(VISIT_PERMISSIONS.VIEW_BRANCH)) {
    const locations = locationsOf(user);
    return locations.includes('*') ? { kind: 'all' } : { kind: 'branches', locations };
  }
  return { kind: 'own' };
};

/** Whether `user` may log a visit or add a resource. */
export const canAddVisit = (user) => permsOf(user).includes(VISIT_PERMISSIONS.ADD);

// Anyone's with the "all" permission; your own with the "own" one; anyone's on
// a customer in your assigned branches ('*' = all) with the "branch" one.
const mayActOn = (user, visit, customerLocation, { all, own, branch }) => {
  if (!user || !visit) return false;
  const perms = permsOf(user);
  if (perms.includes(all)) return true;
  const userId = String(user.id ?? user._id ?? '');
  if (perms.includes(own) && userId && visit.createdBy && String(visit.createdBy) === userId) return true;
  if (perms.includes(branch)) {
    const locations = locationsOf(user);
    return locations.includes('*') || (Boolean(customerLocation) && locations.includes(customerLocation));
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
 * Whether `user` may edit `visit`, on a customer at `customerLocation`.
 * `user` is { id | _id, permissions, assignedLocations }.
 */
export const canModifyVisit = (user, visit, customerLocation) => mayActOn(user, visit, customerLocation, EDIT);

/** Whether `user` may delete `visit` — same shape as canModifyVisit, with the delete permissions. */
export const canDeleteVisit = (user, visit, customerLocation) => mayActOn(user, visit, customerLocation, DELETE);
