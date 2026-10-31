import type { Loose } from '../types/records.ts';
import { describe, it, expect } from 'vitest';
import { phoneNavModel, litTab, moreGroups, highlightParts, searchPages, opensDirectly, MORE } from './phoneNav';
import { navItem } from './navPins.ts';

const user = (...permissions): Loose => ({ role: 'sales_rep', permissions });
const full = user(
    'view_dashboard', 'view_customers', 'view_route_planner', 'view_delivery_schedule', 'view_daily_report',
    'view_pricelist', 'view_inventory_analysis', 'view_freight_charges'
);
const ids = (sections: Loose[]) => sections.map((s: Loose) => s.id);

describe('what sits on the bar', () => {
    it('is Dashboard, the first two modules, and the rest under More', () => {
        const m = phoneNavModel(full);
        expect(m.dashboard.id).toBe('dashboard');
        expect(ids(m.bar)).toEqual(['sales', 'operations']);
        expect(ids(m.more)).toEqual(['products', 'accounting']);
    });
    it('gives a third module to someone without the Dashboard', () => {
        const m = phoneNavModel(user('view_customers', 'view_daily_report', 'view_pricelist', 'view_freight_charges'));
        expect(m.dashboard).toBeNull();
        expect(ids(m.bar)).toEqual(['sales', 'operations', 'products']);
        expect(ids(m.more)).toEqual(['accounting']);
    });
    it('only ever lists what the login may open', () => {
        const m = phoneNavModel(user('view_dashboard', 'view_pricelist'));
        // The Dashboard's permission also opens Team Files (Sales) since 2026-10-30.
        expect(ids(m.bar)).toEqual(['sales', 'products']);
        expect(m.more).toEqual([]);
        expect(m.bar[0].items.map((i) => i.id)).toEqual(['team_files']);
        expect(m.bar[1].items.map((i) => i.id)).toEqual(['pricelist', 'live_inventory']);
    });
    it('follows the order an admin set', () => {
        const order = { sections: ['home', 'products', 'operations', 'sales', 'accounting', 'admin'], items: {} };
        const m = phoneNavModel(full, order);
        expect(ids(m.bar)).toEqual(['products', 'operations']);
        expect(ids(m.more)).toEqual(['sales', 'accounting']);
    });
    it('lists their pins, in order, never the Dashboard or a page they cannot open', () => {
        const m = phoneNavModel(full, null, ['daily_report', 'dashboard', 'users', 'customers']);
        expect(m.pins).toEqual(['daily_report', 'customers']);
    });
    it('opens a one-page module directly', () => {
        const m = phoneNavModel(user('view_dashboard', 'view_daily_report', 'view_customers'));
        expect(opensDirectly(m.bar.find((s) => s.id === 'operations'))).toBe(true);
        expect(opensDirectly(phoneNavModel(full).bar.find((s) => s.id === 'sales'))).toBe(false);
    });
});

describe('which tab is lit', () => {
    const m = phoneNavModel(full);
    it('lights Dashboard on the dashboard', () => expect(litTab('dashboard', m)).toBe('dashboard'));
    it('lights the module the page belongs to', () => {
        expect(litTab('customers', m)).toBe('sales');
        expect(litTab('daily_report', m)).toBe('operations');
    });
    it('lights More for a page under More and for the profile page', () => {
        expect(litTab('pricelist', m)).toBe(MORE);
        expect(litTab('freight', m)).toBe(MORE);
        expect(litTab('profile', m)).toBe(MORE);
        expect(litTab('nothing', m)).toBe(MORE);
    });
    it('lights More for the dashboard when the login has none', () => {
        expect(litTab('dashboard', phoneNavModel(user('view_customers')))).toBe(MORE);
    });
});

describe('the More sheet', () => {
    it('lists pinned pages first, then the remaining modules', () => {
        const m = phoneNavModel(full, null, ['customers', 'daily_report']);
        const groups = moreGroups(m, navItem);
        expect(groups.map((g) => g.id)).toEqual(['pinned', 'products', 'accounting']);
        expect(groups[0].items.map((i) => i.id)).toEqual(['customers', 'daily_report']);
    });
    it('has no Pinned group without pins', () => {
        expect(moreGroups(phoneNavModel(full), navItem).map((g) => g.id)).toEqual(['products', 'accounting']);
    });
});

describe('search', () => {
    it('finds pages in any module by part of the name, grouped by module', () => {
        const groups = searchPages(full, null, 'pri');
        expect(groups.map((g) => g.id)).toEqual(['products']);
        expect(groups[0].items.map((i) => i.id)).toEqual(['pricelist']);
        const r = searchPages(full, null, 'REPORT');
        expect(r[0].items.map((i) => i.id)).toEqual(['daily_report']);
    });
    it('looks under Sales and Operations too, and across modules', () => {
        const groups = searchPages(full, null, 'e');
        expect(ids(groups)).toContain('sales');
        expect(ids(groups)).toContain('operations');
    });
    it('is empty for nothing typed or nothing found, and never shows pages the login cannot open', () => {
        expect(searchPages(full, null, '')).toEqual([]);
        expect(searchPages(full, null, '   ')).toEqual([]);
        expect(searchPages(full, null, 'invoice')).toEqual([]);
        expect(searchPages(user('view_pricelist'), null, 'users')).toEqual([]);
    });
    it('splits a label around what was typed', () => {
        expect(highlightParts('Price List', 'pri')).toEqual({ pre: '', hit: 'Pri', post: 'ce List' });
        expect(highlightParts('Daily Report', 'rep')).toEqual({ pre: 'Daily ', hit: 'Rep', post: 'ort' });
        expect(highlightParts('Holds', '')).toEqual({ pre: 'Holds', hit: '', post: '' });
        expect(highlightParts('Holds', 'zzz')).toEqual({ pre: 'Holds', hit: '', post: '' });
    });
});
