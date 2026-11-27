// Which found leads sit inside the Radius circle or Lasso outline the Tools panel
// last drew — the "Leads in area" list. Plain geometry, no Maps library (the same
// rule customers are swept with in useDayPlan).
import { milesBetween, pointInPolygon } from '../../utils/routePlan';
import type { Lead, SelectionShape } from './types';

const METERS_PER_MILE = 1609.34;
const METERS_PER_DEGREE_LAT = 111_320;

/** Whether one point is inside the drawn shape. */
export const insideShape = (point: Lead['coordinates'], shape: SelectionShape): boolean =>
    shape.type === 'radius'
        ? milesBetween(point, shape.center) <= shape.radiusMeters / METERS_PER_MILE
        : pointInPolygon(point, shape.path);

/** The leads inside the shape, A–Z. Nothing is "inside" when no shape has been drawn. */
export const leadsInShape = (leads: Lead[], shape: SelectionShape | null): Lead[] => {
    if (!shape) return [];
    return leads
        .filter(lead => lead.coordinates && insideShape(lead.coordinates, shape))
        .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * The smallest box around the shape. Places can only be asked for by rectangle,
 * so a search in a circle or outline asks for this box and keeps what's inside.
 */
export const shapeBounds = (shape: SelectionShape): { north: number; south: number; east: number; west: number } => {
    if (shape.type === 'radius') {
        const dLat = shape.radiusMeters / METERS_PER_DEGREE_LAT;
        const dLng = dLat / Math.max(0.01, Math.cos((shape.center.lat * Math.PI) / 180));
        return {
            north: shape.center.lat + dLat, south: shape.center.lat - dLat,
            east: shape.center.lng + dLng, west: shape.center.lng - dLng
        };
    }
    const lats = shape.path.map(p => p.lat);
    const lngs = shape.path.map(p => p.lng);
    return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) };
};
