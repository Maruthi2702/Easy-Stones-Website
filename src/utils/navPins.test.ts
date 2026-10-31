import type { Loose } from '../types/records.ts';
import { describe, it, expect } from 'vitest';
import {
  NAV_ITEMS, MAX_PINNED_TABS, visibleSections, railSections, sectionOf, isOnePageSection,
  sanitizeNavOrder, orderedSections, navOrderOf, isDefaultNavOrder, moveInList, sanitizePinnedTabs, visiblePinnedTabs,
  pinnedDefaultTab, togglePinnedTab, makeDefaultTab, isCheckInOnly, hasSalesPage
} from './navPins.ts';

const rep = { role: 'sales_rep', permissions: ['view_customers', 'view_route_planner', 'view_daily_report'] };
const admin = { role: 'admin', permissions: ['view_dashboard', 'manage_users'] };

describe('nav visibility', () => {
  it('keeps the old per-page rules, admin fallbacks included', () => {
    const ids = (u: Loose) => visibleSections(u).flatMap((s) => s.items.map((i) => i.id));
    expect(ids(rep)).toEqual(['customers', 'route_planner', 'daily_report']);
    expect(ids(admin)).toEqual([
      'dashboard', 'team_files', 'lost_sales', 'delivery_schedule', 'daily_report',
      'inventory_analysis', 'crossover_sheet', 'live_inventory', 'users', 'roles', 'locations', 'nav_order'
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

  it('a one-page section opens its page, except Home and Accounting, which keep their panel', () => {
    const one = (id: unknown): Loose => ({ id, items: [{ id: 'x' }] });
    expect(isOnePageSection(one('admin'))).toBe(true);
    expect(isOnePageSection(one('home'))).toBe(false);
    const accounting = railSections({ permissions: ['view_freight_charges'] }).find((s) => s.id === 'accounting');
    expect(accounting.items.map((i) => i.id)).toEqual(['freight']);
    expect(isOnePageSection(accounting)).toBe(false);
    expect(isOnePageSection({ id: 'admin', items: [{ id: 'users' }, { id: 'nav_order' }] })).toBe(false);
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
  const ids = (sections: Loose[]) => sections.map((s: Loose) => [s.id, s.items.map((i: number) => i.id)]);

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
      ['sales', ['lost_sales', 'customers', 'route_planner', 'holds', 'permits', 'team_files']],
      ['home', ['dashboard']],
      ['products', ['pricelist', 'inventory_analysis', 'crossover_sheet', 'live_inventory']],
      ['accounting', ['freight', 'fuel_man']],
      ['admin', ['users', 'roles', 'locations', 'nav_order']]
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

describe('isCheckInOnly — the Kiosk role', () => {
  it('is someone who can check visitors in and open no Sales page', () => {
    expect(isCheckInOnly({ role: 'kiosk', permissions: ['create_checkins'] })).toBe(true);
    expect(isCheckInOnly({ role: 'kiosk', permissions: ['create_checkins', 'view_checkin_qr'] })).toBe(true);
  });

  it('is not anyone with a page to open, the Check-In Log included', () => {
    expect(isCheckInOnly({ role: 'csr', permissions: ['create_checkins', 'view_checkins'] })).toBe(false);
    expect(isCheckInOnly({ role: 'admin', permissions: ['create_checkins'] })).toBe(false); // Lost Sales etc. open for admin
    expect(isCheckInOnly({ role: 'x', permissions: ['create_checkins', 'view_customers'] })).toBe(false);
  });

  it('is not someone who cannot check in, or nobody', () => {
    expect(isCheckInOnly({ role: 'driver', permissions: [] })).toBe(false);
    expect(isCheckInOnly(null)).toBe(false);
  });
});

describe('hasSalesPage — who the shared server lists answer', () => {
  it('is anyone with a page in the side nav, a driver included', () => {
    expect(hasSalesPage({ role: 'driver', permissions: ['view_delivery_schedule', 'delivery_driver_view'] })).toBe(true);
    expect(hasSalesPage({ role: 'csr', permissions: ['view_checkins'] })).toBe(true);
    expect(hasSalesPage({ role: 'admin', permissions: [] })).toBe(true);
  });

  it('is not a kiosk, a website customer, a role with nothing, or nobody', () => {
    expect(hasSalesPage({ role: 'kiosk', permissions: ['create_checkins'] })).toBe(false);
    expect(hasSalesPage({ role: 'customer', type: 'customer', permissions: [] })).toBe(false);
    expect(hasSalesPage({ role: 'x', permissions: [] })).toBe(false);
    expect(hasSalesPage(null)).toBe(false);
  });
});

describe('Live Inventory — a link, not a page', () => {
  const ids = (user: Loose) => visibleSections(user).flatMap((s) => s.items.map((i) => i.id));
  it('sits beside the other Products pages, for whoever sees one', () => {
    expect(ids({ role: 'x', permissions: ['view_pricelist'] })).toEqual(['pricelist', 'live_inventory']);
  });
  it('never makes a Products module on its own', () => {
    expect(ids({ role: 'x', permissions: ['view_customers'] })).toEqual(['customers']);
    expect(ids(null)).not.toContain('live_inventory');
  });
  it('is never a Sales page, so a Kiosk login stays check-in only', () => {
    expect(hasSalesPage({ role: 'kiosk', permissions: ['create_checkins'] })).toBe(false);
  });
  it('can’t be pinned', () => {
    expect(sanitizePinnedTabs(['live_inventory', 'customers'])).toEqual(['customers']);
    expect(togglePinnedTab(['customers'], 'live_inventory')).toEqual(['customers']);
  });
});


describe('Fuel Man accounting navigation', () => {
  it('requires its view permission and supports a direct pin', () => {
    const user = { permissions: ['view_fuel_man'] };
    expect(visibleSections(user).map(s => [s.id, s.items.map(i => i.id)])).toEqual([['accounting', ['fuel_man']]]);
    expect(pinnedDefaultTab(user, ['fuel_man'])).toBe('fuel_man');
    expect(visibleSections({ permissions: ['import_fuel_man'] })).toEqual([]);
  });
});
