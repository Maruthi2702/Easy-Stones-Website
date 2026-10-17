/**
 * The server half of team access (src/utils/teamAccess.js): one guard for the
 * Users routes a manager may reach, and the check for a single target person.
 *
 *   usersAccess   — `manage_users` passes with req.teamScope = null (no limit);
 *                   `manage_team_users` passes with req.teamScope set to the
 *                   role's manageableRoles; anyone else gets a 403.
 *   memberAllowed — true for the admin; for a team member only when the
 *                   target is in their scope.
 */
import { TEAM_PERMISSION, TEAM_USER_FIELDS, canManageMember, cleanManageableRoles, locationsWithin } from '../utils/teamAccess.js';

export const createTeamAccess = ({ Role, User }) => {
  const usersAccess = async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
      const perms = req.user.permissions || [];
      if (perms.includes('manage_users')) {
        req.teamScope = null;
        return next();
      }
      if (!perms.includes(TEAM_PERMISSION)) {
        return res.status(403).json({
          error: `Access denied. Your role ("${req.user.role}") does not have the "manage_users" permission.`
        });
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
