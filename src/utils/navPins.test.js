import { describe, it, expect } from 'vitest';
import {
  NAV_ITEMS, MAX_PINNED_TABS, visibleSections, railSections, sectionOf,
  sanitizeNavOrder, orderedSections, navOrderOf, isDefaultNavOrder, moveInList, sanitizePinnedTabs, visiblePinnedTabs,
  pinnedDefaultTab, togglePinnedTab, makeDefaultTab
} from './navPins.js';

const rep = { role: 'sales_rep', permissions: ['view_customers', 'view_route_planner', 'view_daily_report'] };
const admin = { role: 'admin', permissions: ['view_dashboard', 'manage_users'] };

describe('nav visibility', () => {
  it('keeps the old per-page rules, admin fallbacks included', () => {
    const ids = (u) => visibleSections(u).flatMap((s) => s.items.map((i) => i.id));
    expect(ids(rep)).toEqual(['customers', 'route_planner', 'daily_report']);
    expect(ids(admin)).toEqual([
      'dashboard', 'lost_sales', 'delivery_schedule', 'daily_report',
      'inventory_analysis', 'crossover_sheet', 'users', 'nav_order'
    ]);
  });

  it('drops sections with nothing visible in them', () => {
    expect(visibleSections(rep).map((s) => s.id)).toEqual(['sales', 'operations']);
  });

  it('lists the Check-In Log under Operations, after Daily Report', () => {
    const desk = { role: 'front_desk', permissions: ['view_checkins', 'view_daily_report'] };
    expect(visibleSections(desk).map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([
      ['operations', ['daily_report', 'checkin']]
    ]);
  });

  it('always puts Home on the rail, since the pins live there', () => {
    expect(railSections(rep).map((s) => [s.id, s.items.length])).toEqual([['home', 0], ['sales', 2], ['operations', 1]]);
    expect(railSections(admin).map((s) => s.id)).toEqual(['home', 'sales', 'operations', 'products', 'admin']);
    expect(railSections(admin)[0].items.map((i) => i.id)).toEqual(['dashboard']);
  });

  it('knows every page’s section', () => {
    for (const item of NAV_ITEMS) expect(sectionOf(item.id)).toBe(item.section);
    expect(sectionOf('profile')).toBeNull();
  });
});

describe('sanitizePinnedTabs', () => {
  it('keeps known ids once, in order, up to the limit', () => {
    expect(sanitizePinnedTabs(['customers', 'nope', 'customers', 7, 'checkin'])).toEqual(['customers', 'checkin']);
    const all = NAV_ITEMS.map((i) => i.id);
    expect(sanitizePinnedTabs(all)).toHaveLength(MAX_PINNED_TABS);
  });

  it('returns null for anything that is not a list', () => {
    expect(sanitizePinnedTabs(undefined)).toBeNull();
    expect(sanitizePinnedTabs('customers')).toBeNull();
    expect(sanitizePinnedTabs([])).toEqual([]);
  });
});

describe('default tab', () => {
  it('is the first pin the person can still open', () => {
    expect(pinnedDefaultTab(rep, ['users', 'daily_report', 'customers'])).toBe('daily_report');
    expect(visiblePinnedTabs(rep, ['users', 'daily_report'])).toEqual(['daily_report']);
  });

  it('is null with no usable pins, so the role-based default applies', () => {
    expect(pinnedDefaultTab(rep, [])).toBeNull();
    expect(pinnedDefaultTab(rep, ['users'])).toBeNull();
    expect(pinnedDefaultTab(rep, undefined)).toBeNull();
  });
});

describe('pin edits', () => {
  it('toggles a pin on (added last) and off', () => {
    expect(togglePinnedTab(['customers'], 'checkin')).toEqual(['customers', 'checkin']);
    expect(togglePinnedTab(['customers', 'checkin'], 'customers')).toEqual(['checkin']);
  });

  it('ignores unknown pages and a full list', () => {
    expect(togglePinnedTab(['customers'], 'nope')).toEqual(['customers']);
    const full = NAV_ITEMS.slice(0, MAX_PINNED_TABS).map((i) => i.id);
    const extra = NAV_ITEMS[MAX_PINNED_TABS].id;
    expect(togglePinnedTab(full, extra)).toEqual(full);
  });

  it('makes a pin the default by moving it to the top', () => {
    expect(makeDefaultTab(['customers', 'checkin', 'pricelist'], 'pricelist')).toEqual(['pricelist', 'customers', 'checkin']);
    expect(makeDefaultTab(['customers'], 'checkin')).toEqual(['customers']);
  });
});

describe('admin nav order', () => {
  const ids = (sections) => sections.map((s) => [s.id, s.items.map((i) => i.id)]);

  it('keeps only known ids, each page under its own section, once', () => {
    expect(sanitizeNavOrder({
      sections: ['sales', 'nope', 'sales', 'home'],
      items: { sales: ['lost_sales', 'pricelist', 'customers', 'lost_sales'], bogus: ['users'] }
    })).toEqual({ sections: ['sales', 'home'], items: { sales: ['lost_sales', 'customers'] } });
    expect(sanitizeNavOrder(null)).toBeNull();
    expect(sanitizeNavOrder(['sales'])).toBeNull();
  });

  it('applies the order and puts anything it doesn’t mention after, in the default order', () => {
    const order = { sections: ['operations', 'sales'], items: { sales: ['lost_sales'], operations: ['checkin', 'delivery_schedule'] } };
    expect(ids(orderedSections(order))).toEqual([
      ['operations', ['checkin', 'delivery_schedule', 'daily_report']],
      ['sales', ['lost_sales', 'customers', 'route_planner']],
      ['home', ['dashboard']],
      ['products', ['pricelist', 'inventory_analysis', 'crossover_sheet']],
      ['admin', ['users', 'nav_order']]
    ]);
  });

  it('is the default with no order, and round-trips through navOrderOf', () => {
    expect(isDefaultNavOrder(null)).toBe(true);
    expect(isDefaultNavOrder(navOrderOf(orderedSections(null)))).toBe(true);
    const custom = { sections: ['admin'] };
    expect(isDefaultNavOrder(custom)).toBe(false);
    expect(navOrderOf(orderedSections(navOrderOf(orderedSections(custom))))).toEqual(navOrderOf(orderedSections(custom)));
  });

  it('orders what each person sees, Home still kept for their pins', () => {
    const order = { sections: ['operations', 'sales', 'home'], items: { sales: ['route_planner', 'customers'] } };
    expect(ids(visibleSections(rep, order))).toEqual([['operations', ['daily_report']], ['sales', ['route_planner', 'customers']]]);
    expect(railSections(rep, order).map((s) => s.id)).toEqual(['operations', 'sales', 'home']);
  });

  it('moves an entry up or down, never past the ends', () => {
    expect(moveInList(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveInList(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveInList(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveInList(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
