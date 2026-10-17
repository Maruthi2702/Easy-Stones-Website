/**
 * Team access (2026-10-16): a manager or director sees the people at their
 * own locations on the Users page, with who is online, and can deactivate,
 * reactivate or unlock them — nothing else. Add, edit, delete, passwords and
 * Roles & Permissions stay with `manage_users` (the admin).
 *
 * Two things decide who a team member can act on, both set by an admin:
 *   - the role's **manageableRoles** (Roles & Permissions → the role's "People
 *     they can manage") — nobody else's role is ever reachable;
 *   - **locations**: every one of the person's locations must be one of the
 *     manager's (a person who also works at a branch the manager doesn't have
 *     stays with the admin, since deactivating them would reach past it).
 * Never themselves, and never an admin.
 *
 * Shared by the server routes (src/services/teamAccess.js) and the screens,
 * so what a button offers is what the server accepts.
 */

export const TEAM_PERMISSION = 'manage_team_users';

const has = (user, perm) => !!user?.permissions?.includes(perm);
const roleKey = (role) => String(role || '').trim().toLowerCase();

/** Admin-level: every user, every action (the existing `manage_users`). */
export const hasFullUserAccess = (user) => has(user, 'manage_users');

/** Team access only — the narrower view. Full access wins when someone has both. */
export const hasTeamUserAccess = (user) => has(user, TEAM_PERMISSION) && !hasFullUserAccess(user);

/** Opens the Users page. */
export const canOpenUsersPage = (user) => hasFullUserAccess(user) || has(user, TEAM_PERMISSION);

/** True when every location of `target` is one of `manager`'s. */
export const locationsWithin = (managerLocations, targetLocations) => {
  const mine = Array.isArray(managerLocations) ? managerLocations : [];
  const theirs = Array.isArray(targetLocations) ? targetLocations : [];
  if (mine.includes('*')) return true;
  if (theirs.length === 0 || theirs.includes('*')) return false;
  return theirs.every((loc) => mine.includes(loc));
};

/**
 * Whether `manager` may act on `target`.
 * manager: { id, assignedLocations }; target: { _id, role, assignedLocations }.
 */
export const canManageMember = ({ manager, manageableRoles, target }) => {
  if (!manager || !target) return false;
  if (String(target._id) === String(manager.id)) return false;
  const role = roleKey(target.role);
  if (!role || role === 'admin') return false;
  const allowed = (Array.isArray(manageableRoles) ? manageableRoles : []).map(roleKey);
  if (!allowed.includes(role)) return false;
  return locationsWithin(manager.assignedLocations, target.assignedLocations);
};

/** What the team page may read of a user: no tokens, no hashes. */
export const TEAM_USER_FIELDS = [
  'username', 'displayName', 'email', 'role', 'location', 'assignedLocations', 'joiningDate',
  'isActive', 'deactivatedAt', 'mustChangePassword', 'loginAttempts', 'lockUntil',
  'lastSeenAt', 'lastLoginAt', 'createdAt'
].join(' ');

/** Normalised, de-duplicated role names for a role's saved manageableRoles. */
export const cleanManageableRoles = (value, ownRole) => {
  if (!Array.isArray(value)) return [];
  const own = roleKey(ownRole);
  return [...new Set(value.map(roleKey).filter((r) => r && r !== 'admin' && r !== own))];
};
