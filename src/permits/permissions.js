/**
 * Permits permission keys (2026-10-11). Admin only to start with — the
 * boot-time grant in server.js gives them to the admin role, and an admin
 * hands each one to other roles under Users & Roles.
 *
 * Shared by the server (src/permits/router.js), Users & Roles
 * (src/features/users/roles/pagePermissions.ts) and the screen.
 */

export const PERMITS = Object.freeze({
  VIEW: 'view_permits',
  EXPORT: 'export_permits',
  REFRESH: 'refresh_permits'   // run the morning pull now, and see each source's last run
});

export const ALL_PERMIT_PERMISSIONS = Object.freeze(Object.values(PERMITS));

export const can = (user, perm) => Array.isArray(user?.permissions) && user.permissions.includes(perm);
