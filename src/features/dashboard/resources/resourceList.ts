import { resourceQty } from '../../../utils/resourceForm';
import type { Loose } from '../../../types/records';

/*
 * Dashboard → Resources (Option A on the claude.ai artifact "Resources
 * Redesign Canvas"): what a resource's type is a kind of, the Filters panel's
 * choices and counts, the phone's week headings, and the Excel rows.
 */

export type ResourceFamily = 'tower' | 'tabletop' | 'binder' | 'samples' | 'other';

/** In the order the Filters panel lists them. */
export const FAMILY_ORDER: ResourceFamily[] = ['tower', 'tabletop', 'binder', 'samples', 'other'];

export const FAMILY_LABELS: Record<ResourceFamily, string> = {
    tower: 'Display towers',
    tabletop: 'Tabletop displays',
    binder: 'Sample binders',
    samples: 'Samples',
    other: 'Other'
};

/** The short tag on a phone card's tile. */
export const FAMILY_TAGS: Record<ResourceFamily, string> = {
    tower: 'TWR',
    tabletop: 'TBL',
    binder: 'BND',
    samples: 'SMP',
    other: 'OTH'
};

/** What the list knows about a type: its family and the label staff read. */
export type TypeInfo = (type: unknown) => { family: ResourceFamily; label: string; order: number };

/**
 * Lookup over the Resource Types list (Admin → Resource Types, from the
 * database): the family a manager chose and the current label. A name that is
 * not in the list (a very old resource) is Other and shows as stored.
 */
export const typeInfoFrom = (list: { name: string; label: string; order?: number; family?: ResourceFamily }[]): TypeInfo => {
    const byName = new Map(list.map((t) => [t.name, t]));
    return (type) => {
        const name = String(type ?? '');
        const t = byName.get(name);
        return { family: t?.family && FAMILY_LABELS[t.family] ? t.family : 'other', label: t?.label || name, order: t?.order ?? Number.MAX_SAFE_INTEGER };
    };
};

/** A resource's type as shown (old ones may only have a title). */
export const typeOf = (r: Loose): string => String(r.resourceType || r.title || r.name || '').trim();

/** Who logged it, as the list and its filter name them. */
export const loggedByOf = (r: Loose): string => String(r.uploadedByName || '').trim() || 'Unknown';

/** The company and the contact, from the record or its "Company - Contact" name. */
export const customerParts = (r: Loose): { company: string; contact: string } => {
    const company = String(r.company || '').trim();
    const contact = String(r.contactName || '').trim();
    if (company || contact) return { company: company || contact, contact: company ? contact : '' };
    const [first, ...rest] = String(r.customerName || '').split(' - ');
    return { company: first.trim(), contact: rest.join(' - ').trim() };
};

/** The day it was placed, YYYY-MM-DD ('' if none). */
export const resourceDay = (r: Loose): string => {
    const raw = String(r.date || r.createdAt || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : '';
};

export type ResourceFilters = { types: string[]; loggedBy: string[] };

export const NO_RESOURCE_FILTERS: ResourceFilters = { types: [], loggedBy: [] };

/** How many choices are ticked (the button's dot lights when any are). */
export const activeFilterCount = (f: ResourceFilters): number => f.types.length + f.loggedBy.length;

/** Rows matching the ticked types and loggers; nothing ticked in a group means all of it. */
export const applyResourceFilters = (rows: Loose[], f: ResourceFilters): Loose[] => rows.filter((r) =>
    (f.types.length === 0 || f.types.includes(typeOf(r))) &&
    (f.loggedBy.length === 0 || f.loggedBy.includes(loggedByOf(r))));

export type TypeFacet = { family: ResourceFamily; label: string; types: { type: string; label: string; count: number }[] };

/** The types in the rows, grouped by family (families in FAMILY_ORDER, types in the managers' order), each with its count. */
export const typeFacets = (rows: Loose[], info: TypeInfo): TypeFacet[] => {
    const counts = new Map<string, number>();
    rows.forEach((r) => {
        const t = typeOf(r);
        if (t) counts.set(t, (counts.get(t) || 0) + 1);
    });
    return FAMILY_ORDER
        .map((family) => ({
            family,
            label: FAMILY_LABELS[family],
            types: [...counts.entries()]
                .filter(([t]) => info(t).family === family)
                .map(([type, count]) => ({ type, label: info(type).label, count }))
                .sort((a, b) => info(a.type).order - info(b.type).order || a.label.localeCompare(b.label))
        }))
        .filter((g) => g.types.length > 0);
};

/** Who logged the rows, A–Z ("Unknown" last), with counts. */
export const loggerFacets = (rows: Loose[]): { name: string; count: number }[] => {
    const counts = new Map<string, number>();
    rows.forEach((r) => counts.set(loggedByOf(r), (counts.get(loggedByOf(r)) || 0) + 1));
    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => (a.name === 'Unknown' ? 1 : b.name === 'Unknown' ? -1 : a.name.localeCompare(b.name)));
};

const dayNumber = (ymd: string): number => {
    const [y, m, d] = ymd.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
};
// Monday-first, like the calendar (WEEK_STARTS_ON) and the Delivery Schedule.
const mondayOf = (ymd: string): number => {
    const n = dayNumber(ymd);
    return n - ((new Date(n * 86400000).getUTCDay() + 6) % 7);
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The phone list's heading for a day, from today: "This week", "Last week",
 * then "Earlier in October" for the rest of this month, "September 2026" before.
 */
export const weekHeading = (ymd: string, today: string): string => {
    if (!ymd) return 'No date';
    const diff = (mondayOf(today) - mondayOf(ymd)) / 7;
    if (diff <= 0) return 'This week';
    if (diff === 1) return 'Last week';
    const [y, m] = ymd.split('-').map(Number);
    if (ymd.slice(0, 7) === today.slice(0, 7)) return `Earlier in ${MONTHS[m - 1]}`;
    return `${MONTHS[m - 1]} ${y}`;
};

/** Rows (already newest first) cut into runs under one heading each. */
export const groupByWeek = (rows: Loose[], today: string): { heading: string; rows: Loose[] }[] => {
    const groups: { heading: string; rows: Loose[] }[] = [];
    rows.forEach((r) => {
        const heading = weekHeading(resourceDay(r), today);
        const last = groups[groups.length - 1];
        if (last && last.heading === heading) last.rows.push(r);
        else groups.push({ heading, rows: [r] });
    });
    return groups;
};

/** "Oct 13" (with the year when it isn't this year's). */
export const shortDay = (ymd: string, today: string): string => {
    if (!ymd) return '—';
    const [y, m, d] = ymd.split('-').map(Number);
    const base = `${MONTHS[m - 1].slice(0, 3)} ${d}`;
    return String(y) === today.slice(0, 4) ? base : `${base}, ${y}`;
};

/** The Excel sheet's rows, one per resource. */
export const resourceExportRows = (rows: Loose[]) => rows.map((r) => {
    const { company, contact } = customerParts(r);
    return {
        Date: resourceDay(r),
        Customer: company,
        Contact: contact,
        City: r.city || '',
        Location: r.customerLocation || '',
        Resource: typeOf(r),
        Qty: resourceQty(r),
        Description: r.description || '',
        Notes: r.notes || '',
        Status: r.status || 'Active',
        'Logged by': loggedByOf(r)
    };
});
