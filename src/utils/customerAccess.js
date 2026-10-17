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
 *     import_customers       → import new customers from Excel (add only)
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
 * (server.js records it in seededPermissions, so switching one off sticks).
 */
export const CUSTOMER_MIGRATION = Object.freeze([
  { from: P.EDIT, grant: [P.ADD, P.IMPORT] }
]);

/** Granted to Admin only, once, on the next start. */
export const CUSTOMER_ADMIN_GRANTS = Object.freeze([P.PROFILE, P.EXPORT, P.ADD, P.IMPORT]);

const permsOf = (user) => (Array.isArray(user?.permissions) ? user.permissions : []);
const has = (user, key) => permsOf(user).includes(key);

export const canViewCustomers = (user) => has(user, P.VIEW);
export const canViewCustomerProfile = (user) => has(user, P.PROFILE);
export const canExportCustomers = (user) => has(user, P.EXPORT);
export const canAddCustomer = (user) => has(user, P.ADD);
export const canImportCustomers = (user) => has(user, P.IMPORT);
export const canEditCustomers = (user) => has(user, P.EDIT);
export const canDeleteCustomers = (user) => canEditCustomers(user) || has(user, P.DELETE);

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
export const basicCustomer = (customer = {}) => {
  const out = {};
  for (const key of BASIC_CUSTOMER_FIELDS) if (customer[key] !== undefined) out[key] = customer[key];
  return out;
};

/** A $project stage keeping only the basic-card fields. */
export const BASIC_CUSTOMER_PROJECTION = Object.freeze(
  Object.fromEntries(BASIC_CUSTOMER_FIELDS.map((key) => [key, 1]))
);
