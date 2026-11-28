// The phone's "Find new leads" rules: when a search is allowed, how found leads are
// numbered and described, and when the map has moved far enough to offer a new search.
// Plain functions, no Maps library, so they are tested without a map.
import { milesBetween } from '../../../utils/routePlan';
import type { LatLng, Lead } from '../types';

/** What a search may cover, in miles across: Places returns at most 20 places, so a wider area leaves the best ones out. */
export const SEARCH_STEPS = [10, 25, 50];

export type Box = { north: number; south: number; east: number; west: number };

/** A square `miles` across, centred on `center`. */
export const boxAround = (center: LatLng, miles: number): Box => {
    const half = miles / 2;
    const dLat = half / 69;
    const dLng = half / (69 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
    return { north: center.lat + dLat, south: center.lat - dLat, east: center.lng + dLng, west: center.lng - dLng };
};

/** What a search covers: the map on screen when it is no wider than the first step, else that step's box around the centre. */
export const searchAreaFor = (view: { center: LatLng; widthMiles: number }): { miles: number; box: Box | null } => {
    const first = SEARCH_STEPS[0];
    if (Number.isFinite(view.widthMiles) && view.widthMiles <= first) return { miles: view.widthMiles, box: null };
    return { miles: first, box: boxAround(view.center, first) };
};

/** The next step wider than what was searched, or null once it is the widest. */
export const widerStep = (miles: number): number | null => SEARCH_STEPS.find((step) => step > miles + 0.5) ?? null;

/** Under the list: where the search looked. */
export const areaWords = (onScreen: boolean, miles: number): string => (onScreen ? 'this map area' : `${Math.round(miles)} mi around the map centre`);

export type NumberedLead = { lead: Lead; n: number; miles: number };

/** Nearest to the map's centre first, numbered 1, 2, 3… — the numbers the pins wear. */
export const orderByDistance = (leads: Lead[], center: LatLng): NumberedLead[] =>
    leads
        .map((lead) => ({ lead, miles: milesBetween(center, lead.coordinates) }))
        .sort((a, b) => a.miles - b.miles || a.lead.name.localeCompare(b.lead.name))
        .map((row, i) => ({ ...row, n: i + 1 }));

export const milesText = (miles: number): string => {
    if (!Number.isFinite(miles)) return '';
    if (miles < 0.1) return 'Under 0.1 mi';
    return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
};

const GENERIC_TYPES = new Set(['point_of_interest', 'establishment', 'store', 'food', 'health']);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Kitchen supply store": the first type Google gave that says what the place is. */
export const typeText = (lead: Lead): string => {
    const type = (lead.types || []).find((t) => !GENERIC_TYPES.has(t));
    return type ? cap(type.replace(/_/g, ' ')) : '';
};

/** Under a lead's name: "Kitchen remodeler · Seattle · 0.4 mi". */
export const leadLine = (row: NumberedLead): string =>
    [typeText(row.lead), row.lead.addressParts?.city, milesText(row.miles)].filter(Boolean).join(' · ');

export const leadsHeading = (count: number): string => (count === 1 ? '1 lead' : `${count} leads`);

export type MapView = { center: LatLng; zoom: number; widthMiles: number };

/** The map has moved on from where the search ran: a different zoom, or the centre a quarter of the width away. */
export const mapMoved = (now: MapView, at: MapView): boolean =>
    Math.round(now.zoom) !== Math.round(at.zoom) || milesBetween(now.center, at.center) > 0.25 * at.widthMiles;
