import { matchesOption } from './customerOptions.ts';
import type { CustomerOption } from './customerOptions.ts';

/**
 * Dashboard → Find a customer (the header's 🔍, 2026-11-04; claude.ai artifact
 * "Dashboard customer search", option A). It searches the one shared customer
 * list (`useCustomerOptions`) with its own search rule — name, contact, city —
 * so it finds the same customers every dropdown does. These are its rules, kept
 * pure so they're tested (customerQuickSearch.test.ts).
 */

/** Rows shown at most; past that the list says how many more to narrow down. */
export const QUICK_SEARCH_LIMIT = 50;
/** Customers kept under "Recently opened". */
export const RECENT_LIMIT = 5;

/** Where a person's recently opened customers are kept on this device. */
export const recentKey = (userId: string | null | undefined): string => `dashboardCustomerSearch.recent.${userId || 'anon'}`;

/**
 * The matches for what was typed: names that start with it first, then every
 * other match; each group keeps the list's own A–Z order. Blank → no rows.
 */
export const findCustomers = (
    options: CustomerOption[] | null | undefined,
    query: string,
    limit: number = QUICK_SEARCH_LIMIT
): { rows: CustomerOption[]; total: number } => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { rows: [], total: 0 };
    const starts: CustomerOption[] = [];
    const others: CustomerOption[] = [];
    for (const option of options || []) {
        if (!matchesOption(option, q)) continue;
        (option.label.toLowerCase().startsWith(q) ? starts : others).push(option);
    }
    const all = [...starts, ...others];
    return { rows: all.slice(0, limit), total: all.length };
};

/** A text cut where it matches what was typed (the first match), for the highlight. */
export const highlightParts = (text: string, query: string): { text: string; hit: boolean }[] => {
    const value = String(text || '');
    const q = String(query || '').trim().toLowerCase();
    const at = q ? value.toLowerCase().indexOf(q) : -1;
    if (at < 0) return value ? [{ text: value, hit: false }] : [];
    return [
        { text: value.slice(0, at), hit: false },
        { text: value.slice(at, at + q.length), hit: true },
        { text: value.slice(at + q.length), hit: false }
    ].filter((part) => part.text);
};

/** The recent list after opening `id`: it moves to the front, no repeats, at most RECENT_LIMIT. */
export const rememberRecent = (ids: unknown, id: string): string[] => {
    const list = Array.isArray(ids) ? ids.map(String) : [];
    if (!id) return list.slice(0, RECENT_LIMIT);
    return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_LIMIT);
};

/** Recent ids → the customers still on the list, in the order they were opened. */
export const recentCustomers = (options: CustomerOption[] | null | undefined, ids: unknown): CustomerOption[] => {
    if (!Array.isArray(ids) || !options?.length) return [];
    const byId = new Map(options.map((o) => [String(o.value), o]));
    return ids.map((id) => byId.get(String(id))).filter((o): o is CustomerOption => Boolean(o)).slice(0, RECENT_LIMIT);
};

/** Two letters for a name ("Harbor Stone Works" → "HS", "Kara Lee" → "KL"); '' when there's no name. */
export const initialsOf = (name: string | null | undefined): string => String(name || '')
    .split(/\s+/)
    .filter((word) => /^[a-z0-9]/i.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');

/** The second line of a row: city, then the contact when they aren't the name. */
export const rowDetail = (option: Pick<CustomerOption, 'city' | 'contact'>): string =>
    [option.city, option.contact].filter(Boolean).join(' · ');
