/**
 * Who may see, record, change and delete lost sales (Users & Roles → Lost
 * Sales). The server's /api/lost-sales routes, the side nav and the Lost Sales
 * screen all call these, so a button the screen offers is one the API accepts.
 * (The routes used to answer any login — a customer's or a kiosk's included.)
 *
 * Copied as-is from the screen's own rules (2026-10-14), role names included:
 * the admin role sees the page without View, and admin/director may edit and
 * delete without the switches. manage_lost_sales is an older key some roles
 * may still hold; it allows everything.
 */
const permsOf = (user) => (Array.isArray(user?.permissions) ? user.permissions : []);
const has = (user, key) => permsOf(user).includes(key);
const isAdminOrDirector = (user) => user?.role === 'admin' || user?.role === 'director';

export const canViewLostSales = (user) =>
  has(user, 'view_lost_sales') || has(user, 'manage_lost_sales') || user?.role === 'admin';

export const canEditLostSales = (user) =>
  isAdminOrDirector(user) || has(user, 'edit_lost_sales') || has(user, 'manage_lost_sales');

export const canDeleteLostSales = (user) =>
  isAdminOrDirector(user) || has(user, 'delete_lost_sales') || has(user, 'manage_lost_sales');
