// The Customers list's fixed choices: tabs, filter options, sorts, and its cache.
import { Wrench, Users } from 'lucide-react';
import type { Loose } from '../../../types/records';

// Filtering on a rep is only half the question — "who has nobody yet" is the
// other half, and it is the list someone works through to clear the backlog.
export const UNASSIGNED = 'unassigned';

export const TABS = [
    { key: 'fabricators', label: 'Fabricators', icon: Wrench, hint: 'Fabricators are pricing-eligible and buy direct' },
    { key: 'partners', label: 'Partners', icon: Users, hint: 'Contractors, dealers, designers and more' },
];

export const LEVELS = ['Level - 1', 'Level - 2', 'Level - 3', 'Level - 4'];
export const PARTNER_TYPES = ['Contractor', 'Dealer', 'Floor Covering', 'Designer', 'Builder', 'Fabricator'];
export const MODA_OPTIONS = [
    { value: 'display', label: 'Has display' },
    { value: 'noDisplay', label: 'No display' },
    { value: 'binders', label: 'Has binders' },
    { value: 'noBinders', label: 'No binders' }
];
export const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
export const SORTS = [
    { value: 'company:asc', label: 'Company A–Z' },
    { value: 'company:desc', label: 'Company Z–A' },
    { value: 'level:asc', label: 'Level 1 → 4', profile: true },
    { value: 'city:asc', label: 'City' },
    { value: 'salesRep:asc', label: 'Sales rep' },
    { value: 'location:asc', label: 'Location' }
];

// The old "Import from Excel" window is hidden (owner's call, 2026-10-17) now
// that Import from SPS is the import in use. Set to true to show it again; it
// is also where the "Possible duplicates already in the database" list lives.
export const SHOW_EXCEL_IMPORT = false;

// Global in-memory cache to prevent re-fetching on tab switches & re-mounts.
// Cleared on every write (see clearListCache) — it has no expiry of its own.
export const globalPartnersCache: Record<string, Loose> = {};
export const clearListCache = () => { Object.keys(globalPartnersCache).forEach(k => delete globalPartnersCache[k]); };
