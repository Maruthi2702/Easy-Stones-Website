import type { Loose } from '../types/records.ts';
/**
 * Customers: who may see, add, import, change and delete them (2026-10-17).
 * Every permission for the Customers screens lives here, in its section, and
 * Users & Roles builds its one "Customers" card from CUSTOMER_SECTIONS — a new
 * Customers permission goes here, under the section it belongs to, and nowhere
 * else (customerAccess.test.js holds the card to that).
 *
 *   Customer list
 *     view_customers         → the list and a customer's basic card (name,
 *                              company, contact, phone, email, address, rep,
 *                              branch, status)
 *     view_customer_profile  → the full profile: Visits, Resources, Contacts,
 *                              Network and Details (pricing, Moda, marketing,
 *                              quick note). Off for every role but Admin while
 *                              it is being finished; switched on per role later.
 *     export_customers       → the Export to Excel button. Same: Admin only for now.
 *   Add customers
 *     add_customers          → add one customer
 *     import_customers       → import customers from Excel: adds new ones and
 *                              updates the ones it matches
 *   Change customers
 *     manage_customers       → edit customers (kept its old name: it is stored
 *                              on every role)
 *     delete_customers       → delete customers
 *
 * manage_customers used to cover add and import as well; CUSTOMER_MIGRATION
 * gives add_customers and import_customers once to every role holding it, so
 * nobody loses anything the day they split. The profile and export switches
 * are not migrated: they start with Admin alone (CUSTOMER_ADMIN_GRANTS).
 *
 * Every other switch needs View (owner's call, 2026-10-17): Add and Import
 * live on the Customers page, which View opens, so without it they had nowhere
 * to be used. The card keeps them together (withCustomerViewRule) and every
 * can… below checks View too, so a role saved before the rule can't use a
 * switch it has no page for.
 *
 * The server and the screens call the same functions, so what a button offers
 * and what the API accepts can't drift apart.
 */
export const CUSTOMER_PERMISSIONS = Object.freeze({
  VIEW: 'view_customers',
  PROFILE: 'view_customer_profile',
  EXPORT: 'export_customers',
  ADD: 'add_customers',
  IMPORT: 'import_customers',
  EDIT: 'manage_customers',
  DELETE: 'delete_customers'
});

const P = CUSTOMER_PERMISSIONS;

/** The Users & Roles card's sections, in order, with the keys under each. */
export const CUSTOMER_SECTIONS = Object.freeze([
  { id: 'list', title: 'Customer list', keys: [P.VIEW, P.PROFILE, P.EXPORT] },
  { id: 'add', title: 'Add customers', keys: [P.ADD, P.IMPORT] },
  { id: 'change', title: 'Change customers', keys: [P.EDIT, P.DELETE] }
]);

export const ALL_CUSTOMER_PERMISSIONS = Object.freeze(Object.values(P));

/**
 * Roles that held `from` before the split get `grant` once, on the next start
 * (server.ts records it in seededPermissions, so switching one off sticks).
 */
export const CUSTOMER_MIGRATION = Object.freeze([
  { from: P.EDIT, grant: [P.ADD, P.IMPORT] }
]);

/** Granted to Admin only, once, on the next start. */
export const CUSTOMER_ADMIN_GRANTS = Object.freeze([P.PROFILE, P.EXPORT, P.ADD, P.IMPORT]);

const permsOf = (user: Loose) => (Array.isArray(user?.permissions) ? user.permissions : []);
const has = (user: Loose, key: string) => permsOf(user).includes(key);

/** The switches that need View on. */
export const CUSTOMER_NEEDS_VIEW = Object.freeze(ALL_CUSTOMER_PERMISSIONS.filter((key) => key !== P.VIEW));

/**
 * A role's permissions after a change on the card, with the View rule kept:
 * View turned off takes every other customer switch with it; any other one on
 * without View turns View on. `before` and `after` are permission lists. A
 * change on another card leaves the customer switches as they are, even on a
 * role saved before the rule.
 */
export const withCustomerViewRule = (before: Loose, after: Loose[]) => {
  const changed = ALL_CUSTOMER_PERMISSIONS.some((key) => before.includes(key) !== after.includes(key));
  if (!changed) return after;
  const wasOn = before.includes(P.VIEW);
  const isOn = after.includes(P.VIEW);
  if (wasOn && !isOn) return after.filter((key: string) => !CUSTOMER_NEEDS_VIEW.includes(key));
  if (!isOn && after.some((key: string) => CUSTOMER_NEEDS_VIEW.includes(key))) return [...after, P.VIEW];
  return after;
};

export const canViewCustomers = (user: Loose) => has(user, P.VIEW);
const withView = (key: string) => (user: Loose) => canViewCustomers(user) && has(user, key);
export const canViewCustomerProfile = withView(P.PROFILE);
export const canExportCustomers = withView(P.EXPORT);
export const canAddCustomer = withView(P.ADD);
export const canImportCustomers = withView(P.IMPORT);
export const canEditCustomers = withView(P.EDIT);
// Delete is its own switch: Edit no longer implies it (2026-10-17 — a manager
// with Edit and Delete off was offered Delete customer…).
export const canDeleteCustomers = withView(P.DELETE);

/**
 * What a customer's basic card holds, for someone without Full profile: who
 * they are, how to reach them, where, who owns the account and its status.
 * Everything else (visits, resources, contacts, network, level and pricing,
 * Moda, marketing, notes, login state) is profile. The server cuts every list
 * row and detail to this and refuses writes to anything outside it, so the
 * hiding doesn't depend on the screen.
 */
export const BASIC_CUSTOMER_FIELDS = Object.freeze([
  '_id', 'company', 'name', 'contactName', 'firstName', 'lastName', 'email', 'phone',
  'address', 'city', 'customerType', 'status', 'salesRep', 'salesRepName', 'location',
  'createdAt', 'updatedAt'
]);

/** A copy of `customer` holding only the basic-card fields. */
export const basicCustomer = (customer: Loose = {}) => {
  const out: Loose = {};
  for (const key of BASIC_CUSTOMER_FIELDS) if (customer[key] !== undefined) out[key] = customer[key];
  return out;
};

/** A $project stage keeping only the basic-card fields. */
export const BASIC_CUSTOMER_PROJECTION = Object.freeze(
  Object.fromEntries(BASIC_CUSTOMER_FIELDS.map((key) => [key, 1]))
);
