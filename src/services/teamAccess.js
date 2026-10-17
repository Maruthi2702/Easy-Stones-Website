/**
 * The server half of Users & Roles access (src/utils/usersAccess.js for the
 * per-action permissions, src/utils/teamAccess.js for the manager's scoped
 * team access):
 *
 *   requireAction(key)  — passes with that action (or the master key
 *                         manage_users); 403 otherwise.
 *   requireArea(area)   — passes with any action in 'users' | 'roles' | 'locations'.
 *   usersAccess(key)    — for the Users routes a manager may also reach.
 *                         `key` is a USERS action, or 'view' for the list. The
 *                         action passes with req.teamScope = null (no limit);
 *                         team access (manage_team_users) passes View,
 *                         Deactivate and Unlock only, with req.teamScope set
 *                         to the role's manageableRoles; anyone else gets a 403.
 *   memberAllowed       — true when unlimited; for a team member only when the
 *                         target is in their scope.
 */
import { TEAM_PERMISSION, TEAM_USER_FIELDS, canManageMember, cleanManageableRoles, locationsWithin } from '../utils/teamAccess.js';
import { USERS, can, canOpenArea } from '../utils/usersAccess.js';

const TEAM_ACTIONS = ['view', USERS.DEACTIVATE, USERS.UNLOCK];

const deny = (res, user, what) => res.status(403).json({
  error: `Access denied. Your role ("${user.role}") does not have permission to ${what}.`
});

export const requireAction = (key) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  if (!can(req.user, key)) return deny(res, req.user, `do this (${key})`);
  next();
};

export const requireArea = (area, { alsoRoles = false } = {}) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  if (!canOpenArea(req.user, area) && !(alsoRoles && canOpenArea(req.user, 'users'))) {
    return deny(res, req.user, `open ${area}`);
  }
  next();
};

export const createTeamAccess = ({ Role, User }) => {
  const usersAccess = (key) => async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
      const allowed = key === 'view' ? canOpenArea(req.user, 'users') : can(req.user, key);
      if (allowed) {
        req.teamScope = null;
        return next();
      }
      if (!(req.user.permissions || []).includes(TEAM_PERMISSION) || !TEAM_ACTIONS.includes(key)) {
        return deny(res, req.user, key === 'view' ? 'see users' : `do this (${key})`);
      }
      const role = await Role.findOne({ name: String(req.user.role || '').trim().toLowerCase() }, 'manageableRoles').lean();
      req.teamScope = { manageableRoles: role?.manageableRoles || [] };
      next();
    } catch (err) {
      console.error('usersAccess error:', err);
      res.status(500).json({ message: 'Could not check your access' });
    }
  };

  const memberAllowed = (req, target) => {
    if (!req.teamScope) return true;
    return canManageMember({
      manager: { id: req.user.id, assignedLocations: req.user.assignedLocations },
      manageableRoles: req.teamScope.manageableRoles,
      target
    });
  };

  /**
   * The people a team member can see: only the roles an admin listed, only
   * people entirely at their locations, and only the fields a manager needs.
   */
  const teamUsers = async (req) => {
    const roles = cleanManageableRoles(req.teamScope.manageableRoles);
    const people = await User.find({ role: { $in: roles }, _id: { $ne: req.user.id } })
      .select(TEAM_USER_FIELDS).sort({ createdAt: -1 }).lean();
    return people.filter((p) => locationsWithin(req.user.assignedLocations, p.assignedLocations));
  };

  return { usersAccess, memberAllowed, teamUsers };
};
