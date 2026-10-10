/**
 * Cart & Holds permission keys (2026-10-10). Every action is its own switch
 * under Users & Roles; nothing opens by role name. Admin gets them through
 * the boot-time grant in server.js; an admin hands each one to other roles.
 *
 * Shared by the server (src/holds/router.js), Users & Roles
 * (src/components/sales/users/pagePermissions.js) and the screens.
 */

export const CART = Object.freeze({
  USE: 'use_cart'
});

export const HOLDS = Object.freeze({
  VIEW_OWN: 'view_own_holds',        // holds you created
  VIEW_BRANCH: 'view_branch_holds',  // holds in your assigned branches
  VIEW_ALL: 'view_all_holds',        // every branch
  CREATE: 'create_holds',
  EDIT: 'edit_hold_details',         // customer, job, notes
  SLABS: 'edit_hold_slabs',          // add, remove, swap slabs
  PRICES: 'edit_hold_prices',
  EXTEND: 'extend_holds',            // expiry past 7 days, or moved later
  RELEASE: 'release_holds',
  PRINT: 'print_holds',
  HISTORY: 'view_hold_history'
});

export const HOLD_VIEW_PERMISSIONS = Object.freeze([HOLDS.VIEW_OWN, HOLDS.VIEW_BRANCH, HOLDS.VIEW_ALL]);

export const ALL_HOLD_PERMISSIONS = Object.freeze([...Object.values(CART), ...Object.values(HOLDS)]);

export const can = (user, perm) => Array.isArray(user?.permissions) && user.permissions.includes(perm);
