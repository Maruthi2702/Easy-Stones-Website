// Small pure helpers shared across the routePlannerV2 tree.
import { isFillerName, isPlaceholderEmail } from '../../../utils/customerMatch';

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
export const RECENCY_COLORS = {
    dark: { never: '#c62828', overdue: '#e2711d', due: '#f2b705', recent: '#7a7a75' },
    light: { never: '#c62828', overdue: '#e2711d', due: '#c98a00', recent: '#7a7a75' }
};

// Buckets whose fill is bright enough that white label/chip text loses too
// much contrast — these need dark ink instead.
export const RECENCY_DARK_TEXT = new Set(['overdue', 'due']);

export const FALLBACK_CENTER = { lat: 47.6062, lng: -122.3321 };

export const pad = (n) => String(n).padStart(2, '0');

export const todayKey = (d = new Date()) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'Aug 19' from a stored 'YYYY-MM-DD'. */
export const friendlyDate = (dateStr) => {
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** 'Wed 19 Aug, 09:00' from a stored 'YYYY-MM-DDTHH:mm:ss.000'. */
export const whenLabel = (startTime) => {
    const d = new Date(startTime);
    if (Number.isNaN(d.getTime())) return String(startTime).slice(0, 10);
    return d.toLocaleString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
};

export const real = (value) => (isFillerName(value) ? '' : String(value).trim());

export const nameOf = (pin) => real(pin.company) || real(pin.contactName) || 'Unknown';

export { isPlaceholderEmail };

// ── lead generation (search-this-area → save as a Customer) ────────────────

// Fixed regardless of theme, like the "you are here" origin marker — a
// prospect pin needs to read as its own thing against every recency color
// (reds/oranges/grays) and against the origin's blue, not shift with theme.
export const LEAD_PIN_COLOR = '#2e9e6c';

/** Google's new Places API returns addressComponents as {longText, shortText,
 * types[]} (camelCase, unlike the legacy long_name/short_name shape) — pulled
 * apart into the street/city/state/zipCode shape Customer.address expects. */
export const parseAddressComponents = (components = []) => {
    const find = (type) => components.find(c => c.types?.includes(type));
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

const readLeadSearches = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(LEAD_SEARCH_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeLeadSearches = (list) => {
    try { localStorage.setItem(LEAD_SEARCH_KEY, JSON.stringify(list)); } catch { /* private mode — recents just don't persist */ }
};

export const loadRecentLeadSearches = () => readLeadSearches();

/** Returns the updated list so the caller can setState directly. */
export const saveRecentLeadSearch = (term) => {
    const clean = term.trim();
    if (!clean) return readLeadSearches();
    const next = [clean, ...readLeadSearches().filter(t => t.toLowerCase() !== clean.toLowerCase())].slice(0, LEAD_SEARCH_LIMIT);
    writeLeadSearches(next);
    return next;
};

export const removeRecentLeadSearch = (term) => {
    const next = readLeadSearches().filter(t => t !== term);
    writeLeadSearches(next);
    return next;
};
