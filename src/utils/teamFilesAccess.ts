import type { Loose } from '../types/records.ts';
/**
 * Team Files permissions (2026-10-30). Team Files used to come with the
 * Dashboard (`view_dashboard`): anyone who could open it could upload,
 * rename and delete. It's its own Sales page now with two switches on its own
 * Users & Roles card:
 *
 *   View   — open the page, search, preview, download, copy a link
 *   Manage — upload, add folders, rename, move, replace, pin and delete
 *
 * Manage needs View (a role with Manage alone can't open the page to use it).
 * Every role that held `view_dashboard` gets both once (TEAM_FILES_MIGRATION,
 * run by server.ts's ACTION_MIGRATIONS), so nobody loses what they had.
 *
 * Shared by the server (src/routes/teamFiles.ts), the side nav (navPins.js),
 * the page and Users & Roles (pagePermissions.ts). Design: the claude.ai
 * artifact **Team Files Page Canvas**
 * (https://claude.ai/artifact/NRBYg5zf4Ycw8NCuMrpd97).
 */

export const TEAM_FILES_PERMISSIONS = Object.freeze({
  VIEW: 'view_team_files',
  MANAGE: 'manage_team_files'
});

const P = TEAM_FILES_PERMISSIONS;

export const ALL_TEAM_FILES_PERMISSIONS = Object.freeze(Object.values(P));

/** Roles that held the Dashboard get both switches once, on the next start. */
export const TEAM_FILES_MIGRATION = Object.freeze([
  { from: 'view_dashboard', grant: [P.VIEW, P.MANAGE] }
]);

const permsOf = (user: Loose) => (Array.isArray(user?.permissions) ? user.permissions : []);
const has = (user: Loose, key: string) => permsOf(user).includes(key);

export const canViewTeamFiles = (user: Loose) => has(user, P.VIEW);
export const canManageTeamFiles = (user: Loose) => canViewTeamFiles(user) && has(user, P.MANAGE);

/**
 * A role's permissions after a change on the Team Files card, keeping the
 * View rule: View off takes Manage with it; Manage on turns View on.
 */
export const withTeamFilesViewRule = (before: Loose, after: Loose[]) => {
  const changed = ALL_TEAM_FILES_PERMISSIONS.some((key) => before.includes(key) !== after.includes(key));
  if (!changed) return after;
  if (before.includes(P.VIEW) && !after.includes(P.VIEW)) return after.filter((key: string) => key !== P.MANAGE);
  if (!after.includes(P.VIEW) && after.includes(P.MANAGE)) return [...after, P.VIEW];
  return after;
};
