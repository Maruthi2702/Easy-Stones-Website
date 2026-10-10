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

import { HOLD_VIEW_PERMISSIONS } from '../holds/permissions.js';

const has = (user, perm) => !!user?.permissions?.includes(perm);
const isAdmin = (user) => user?.role === 'admin';

export const NAV_SECTIONS = [
  { id: 'home', label: 'Home' },
  { id: 'sales', label: 'Sales' },
  { id: 'operations', label: 'Operations' },
  { id: 'products', label: 'Products' },
  // Opens its panel even with one page in it: more Accounting pages are
  // coming (owner, 2026-10-10), so it shouldn't behave like a one-page link.
  { id: 'accounting', label: 'Accounting', keepPanel: true },
  { id: 'admin', label: 'Admin' }
];

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', section: 'home', canSee: (u) => has(u, 'view_dashboard') },
  { id: 'customers', label: 'Customers', section: 'sales', canSee: (u) => has(u, 'view_customers') },
  // Granted deliberately under Users & Roles, so the permission is the only key.
  { id: 'route_planner', label: 'Route Planner', section: 'sales', canSee: (u) => has(u, 'view_route_planner') },
  // Holds (src/holds/): any of the three "whose holds" switches opens it.
  { id: 'holds', label: 'Holds', section: 'sales', canSee: (u) => HOLD_VIEW_PERMISSIONS.some((p) => has(u, p)) },
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
  // Accounting (src/accounting/): the permission is the only key, as with
  // every Accounting action.
  { id: 'freight', label: '3rd-Party Freight', section: 'accounting', canSee: (u) => has(u, 'view_freight_charges') },
  { id: 'users', label: 'Users & Roles', section: 'admin', canSee: (u) => has(u, 'manage_users') },
  // The side nav's order for everyone (NavOrderTab.jsx); saving needs manage_users too.
  { id: 'nav_order', label: 'Side Nav Order', section: 'admin', canSee: (u) => has(u, 'manage_users') }
];

export const MAX_PINNED_TABS = 8;

const ITEM_BY_ID = new Map(NAV_ITEMS.map((item) => [item.id, item]));

export const navItem = (id) => ITEM_BY_ID.get(id) || null;

export const visibleNavItems = (user) => NAV_ITEMS.filter((item) => item.canSee(user));

const SECTION_IDS = NAV_SECTIONS.map((section) => section.id);
const unique = (list) => list.filter((id, i) => list.indexOf(id) === i);

/**
 * The admin-set nav order (saved site-wide by src/routes/navOrder.js) cleaned
 * up: { sections: [section ids], items: { [section id]: [page ids] } }, known
 * ids only, each page only under its own section. Null when it isn't an
 * object, which means "no order set": the lists above are the default.
 */
export const sanitizeNavOrder = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sections = Array.isArray(value.sections) ? unique(value.sections.filter((id) => SECTION_IDS.includes(id))) : [];
  const items = {};
  for (const sectionId of SECTION_IDS) {
    const list = value.items?.[sectionId];
    if (Array.isArray(list)) items[sectionId] = unique(list.filter((id) => navItem(id)?.section === sectionId));
  }
  return { sections, items };
};

/**
 * Every section with every page, in the admin's order. Anything the order
 * doesn't mention — a page or section added since it was saved — goes after
 * the ordered ones, in the default order, so nothing ever disappears.
 */
export const orderedSections = (order) => {
  const saved = sanitizeNavOrder(order) || { sections: [], items: {} };
  const sectionIds = [...saved.sections, ...SECTION_IDS.filter((id) => !saved.sections.includes(id))];
  return sectionIds.map((sectionId) => {
    const listed = saved.items[sectionId] || [];
    const rest = NAV_ITEMS.filter((item) => item.section === sectionId && !listed.includes(item.id)).map((item) => item.id);
    return {
      ...NAV_SECTIONS.find((section) => section.id === sectionId),
      items: [...listed, ...rest].map(navItem)
    };
  });
};

/** The saved shape for sections as orderedSections returns them (the order editor's state). */
export const navOrderOf = (sections) => ({
  sections: sections.map((section) => section.id),
  items: Object.fromEntries(sections.map((section) => [section.id, section.items.map((item) => item.id)]))
});

/** True when `order` is the same as having no order set. */
export const isDefaultNavOrder = (order) =>
  JSON.stringify(navOrderOf(orderedSections(order))) === JSON.stringify(navOrderOf(orderedSections(null)));

/** Move entry `index` of `list` by `delta` (−1 up, +1 down); a move past either end changes nothing. */
export const moveInList = (list, index, delta) => {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
};

/** Sections that have at least one page this person can open, in nav order. */
export const visibleSections = (user, order = null) =>
  orderedSections(order)
    .map((section) => ({ ...section, items: section.items.filter((item) => item.canSee(user)) }))
    .filter((section) => section.items.length > 0);

/**
 * The rail's sections: visibleSections, except Home is always there — it's
 * where the pinned pages are listed, so it's needed even by someone without
 * the Dashboard (its `items` is then empty).
 */
export const railSections = (user, order = null) =>
  orderedSections(order)
    .map((section) => ({ ...section, items: section.items.filter((item) => item.canSee(user)) }))
    .filter((section) => section.items.length > 0 || section.id === 'home');

export const sectionOf = (tabId) => navItem(tabId)?.section || null;

/**
 * A section with a single page (Admin for most people) skips its panel on
 * desktop: a rail click opens the page itself. Home never does (the pins
 * live there), nor does a section marked keepPanel (Accounting).
 */
export const isOnePageSection = (section) =>
  !!section && section.id !== 'home' && !section.keepPanel && section.items.length === 1;

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
