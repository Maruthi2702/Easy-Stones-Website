/**
 * Users & Roles permissions, one per action (2026-10-16). An admin gives each
 * role only what it needs under Users & Roles → Roles & Permissions.
 *
 * `manage_users` is still the master key: it holds every action below, so
 * every role that had it keeps exactly what it had. A role without it gets
 * only the actions it is given; any action in an area (Users, Roles,
 * Locations) also lets that area's page open and its list load — nobody needs
 * a separate "view" switch just to use what they were given.
 *
 * `manage_team_users` (src/utils/teamAccess.js) is the scoped version of
 * View / Deactivate / Unlock for the people at a manager's own locations.
 *
 * Every key, its section and its wording live in `USERS_ROLES_SECTIONS`; the
 * Users & Roles card, the routes and the screens all read it, and
 * usersAccess.test.js fails if a key has no switch.
 */

export const FULL_ACCESS = 'manage_users';

export const USERS = {
  VIEW: 'view_users',
  ADD: 'add_users',
  EDIT: 'edit_users',
  RESET_SIGN_IN: 'reset_user_sign_in',
  DEACTIVATE: 'deactivate_users',
  UNLOCK: 'unlock_users',
  DELETE: 'delete_users'
};

export const ROLES = {
  VIEW: 'view_roles',
  ADD: 'add_roles',
  EDIT: 'edit_roles',
  DELETE: 'delete_roles'
};

export const LOCATIONS = {
  VIEW: 'view_locations',
  ADD: 'add_locations',
  EDIT: 'edit_locations',
  DELETE: 'delete_locations'
};

export const NAV_ORDER = 'edit_nav_order';

// Admin → Visit Types / Resource Types (src/routes/typeLists.js): the lists the
// Add visit and Add resource forms offer, in the order a manager sets.
export const VISIT_TYPES = {
  ADD: 'add_visit_types',
  EDIT: 'edit_visit_types',
  REORDER: 'reorder_visit_types',
  DELETE: 'delete_visit_types'
};

export const RESOURCE_TYPES = {
  ADD: 'add_resource_types',
  EDIT: 'edit_resource_types',
  REORDER: 'reorder_resource_types',
  DELETE: 'delete_resource_types'
};

export const AREAS = {
  users: Object.values(USERS),
  roles: Object.values(ROLES),
  locations: Object.values(LOCATIONS),
  visitTypes: Object.values(VISIT_TYPES),
  resourceTypes: Object.values(RESOURCE_TYPES)
};

const has = (user, perm) => !!user?.permissions?.includes(perm);

/** Whether `user` may do the one action `key` (the master key counts). */
export const can = (user, key) => has(user, FULL_ACCESS) || has(user, key);

/** Whether `user` holds any action in `area` ('users' | 'roles' | 'locations'): the page opens, the list loads. */
export const canOpenArea = (user, area) =>
  has(user, FULL_ACCESS) || (AREAS[area] || []).some((key) => has(user, key));

/** Whether this person can load the Roles list — the Add / Edit user forms need it for their role picker. */
export const canReadRoles = (user) => canOpenArea(user, 'roles') || canOpenArea(user, 'users');

/** Every key above, for the "does the card have a switch for it" test. */
export const ALL_USERS_ROLES_KEYS = [...AREAS.users, ...AREAS.roles, ...AREAS.locations, ...AREAS.visitTypes, ...AREAS.resourceTypes, NAV_ORDER];

/** The Users & Roles card's switches, in sections: [{ section, actions: [{ key, label, desc }] }]. */
export const USERS_ROLES_SECTIONS = [
  {
    section: 'Users',
    actions: [
      { key: USERS.VIEW, label: 'View users', desc: 'See every user and who is online' },
      { key: USERS.ADD, label: 'Add users', desc: 'Create new users' },
      { key: USERS.EDIT, label: 'Edit users', desc: 'Change a user’s details, role and locations' },
      { key: USERS.RESET_SIGN_IN, label: 'Reset sign-in', desc: 'Set a temporary password or send an invite link' },
      { key: USERS.DEACTIVATE, label: 'Deactivate / reactivate', desc: 'Stop or allow a user to sign in; their history stays' },
      { key: USERS.UNLOCK, label: 'Unlock accounts', desc: 'Lift a lock from too many wrong passwords' },
      { key: USERS.DELETE, label: 'Delete users', desc: 'Delete a user permanently' }
    ]
  },
  {
    section: 'Roles & Permissions',
    actions: [
      { key: ROLES.VIEW, label: 'View roles', desc: 'See roles and what each can do' },
      { key: ROLES.EDIT, label: 'Edit permissions', desc: 'Change what a role can do' },
      { key: ROLES.ADD, label: 'Add roles', desc: 'Create a custom role' },
      { key: ROLES.DELETE, label: 'Delete roles', desc: 'Delete a custom role' }
    ]
  },
  {
    section: 'Locations',
    actions: [
      { key: LOCATIONS.VIEW, label: 'View locations', desc: 'See each location’s full details' },
      { key: LOCATIONS.ADD, label: 'Add locations', desc: 'Create a location' },
      { key: LOCATIONS.EDIT, label: 'Edit locations', desc: 'Change a location’s details and defaults' },
      { key: LOCATIONS.DELETE, label: 'Delete locations', desc: 'Delete a location' }
    ]
  },
  {
    section: 'Visit types',
    actions: [
      { key: VISIT_TYPES.ADD, label: 'Add visit types', desc: 'Add a type to the Add visit list' },
      { key: VISIT_TYPES.EDIT, label: 'Edit visit types', desc: 'Rename a type, change the fields it uses, hide or show it' },
      { key: VISIT_TYPES.REORDER, label: 'Reorder visit types', desc: 'Set the order everyone sees in the list' },
      { key: VISIT_TYPES.DELETE, label: 'Delete visit types', desc: 'Delete a type no visit uses' }
    ]
  },
  {
    section: 'Resource types',
    actions: [
      { key: RESOURCE_TYPES.ADD, label: 'Add resource types', desc: 'Add a type to the Add resource list' },
      { key: RESOURCE_TYPES.EDIT, label: 'Edit resource types', desc: 'Rename a type, change its family, hide or show it' },
      { key: RESOURCE_TYPES.REORDER, label: 'Reorder resource types', desc: 'Set the order everyone sees in the list' },
      { key: RESOURCE_TYPES.DELETE, label: 'Delete resource types', desc: 'Delete a type no resource uses' }
    ]
  },
  {
    section: 'Side nav',
    actions: [
      { key: NAV_ORDER, label: 'Side nav order', desc: 'Arrange the side nav for everyone' }
    ]
  }
];
