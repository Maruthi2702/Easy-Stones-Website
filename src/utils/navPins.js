/**
 * The Sales CRM side nav: which pages exist, which section each sits in, who
 * may see it, and the per-person pinned list (User.pinnedTabs) — the first
 * pinned page someone can still see is where /sales opens for them.
 *
 * One list on purpose: adding a page is one entry here (plus its icon in
 * CustomerSidebar.jsx and its screen in SalesPage.jsx), and the server checks
 * saved pins against the same ids (src/routes/pinnedTabs.js).
 *
 * The canSee rules are copied as-is from the hand-written nav they replace,
 * inconsistencies included: some pages also open for the admin role or a
 * signed-out render (`!user`), others only for the permission. Change them
 * deliberately, not while moving them.
 */

const has = (user, perm) => !!user?.permissions?.includes(perm);
const isAdmin = (user) => user?.role === 'admin';

export const NAV_SECTIONS = [
  { id: 'home', label: 'Home' },
  { id: 'sales', label: 'Sales' },
  { id: 'operations', label: 'Operations' },
  { id: 'products', label: 'Products' },
  { id: 'admin', label: 'Admin' }
];

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', section: 'home', canSee: (u) => has(u, 'view_dashboard') },
  { id: 'customers', label: 'Customers', section: 'sales', canSee: (u) => has(u, 'view_customers') },
  // Granted deliberately under Users & Roles, so the permission is the only key.
  { id: 'route_planner', label: 'Route Planner', section: 'sales', canSee: (u) => has(u, 'view_route_planner') },
  {
    id: 'lost_sales', label: 'Lost Sales', section: 'sales',
    canSee: (u) => has(u, 'view_lost_sales') || has(u, 'manage_lost_sales') || isAdmin(u) || !u
  },
  {
    id: 'delivery_schedule', label: 'Delivery Schedule', section: 'operations',
    canSee: (u) => has(u, 'view_delivery_schedule') || isAdmin(u) || !u
  },
  {
    id: 'daily_report', label: 'Daily Report', section: 'operations',
    canSee: (u) => has(u, 'view_daily_report') || isAdmin(u) || !u
  },
  { id: 'checkin', label: 'Check-In Log', section: 'operations', canSee: (u) => has(u, 'view_checkins') },
  { id: 'pricelist', label: 'Price List', section: 'products', canSee: (u) => has(u, 'view_pricelist') },
  {
    id: 'inventory_analysis', label: 'Inventory Analysis', section: 'products',
    canSee: (u) => has(u, 'view_inventory_analysis') || isAdmin(u) || !u
  },
  {
    id: 'crossover_sheet', label: 'Crossover Sheet', section: 'products',
    canSee: (u) => has(u, 'view_crossover_sheet') || isAdmin(u) || !u
  },
  { id: 'users', label: 'Users & Roles', section: 'admin', canSee: (u) => has(u, 'manage_users') }
];

export const MAX_PINNED_TABS = 8;

const ITEM_BY_ID = new Map(NAV_ITEMS.map((item) => [item.id, item]));

export const navItem = (id) => ITEM_BY_ID.get(id) || null;

export const visibleNavItems = (user) => NAV_ITEMS.filter((item) => item.canSee(user));

/** Sections that have at least one page this person can open, in nav order. */
export const visibleSections = (user) => {
  const items = visibleNavItems(user);
  return NAV_SECTIONS
    .map((section) => ({ ...section, items: items.filter((item) => item.section === section.id) }))
    .filter((section) => section.items.length > 0);
};

/**
 * The rail's sections: visibleSections, except Home is always there — it's
 * where the pinned pages are listed, so it's needed even by someone without
 * the Dashboard (its `items` is then empty).
 */
export const railSections = (user) => {
  const sections = visibleSections(user);
  if (sections.some((section) => section.id === 'home')) return sections;
  const home = NAV_SECTIONS.find((section) => section.id === 'home');
  return [{ ...home, items: [] }, ...sections];
};

export const sectionOf = (tabId) => navItem(tabId)?.section || null;

/**
 * A saved pin list cleaned up: known page ids only, no repeats, at most
 * MAX_PINNED_TABS, order kept. Anything that isn't an array is null, so the
 * server can tell "bad request" apart from "an empty list".
 */
export const sanitizePinnedTabs = (value) => {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const id of value) {
    if (typeof id !== 'string' || !ITEM_BY_ID.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length === MAX_PINNED_TABS) break;
  }
  return out;
};

/**
 * The pins this person can open right now. A pin whose permission was taken
 * away stays saved (it comes back if the permission does) but isn't shown.
 */
export const visiblePinnedTabs = (user, pins) =>
  (sanitizePinnedTabs(pins) || []).filter((id) => navItem(id).canSee(user));

/** Where /sales opens when the URL names no tab: their first visible pin, or null. */
export const pinnedDefaultTab = (user, pins) => visiblePinnedTabs(user, pins)[0] || null;

/** Pin a page (added last) or unpin it. Pinning past the limit changes nothing. */
export const togglePinnedTab = (pins, id) => {
  const list = sanitizePinnedTabs(pins) || [];
  if (list.includes(id)) return list.filter((p) => p !== id);
  if (!ITEM_BY_ID.has(id) || list.length >= MAX_PINNED_TABS) return list;
  return [...list, id];
};

/** Move a pinned page to the top, which makes it the default. */
export const makeDefaultTab = (pins, id) => {
  const list = sanitizePinnedTabs(pins) || [];
  if (!list.includes(id)) return list;
  return [id, ...list.filter((p) => p !== id)];
};
