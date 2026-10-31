import type { Loose } from '../types/records.ts';
/**
 * The Sales CRM side nav: which pages exist, which section each sits in, who
 * may see it, and the per-person pinned list (User.pinnedTabs) — the first
 * pinned page someone can still see is where /sales opens for them.
 *
 * One list on purpose: adding a page is one entry here (plus its icon in
 * navIcons.js and its screen in SalesPage.jsx), and the server checks
 * saved pins against the same ids (src/routes/pinnedTabs.ts).
 *
 * The canSee rules are copied as-is from the hand-written nav they replace,
 * inconsistencies included: some pages also open for the admin role or a
 * signed-out render (`!user`), others only for the permission. Change them
 * deliberately, not while moving them.
 */

import { HOLD_VIEW_PERMISSIONS } from '../holds/permissions.ts';
import { PERMITS } from '../permits/permissions.ts';
import { canCheckIn, canViewCheckInLog } from './checkInAccess.ts';
import { canViewLostSales } from './lostSaleAccess.ts';
import { canOpenUsersPage } from './teamAccess.ts';
import { canOpenArea, can, NAV_ORDER } from './usersAccess.ts';

type NavUser = Loose | null | undefined;
export type NavItem = { id: string; label: string; section: string; href?: string; canSee: (user: NavUser) => boolean };
export type NavSection = { id: string; label: string; keepPanel?: boolean };
export type NavOrder = { sections: string[]; items: Record<string, string[]> };

const has = (user: NavUser, perm: string) => !!user?.permissions?.includes(perm);
const isAdmin = (user: NavUser) => user?.role === 'admin';

export const NAV_SECTIONS: NavSection[] = [
  { id: 'home', label: 'Home' },
  { id: 'sales', label: 'Sales' },
  { id: 'operations', label: 'Operations' },
  { id: 'products', label: 'Products' },
  // Opens its panel even with one page in it: more Accounting pages are
  // coming (owner, 2026-10-10), so it shouldn't behave like a one-page link.
  { id: 'accounting', label: 'Accounting', keepPanel: true },
  { id: 'admin', label: 'Admin' }
];

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', section: 'home', canSee: (u: NavUser) => has(u, 'view_dashboard') },
  { id: 'customers', label: 'Customers', section: 'sales', canSee: (u: NavUser) => has(u, 'view_customers') },
  // Granted deliberately under Users & Roles, so the permission is the only key.
  { id: 'route_planner', label: 'Route Planner', section: 'sales', canSee: (u: NavUser) => has(u, 'view_route_planner') },
  // Holds (src/holds/): any of the three "whose holds" switches opens it.
  { id: 'holds', label: 'Holds', section: 'sales', canSee: (u: NavUser) => HOLD_VIEW_PERMISSIONS.some((p) => has(u, p)) },
  // Permits (src/permits/): building permits as sales leads; the permission is the only key.
  { id: 'permits', label: 'Permits', section: 'sales', canSee: (u: NavUser) => has(u, PERMITS.VIEW) },
  // Team Files (src/features/teamFiles/): was the dashboard's Resources → Team Files, so it opens with the Dashboard.
  { id: 'team_files', label: 'Team Files', section: 'sales', canSee: (u: NavUser) => has(u, 'view_dashboard') },
  {
    id: 'lost_sales', label: 'Lost Sales', section: 'sales',
    canSee: (u: NavUser) => canViewLostSales(u) || !u
  },
  {
    id: 'delivery_schedule', label: 'Delivery Schedule', section: 'operations',
    canSee: (u: NavUser) => has(u, 'view_delivery_schedule') || isAdmin(u) || !u
  },
  {
    id: 'daily_report', label: 'Daily Report', section: 'operations',
    canSee: (u: NavUser) => has(u, 'view_daily_report') || isAdmin(u) || !u
  },
  { id: 'checkin', label: 'Check-In Log', section: 'operations', canSee: (u: NavUser) => canViewCheckInLog(u) },
  { id: 'pricelist', label: 'Price List', section: 'products', canSee: (u: NavUser) => has(u, 'view_pricelist') },
  {
    id: 'inventory_analysis', label: 'Inventory Analysis', section: 'products',
    canSee: (u: NavUser) => has(u, 'view_inventory_analysis') || isAdmin(u) || !u
  },
  {
    id: 'crossover_sheet', label: 'Crossover Sheet', section: 'products',
    canSee: (u: NavUser) => has(u, 'view_crossover_sheet') || isAdmin(u) || !u
  },
  // Not a page here: StoneProfits' live inventory, opened in a new tab
  // (SalesPage's handleCrmTabChange). It was a link in the site header until
  // the header left the staff screens (2026-10-18). Shown beside the other
  // Products pages, to whoever sees one — never a Products module of its own,
  // which would take a phone tab-bar slot from everyone. A link never counts
  // as a Sales page (hasSalesPage) and can't be pinned (sanitizePinnedTabs).
  {
    id: 'live_inventory', label: 'Live Inventory', section: 'products',
    href: 'https://easystones.stoneprofitsweb.com/',
    canSee: (u: NavUser) => !!u && NAV_ITEMS.some((item) => item.section === 'products' && !item.href && item.canSee(u))
  },
  // Accounting (src/accounting/): the permission is the only key, as with
  // every Accounting action.
  { id: 'freight', label: '3rd-Party Freight', section: 'accounting', canSee: (u: NavUser) => has(u, 'view_freight_charges') },
  { id: 'fuel_man', label: 'Fuel Man', section: 'accounting', canSee: (u: NavUser) => has(u, 'view_fuel_man') },
  // Users & Roles is three pages (2026-10-16), each opened by any action in its area
  // (src/utils/usersAccess.ts), Users also by team access (src/utils/teamAccess.ts).
  { id: 'users', label: 'Users', section: 'admin', canSee: (u: NavUser) => canOpenUsersPage(u) },
  { id: 'roles', label: 'Roles & Permissions', section: 'admin', canSee: (u: NavUser) => canOpenArea(u, 'roles') },
  { id: 'locations', label: 'Locations', section: 'admin', canSee: (u: NavUser) => canOpenArea(u, 'locations') },
  // The side nav's order for everyone (NavOrderTab.jsx); saving needs the same permission.
  { id: 'nav_order', label: 'Side Nav Order', section: 'admin', canSee: (u: NavUser) => can(u, NAV_ORDER) }
];

export const MAX_PINNED_TABS = 8;

const ITEM_BY_ID = new Map(NAV_ITEMS.map((item) => [item.id, item]));

export const navItem = (id: unknown) => ITEM_BY_ID.get(id as string) || null;

export const visibleNavItems = (user: NavUser) => NAV_ITEMS.filter((item) => item.canSee(user));

const SECTION_IDS = NAV_SECTIONS.map((section) => section.id);
const unique = <T>(list: T[]): T[] => list.filter((id, i) => list.indexOf(id) === i);

/**
 * The admin-set nav order (saved site-wide by src/routes/navOrder.ts) cleaned
 * up: { sections: [section ids], items: { [section id]: [page ids] } }, known
 * ids only, each page only under its own section. Null when it isn't an
 * object, which means "no order set": the lists above are the default.
 */
export const sanitizeNavOrder = (value: unknown): NavOrder | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Loose;
  const sections = Array.isArray(input.sections) ? unique(input.sections.filter((id: string) => SECTION_IDS.includes(id))) : [];
  const items: Record<string, string[]> = {};
  for (const sectionId of SECTION_IDS) {
    const list = input.items?.[sectionId];
    if (Array.isArray(list)) items[sectionId] = unique(list.filter((id) => navItem(id)?.section === sectionId));
  }
  return { sections, items };
};

/**
 * Every section with every page, in the admin's order. Anything the order
 * doesn't mention — a page or section added since it was saved — goes after
 * the ordered ones, in the default order, so nothing ever disappears.
 */
export const orderedSections = (order: unknown) => {
  const saved = sanitizeNavOrder(order) || { sections: [], items: {} };
  const sectionIds = [...saved.sections, ...SECTION_IDS.filter((id) => !saved.sections.includes(id))];
  return sectionIds.map((sectionId) => {
    const listed = saved.items[sectionId] || [];
    const rest = NAV_ITEMS.filter((item) => item.section === sectionId && !listed.includes(item.id)).map((item) => item.id);
    return {
      ...NAV_SECTIONS.find((section) => section.id === sectionId)!,
      items: [...listed, ...rest].map(id => navItem(id)!)
    };
  });
};

/** The saved shape for sections as orderedSections returns them (the order editor's state). */
export const navOrderOf = (sections: Loose[]) => ({
  sections: sections.map((section: Loose) => section.id),
  items: Object.fromEntries(sections.map((section: Loose) => [section.id, section.items.map((item: Loose) => item.id)]))
});

/** True when `order` is the same as having no order set. */
export const isDefaultNavOrder = (order: unknown) =>
  JSON.stringify(navOrderOf(orderedSections(order))) === JSON.stringify(navOrderOf(orderedSections(null)));

/** Move entry `index` of `list` by `delta` (−1 up, +1 down); a move past either end changes nothing. */
export const moveInList = <T>(list: T[], index: number, delta: number) => {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
};

/** Sections that have at least one page this person can open, in nav order. */
export const visibleSections = (user: NavUser, order: unknown = null) =>
  orderedSections(order)
    .map((section) => ({ ...section, items: section.items.filter((item) => item.canSee(user)) }))
    .filter((section) => section.items.length > 0);

/**
 * Whether `user` can open at least one Sales page. The server's shared lists
 * (customers dropdown, staff list, product admin…) answer only these accounts
 * — never a customer's login or a check-in-only one (requireSalesPage).
 */
export const hasSalesPage = (user: NavUser) => !!user && visibleSections(user).some((section) => section.items.some((item) => !item.href));

/**
 * Someone whose only job here is checking visitors in — Users & Roles → Check
 * In → "Check in" and no Sales page at all, like the Kiosk role (2026-10-14).
 * /sales has nothing to show them, so they're sent to the check-in page.
 */
export const isCheckInOnly = (user: NavUser) => !!user && canCheckIn(user) && !hasSalesPage(user);

/**
 * The rail's sections: visibleSections, except Home is always there — it's
 * where the pinned pages are listed, so it's needed even by someone without
 * the Dashboard (its `items` is then empty).
 * @param {any} user
 * @param {any} [order]
 * @returns {{ id: string, label: string, items: any[] }[]}
 */
export const railSections = (user: NavUser, order: unknown = null) =>
  orderedSections(order)
    .map((section) => ({ ...section, items: section.items.filter((item) => item.canSee(user)) }))
    .filter((section) => section.items.length > 0 || section.id === 'home');

export const sectionOf = (tabId: unknown) => navItem(tabId)?.section || null;

/**
 * A section with a single page (Admin for most people) skips its panel on
 * desktop: a rail click opens the page itself. Home never does (the pins
 * live there), nor does a section marked keepPanel (Accounting).
 */
export const isOnePageSection = (section: Loose) =>
  !!section && section.id !== 'home' && !section.keepPanel && section.items.length === 1;

/**
 * A saved pin list cleaned up: known page ids only, no repeats, at most
 * MAX_PINNED_TABS, order kept. Anything that isn't an array is null, so the
 * server can tell "bad request" apart from "an empty list".
 */
export const sanitizePinnedTabs = (value: unknown) => {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string' || !ITEM_BY_ID.has(id) || ITEM_BY_ID.get(id)!.href || out.includes(id)) continue;
    out.push(id);
    if (out.length === MAX_PINNED_TABS) break;
  }
  return out;
};

/**
 * The pins this person can open right now. A pin whose permission was taken
 * away stays saved (it comes back if the permission does) but isn't shown.
 */
export const visiblePinnedTabs = (user: NavUser, pins: unknown) =>
  (sanitizePinnedTabs(pins) || []).filter((id) => navItem(id)!.canSee(user));

/** Where /sales opens when the URL names no tab: their first visible pin, or null. */
export const pinnedDefaultTab = (user: NavUser, pins: unknown) => visiblePinnedTabs(user, pins)[0] || null;

/** Pin a page (added last) or unpin it. Pinning past the limit changes nothing. */
export const togglePinnedTab = (pins: unknown, id: string) => {
  const list = sanitizePinnedTabs(pins) || [];
  if (list.includes(id)) return list.filter((p) => p !== id);
  if (!ITEM_BY_ID.has(id) || ITEM_BY_ID.get(id)!.href || list.length >= MAX_PINNED_TABS) return list;
  return [...list, id];
};

/** Move a pinned page to the top, which makes it the default. */
export const makeDefaultTab = (pins: unknown, id: string) => {
  const list = sanitizePinnedTabs(pins) || [];
  if (!list.includes(id)) return list;
  return [id, ...list.filter((p) => p !== id)];
};
