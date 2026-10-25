// Small pure helpers shared across the Route Planner module.
import { isFillerName, isPlaceholderEmail } from '../../utils/customerMatch';
import { visitRecency as recencyOfVisit } from '../../utils/routePlan';
import type { LatLng, Lead, Recency, RecencyColors, RecencyKey, ScheduleRow } from './types';

/** How long since the last visit — visitRecency (src/utils/routePlan.js) with its answer typed. */
export const visitRecency = recencyOfVisit as (lastVisitAt: unknown, today?: Date) => Recency;

// A red → orange → yellow → gray ramp rather than the original single-hue
// red ramp (dark red/coral/peach/gray) — those four sat too close together
// in both hue and lightness to read apart on top of map tiles (green
// terrain, cream roads, blue water), which never has to happen for chip
// text sitting on the app's own near-black/near-white background. Ordered
// worst-first same as before: never (most urgent, red) through recent
// (least urgent, deliberately the calmest tone — kept gray rather than
// green so it doesn't collide with LEAD_PIN_COLOR below, a different
// concept — a found prospect, not an existing customer — that already owns
// green on this same map). Shared between both themes since the thing these
// mostly have to stay legible against, the map itself, doesn't change with
// the app's theme; 'due' is the one exception tuned per theme below, since
// a bright yellow that pops on near-black reads as washed-out on white.
export const RECENCY_COLORS: Record<'dark' | 'light', RecencyColors> = {
    dark: { never: '#c62828', overdue: '#e2711d', due: '#f2b705', recent: '#7a7a75' },
    light: { never: '#c62828', overdue: '#e2711d', due: '#c98a00', recent: '#7a7a75' }
};

// Buckets whose fill is bright enough that white label/chip text loses too
// much contrast — these need dark ink instead.
export const RECENCY_DARK_TEXT = new Set<RecencyKey>(['overdue', 'due']);

// Maps Customer.js's fixed status enum to a tone for the detail panel's
// status line (MapCanvas.tsx) — only the two ends of the funnel get a
// strong color (Onboarded = won, Not Interested = lost); the live pipeline
// stages share one "in progress" accent, and the two administrative states
// (rep reassigned, gone quiet) fall through to the muted default rather than
// being marked as either a win or a loss.
export const STATUS_TONE: Record<string, string> = {
    'Onboarded': 'success',
    'Not Interested': 'danger',
    'New Lead': 'accent',
    'Trying to Onboard': 'accent',
    'Contacted / In Discussion': 'accent'
};

export const statusTone = (status: string) => STATUS_TONE[status] || 'muted';

// Pin colours by customer type — set "A" of the Route Planner pin-colours
// design (2026-10-18): a colour-blind-safe set, each also a different
// lightness, kept clear of the "You" dot and route line (blue), the open pin
// (coral), a new lead (green) and the visit-age colours above. `ink` is the
// stop-number colour that reads on that fill. Keyed lowercase; a type not
// listed (or none) takes the grey.
export type PinColors = { color: string; ink: string };
export const TYPE_COLORS: Record<string, PinColors> = {
    'fabricator': { color: '#7B3FBF', ink: '#ffffff' },
    'contractor': { color: '#E69F00', ink: '#141414' },
    'dealer': { color: '#CC79A7', ink: '#141414' },
    'floor covering': { color: '#56B4E9', ink: '#141414' },
    'designer': { color: '#F0E442', ink: '#141414' },
    'builder': { color: '#8C510A', ink: '#ffffff' }
};
export const NO_TYPE_COLOR: PinColors = { color: '#9A9A95', ink: '#141414' };

/** { color, ink } for a customer type ('(blank)' and unknown types → grey). */
export const typeColors = (type: unknown): PinColors => TYPE_COLORS[String(type || '').trim().toLowerCase()] || NO_TYPE_COLOR;

/** The six types customers can be given (Add customer's list) — always offered in the filter, with or without customers. */
export const KNOWN_TYPES = ['Fabricator', 'Contractor', 'Dealer', 'Floor Covering', 'Designer', 'Builder'];

/** A customer who said no: its pin is drawn faded so it doesn't compete with live ones. */
export const isNotInterested = (pin: { status?: string } | null | undefined) => pin?.status === 'Not Interested';

/** What the pins' colour means: the customer's type, or how long since the last visit. */
export const PIN_COLOR_MODES: string[] = ['type', 'visit'];

export const FALLBACK_CENTER: LatLng = { lat: 47.6062, lng: -122.3321 };

// The one pin whose detail panel (.rpv2-panel[data-dialog="customer"]) is
// currently open — a warm coral, fixed regardless of theme/recency for the
// same reason LEAD_PIN_COLOR below is: it has to read as its own state
// against every recency color and against the origin's blue, not blend into
// whichever one the pin would otherwise be wearing.
export const OPEN_PIN_COLOR = '#e2543f';

export const pad = (n: number | string) => String(n).padStart(2, '0');

export const todayKey = (d: Date = new Date()) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'Aug 19' from a stored 'YYYY-MM-DD'. */
export const friendlyDate = (dateStr: string) => {
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** 'Wed 19 Aug, 09:00' from a stored 'YYYY-MM-DDTHH:mm:ss.000'. */
export const whenLabel = (startTime: string) => {
    const d = new Date(startTime);
    if (Number.isNaN(d.getTime())) return String(startTime).slice(0, 10);
    return d.toLocaleString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
};

/** A month's calendar cells for SchedulePanel: one entry per grid square,
 * `null` for the blanks before the 1st (so every week column stays aligned
 * to its weekday, Sunday-first), a real Date for every day of the month. */
export const buildMonthGrid = (monthDate: Date): (Date | null)[] => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startWeekday; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
    return cells;
};

export const real = (value: unknown) => (isFillerName(value) ? '' : String(value).trim());

export const nameOf = (pin: { company?: unknown; contactName?: unknown }) => real(pin.company) || real(pin.contactName) || 'Unknown';

/** The customer a schedule entry is for: populated to a name (GET /api/schedule), or only an id. */
export const customerOf = (row: ScheduleRow) => (typeof row.customerId === 'object' && row.customerId ? row.customerId : null);

export { isPlaceholderEmail };

/** CustomersPanel's directory search: name/city/sales-rep substring match,
 * name-starts-with ranked ahead of a mid-string hit (so typing "sea" surfaces
 * "Seattle Stone Co" above "Northwest Seating"), alphabetical after that. An
 * empty query returns every pin, alphabetically — same shape either way, so
 * the panel doesn't need a separate "browse all" branch from "search". */
type Searchable = { company?: unknown; contactName?: unknown; city?: unknown; salesRepName?: unknown };
export const searchCustomerPins = <T extends Searchable>(pins: T[], query = ''): T[] => {
    const q = query.trim().toLowerCase();
    const matches = q
        ? pins.filter(p => {
            const name = nameOf(p).toLowerCase();
            const city = real(p.city).toLowerCase();
            const rep = real(p.salesRepName).toLowerCase();
            return name.includes(q) || city.includes(q) || rep.includes(q);
        })
        : pins;
    return matches.slice().sort((a, b) => {
        const an = nameOf(a).toLowerCase();
        const bn = nameOf(b).toLowerCase();
        if (q) {
            const aStarts = an.startsWith(q) ? 0 : 1;
            const bStarts = bn.startsWith(q) ? 0 : 1;
            if (aStarts !== bStarts) return aStarts - bStarts;
        }
        return an.localeCompare(bn);
    });
};

// ── lead generation (search-this-area → save as a Customer) ────────────────

// Fixed regardless of theme, like the "you are here" origin marker — a
// prospect pin needs to read as its own thing against every recency color
// (reds/oranges/grays) and against the origin's blue, not shift with theme.
export const LEAD_PIN_COLOR = '#2e9e6c';

/** Google's new Places API returns addressComponents as {longText, shortText,
 * types[]} (camelCase, unlike the legacy long_name/short_name shape) — pulled
 * apart into the street/city/state/zipCode shape Customer.address expects. */
type AddressComponent = { longText?: string; shortText?: string; types?: string[] };
export const parseAddressComponents = (components: AddressComponent[] = []): Lead['addressParts'] => {
    const find = (type: string) => components.find(c => c.types?.includes(type));
    const streetNumber = find('street_number')?.longText || '';
    const route = find('route')?.longText || '';
    return {
        street: [streetNumber, route].filter(Boolean).join(' '),
        city: find('locality')?.longText || find('postal_town')?.longText || '',
        state: find('administrative_area_level_1')?.shortText || '',
        zipCode: find('postal_code')?.longText || ''
    };
};

const LEAD_SEARCH_KEY = 'rpv2LeadSearches';
const LEAD_SEARCH_LIMIT = 8;

const readLeadSearches = (): string[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(LEAD_SEARCH_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeLeadSearches = (list: string[]) => {
    try { localStorage.setItem(LEAD_SEARCH_KEY, JSON.stringify(list)); } catch { /* private mode — recents just don't persist */ }
};

export const loadRecentLeadSearches = () => readLeadSearches();

/** Returns the updated list so the caller can setState directly. */
export const saveRecentLeadSearch = (term: string) => {
    const clean = term.trim();
    if (!clean) return readLeadSearches();
    const next = [clean, ...readLeadSearches().filter(t => t.toLowerCase() !== clean.toLowerCase())].slice(0, LEAD_SEARCH_LIMIT);
    writeLeadSearches(next);
    return next;
};

export const removeRecentLeadSearch = (term: string) => {
    const next = readLeadSearches().filter(t => t !== term);
    writeLeadSearches(next);
    return next;
};
