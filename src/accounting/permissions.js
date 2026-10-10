/**
 * Accounting's permission keys (2026-10-09). Every action is its own switch
 * under Users & Roles, and nothing in Accounting opens by role name — an
 * admin holds these only because the boot-time grant gives them to the admin
 * role (server.js NEW_PERMISSION_GRANTS), and can hand each one to any role.
 *
 * Shared by the server (src/accounting/router.js), the Users & Roles screen
 * (src/components/sales/users/pagePermissions.js) and the screens' buttons.
 */

export const FREIGHT = Object.freeze({
  VIEW: 'view_freight_charges',
  ADD: 'add_freight_charges',
  EDIT: 'edit_freight_charges',
  APPROVE: 'approve_freight_charges',
  PAY: 'pay_freight_charges',
  VOID: 'void_freight_charges',
  EXPORT: 'export_freight_charges',
  HISTORY: 'view_freight_history'
});

export const CARRIERS = Object.freeze({
  VIEW: 'view_carriers',
  ADD: 'add_carriers',
  EDIT: 'edit_carriers',
  DEACTIVATE: 'deactivate_carriers'
});

export const ALL_ACCOUNTING_PERMISSIONS = Object.freeze([
  ...Object.values(FREIGHT),
  ...Object.values(CARRIERS)
]);

/** Does this user hold `perm`? Permissions only — never the role's name. */
export const can = (user, perm) => Array.isArray(user?.permissions) && user.permissions.includes(perm);
