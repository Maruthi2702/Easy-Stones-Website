import { resourceQty } from '../../../utils/resourceForm';
import type { Loose } from '../../../types/records';
import { STARTING_RESOURCE_FAMILIES, OTHER_FAMILY } from '../../../utils/typeLists';

/*
 * Dashboard → Resources (Option A on the claude.ai artifact "Resources
 * Redesign Canvas"): what a resource's type is a kind of, the Filters panel's
 * choices and counts, the phone's week headings, and the Excel rows.
 */

/** A family as the list reads it (Admin → Resource Types → Families, from the database). */
export type FamilyLike = { name: string; label: string; order?: number };

/** The families in the managers' order; the starting five until the list has loaded. */
export const familiesOrStarting = (families: readonly FamilyLike[] = []): FamilyLike[] =>
    families.length ? [...families].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [...STARTING_RESOURCE_FAMILIES];

const STARTING_BY_NAME = new Map(STARTING_RESOURCE_FAMILIES.map((f) => [f.name, f]));

/** The colour class's family: the five built in have their own colour, a family a manager added shows as Other. */
export const familyColour = (family: string): string => (STARTING_BY_NAME.has(family) ? family : OTHER_FAMILY);

/** The short tag on a phone card's tile: the built-in one, else the first three letters of the family's name. */
export const familyTag = (family: string, families: readonly FamilyLike[] = []): string => {
    const builtIn = STARTING_BY_NAME.get(family);
    if (builtIn) return builtIn.tag;
    const label = families.find((f) => f.name === family)?.label || family;
    return label.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || STARTING_BY_NAME.get(OTHER_FAMILY)!.tag;
};

/** What the list knows about a type: its family and the label staff read. */
export type TypeInfo = (type: unknown) => { family: string; label: string; order: number };

/**
 * Lookup over the Resource Types list (Admin → Resource Types, from the
 * database): the family a manager chose and the current label. A name that is
 * not in the list (a very old resource), or a family no longer on the families
 * list, is Other; an unknown name shows as stored.
 */
export const typeInfoFrom = (
    list: { name: string; label: string; order?: number; family?: string }[],
    families: readonly FamilyLike[] = []
): TypeInfo => {
    const byName = new Map(list.map((t) => [t.name, t]));
    const known = new Set(familiesOrStarting(families).map((f) => f.name));
    return (type) => {
        const name = String(type ?? '');
        const t = byName.get(name);
        return { family: t?.family && known.has(t.family) ? t.family : OTHER_FAMILY, label: t?.label || name, order: t?.order ?? Number.MAX_SAFE_INTEGER };
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

export type TypeFacet = { family: string; label: string; types: { type: string; label: string; count: number }[] };

/** The types in the rows, grouped by family (families and types in the managers' order), each with its count. */
export const typeFacets = (rows: Loose[], info: TypeInfo, families: readonly FamilyLike[] = []): TypeFacet[] => {
    const counts = new Map<string, number>();
    rows.forEach((r) => {
        const t = typeOf(r);
        if (t) counts.set(t, (counts.get(t) || 0) + 1);
    });
    const list = familiesOrStarting(families);
    // Other is always a group, so a type whose family is gone still has one.
    if (!list.some((f) => f.name === OTHER_FAMILY)) list.push(STARTING_BY_NAME.get(OTHER_FAMILY)!);
    return list
        .map(({ name: family, label }) => ({
            family,
            label,
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
