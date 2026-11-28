// The phone's "Find new leads" rules: when a search is allowed, how found leads are
// numbered and described, and when the map has moved far enough to offer a new search.
// Plain functions, no Maps library, so they are tested without a map.
import { milesBetween } from '../../../utils/routePlan';
import type { LatLng, Lead } from '../types';

/** A search covers what is on the map and returns at most 20 places, so a map wider than a town leaves the best ones out. */
export const MIN_LEAD_ZOOM = 11;
/** What the Zoom in button zooms to: a few miles across on a phone. */
export const ZOOM_IN_TO = 13;

/** One step wider for "Zoom out and search again", never past what a search allows. */
export const zoomOutTarget = (zoom: number): number => Math.max(MIN_LEAD_ZOOM, Math.round(zoom) - 1);
/** False once the map is as wide as a search goes: zooming out further would only ask to zoom back in. */
export const canZoomOut = (zoom: number | null | undefined): boolean => typeof zoom !== 'number' || Math.round(zoom) > MIN_LEAD_ZOOM;

export const tooFarOut = (zoom: number | null | undefined): boolean => typeof zoom === 'number' && zoom < MIN_LEAD_ZOOM;

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
