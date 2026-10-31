import type { Loose } from '../types/records.ts';
import { railSections, visiblePinnedTabs, sectionOf, isOnePageSection } from './navPins.ts';

/** A page in the side nav (navPins.js NAV_ITEMS), and a module with its pages. */
export type NavItem = { id: string; label: string; [key: string]: unknown };
export type NavSection = { id: string; label: string; items: NavItem[] };
export type PhoneNavModel = { dashboard: NavItem | null; bar: NavSection[]; more: NavSection[]; pins: string[] };
export type NavGroup = { id: string; label: string; items: NavItem[] };

/*
 * The phone's bottom tab bar (2026-10-18; design: claude.ai artifact "Phone
 * tab bar canvas" https://claude.ai/artifact/Qxs7fJxBs6MGJYiXowkirQ, and
 * "Phone menu search" https://claude.ai/artifact/GZ622Er9juw3MXzr6JjySA).
 * The screen is src/components/sales/PhoneTabBar.tsx; every rule about what
 * sits on the bar, what is lit and what the search finds is here.
 *
 * The bar is Dashboard · two modules · More. Which modules is the same list
 * the desktop rail shows (railSections: what this login may open, in the
 * order an admin set), so the first two take the bar and every other module
 * goes under More. Someone without the Dashboard gets a third module on the
 * bar instead. A module with a single page (Admin for most people) opens that
 * page straight away instead of a one-tile sheet.
 */

/** Tabs on the bar besides More. */
export const BAR_SLOTS = 3;

/** The id of the More tab. */
export const MORE = 'more';

/**
 * What the bar and its sheets are made of for one login:
 *   dashboard — the Dashboard page item, or null when they can't open it
 *   bar       — the modules on the bar (sections, each with its `items`)
 *   more      — the other modules, listed in the More sheet
 *   pins      — their pinned pages, in pin order (excluding the Dashboard)
 */
export const phoneNavModel = (user: Loose | null | undefined, navOrder: unknown = null, pinnedTabs: string[] = []): PhoneNavModel => {
    const sections: NavSection[] = railSections(user, navOrder);
    const dashboard = sections.find((s) => s.id === 'home')?.items.find((i) => i.id === 'dashboard') || null;
    const modules = sections.filter((s) => s.id !== 'home' && s.items.length > 0);
    const room = BAR_SLOTS - (dashboard ? 1 : 0);
    return {
        dashboard,
        bar: modules.slice(0, room),
        more: modules.slice(room),
        pins: visiblePinnedTabs(user, pinnedTabs).filter((id: string) => id !== 'dashboard')
    };
};

/** Whether a bar module opens its page directly rather than a sheet. */
export const opensDirectly = (section: NavSection): boolean => isOnePageSection(section);

/**
 * The tab that is lit for the page on screen: Dashboard, the module that
 * page belongs to, or More — for a page under More, and for the pages that
 * live in no module (My Profile).
 */
export const litTab = (crmTab: string, model: PhoneNavModel): string => {
    if (crmTab === 'dashboard' && model.dashboard) return 'dashboard';
    const section = sectionOf(crmTab);
    if (section && model.bar.some((s) => s.id === section)) return section;
    return MORE;
};

/** The modules the More sheet lists when nothing is typed: pinned pages first, then each remaining module. */
export const moreGroups = (model: PhoneNavModel, itemById: (id: string) => NavItem | null | undefined): NavGroup[] => {
    const groups: NavGroup[] = [];
    if (model.pins.length) {
        groups.push({ id: 'pinned', label: 'Pinned', items: model.pins.map(itemById).filter((i): i is NavItem => Boolean(i)) });
    }
    return groups.concat(model.more.map((s) => ({ id: s.id, label: s.label, items: s.items })));
};

/** `label` split around the first match of `query` (case-insensitive), for gold-lighting the letters typed. */
export const highlightParts = (label: string, query: string | null | undefined): { pre: string; hit: string; post: string } => {
    const q = (query || '').trim().toLowerCase();
    const at = q ? label.toLowerCase().indexOf(q) : -1;
    if (at < 0) return { pre: label, hit: '', post: '' };
    return { pre: label.slice(0, at), hit: label.slice(at, at + q.length), post: label.slice(at + q.length) };
};

/**
 * What typing in the More sheet shows: every page this login can open, in any
 * module (Sales and Operations included), whose name contains what was typed,
 * grouped by module. Pinned is not shown while searching, so no page appears
 * twice. Empty when nothing matches.
 */
export const searchPages = (user: Loose | null | undefined, navOrder: unknown, query: string | null | undefined): NavGroup[] => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    return (railSections(user, navOrder) as NavSection[])
        .map((section) => ({
            id: section.id,
            label: section.label,
            items: section.items.filter((item) => item.label.toLowerCase().includes(q))
        }))
        .filter((group) => group.items.length > 0);
};
