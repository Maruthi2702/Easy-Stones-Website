/**
 * Which Delivery Schedule a person gets, decided only by the permissions on
 * their role (Users & Roles → Delivery Schedule) — never by the role's name,
 * so any role can be given any of the three:
 *
 *   delivery_driver_view    → 'driver': only their own stops, on their phone
 *   edit_delivery_schedule  → 'office': the full board — schedule, drag to
 *                             assign, reorder, add and edit tickets
 *   view_delivery_schedule  → 'sales':  the board, read-only
 *
 * Checked in that order: Driver view wins, so a driver who was also given
 * Edit still gets their own stops rather than the dispatch board. A person
 * with none of them gets the read-only board (the tab itself is only offered
 * with View), never the full one by default.
 *
 * The server checks the same permissions on every route (src/routes/
 * deliveries.js); this only picks the screen. isDeliveryDriver is also what
 * the order search refuses, on the screen and the server alike.
 */
export const DELIVERY_PERMISSIONS = Object.freeze({
  VIEW: 'view_delivery_schedule',
  EDIT: 'edit_delivery_schedule',
  DRIVER_VIEW: 'delivery_driver_view'
});

const permsOf = (user) => (Array.isArray(user?.permissions) ? user.permissions : []);

export const isDeliveryDriver = (user) => permsOf(user).includes(DELIVERY_PERMISSIONS.DRIVER_VIEW);

export const deliveryViewMode = (user) => {
  if (isDeliveryDriver(user)) return 'driver';
  if (permsOf(user).includes(DELIVERY_PERMISSIONS.EDIT)) return 'office';
  return 'sales';
};
