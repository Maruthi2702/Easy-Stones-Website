/**
 * Supplier POs (Purchasing, 2026-11-07): who may do what. Design and the
 * owner's calls: the claude.ai artifact **Supplier Portal Design**
 * (https://claude.ai/artifact/KbEE97GomxC1ANhshGNwoU).
 *
 * Every action is its own switch on the Users & Roles card "Purchasing ·
 * Supplier POs" (src/features/users/roles/pagePermissions.ts) — never a role
 * name. Shared by the server (src/routes/suppliers.ts), the side nav
 * (src/utils/navPins.ts) and the screens' buttons.
 *
 * The owner's approval rule: two steps. 1) **Approve** — managers with
 * purchasing access, directors, admins. 2) **Final approval** — the purchasing
 * team, directors, admins. The supplier loads only after the final one, and
 * the person who approved a bundle in step 1 doesn't give it step 2
 * (SAME_PERSON_BOTH_STEPS, my default while the owner hasn't said).
 *
 * Suppliers themselves never hold any of these: they sign in to the separate
 * supplier portal (src/services/supplierSession.ts), whose token no staff
 * route accepts.
 */
import type { PermissionUser } from '../types/permissions.ts';

export const SUPPLIER_POS = Object.freeze({
  /** See supplier POs, their blocks and photos, and the suppliers list. */
  VIEW: 'view_supplier_pos',
  /** Add, edit, close and cancel POs (typed, or filled from the SPS import), and assign them to a supplier. */
  MANAGE_POS: 'manage_supplier_pos',
  /** Step 1: approve, reject or ask for a new photo of the bundles a supplier offers. */
  REVIEW: 'review_supplier_blocks',
  /** Step 2: final approval, after which the supplier may load. */
  FINAL: 'final_approve_supplier_blocks',
  /** Unlock an approved bundle so the supplier can change it (it goes through both steps again). */
  UNLOCK: 'unlock_supplier_bundles',
  /** Add and edit suppliers, and their portal logins (invite, turn off, unlock). */
  MANAGE_SUPPLIERS: 'manage_suppliers',
  /** Sales: the material on its way — approved bundles, photos and sizes, no prices, supplier or PO. */
  INCOMING: 'view_incoming_material'
});

export const ALL_SUPPLIER_PERMISSIONS = Object.freeze(Object.values(SUPPLIER_POS));

/** What opens the Supplier POs page. */
export const SUPPLIER_PAGE_PERMISSIONS = Object.freeze([
  SUPPLIER_POS.VIEW, SUPPLIER_POS.MANAGE_POS, SUPPLIER_POS.REVIEW, SUPPLIER_POS.FINAL,
  SUPPLIER_POS.UNLOCK, SUPPLIER_POS.MANAGE_SUPPLIERS
]);

/**
 * The owner named directors for both steps (2026-11-06), so they start with
 * them; admins hold every switch. Managers and the purchasing team are ticked
 * by an admin at launch (the canvas's Users & Roles note).
 */
export const DIRECTOR_SUPPLIER_GRANTS = Object.freeze([
  SUPPLIER_POS.VIEW, SUPPLIER_POS.REVIEW, SUPPLIER_POS.FINAL, SUPPLIER_POS.UNLOCK, SUPPLIER_POS.INCOMING
]);

/** May the same person give a bundle both steps? Unanswered by the owner — default no. */
export const SAME_PERSON_BOTH_STEPS = false;

/** Logins per supplier (owner, 2026-11-06: one person each "for now"). */
export const MAX_LOGINS_PER_SUPPLIER = 1;

export const can = (user: PermissionUser, perm: string): boolean =>
  Array.isArray(user?.permissions) && user.permissions.includes(perm);
export const canOpenSupplierPos = (user: PermissionUser) => SUPPLIER_PAGE_PERMISSIONS.some((p) => can(user, p));
export const canSeeIncoming = (user: PermissionUser) => can(user, SUPPLIER_POS.INCOMING);
