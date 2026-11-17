import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { streetOf, cityLineOf } from '../../utils/customerList';
import type { Loose } from '../../types/records';

/** Google Maps directions to the customer's stored point, else to its address; '' when it has neither. */
export const directionsUrlFor = (customer: Loose = {}): string => {
    const lat = customer.coordinates?.lat;
    const lng = customer.coordinates?.lng;
    const destination = Number.isFinite(lat) && Number.isFinite(lng)
        ? `${lat},${lng}`
        : [streetOf(customer), cityLineOf(customer)].filter(Boolean).join(', ');
    return destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` : '';
};

export type DirectionsResult = 'opened' | 'no-address' | 'failed';

/**
 * Directions to a stop's customer. A stop carries only the customer's name, so the
 * record is read when asked. The tab is opened first, inside the tap, so a phone's
 * pop-up blocker lets it through; it is pointed at the map once the address is known.
 */
export async function openDirections(customerId: string): Promise<DirectionsResult> {
    const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    try {
        const response = await authFetch(`${API_URL}/api/customers/${customerId}`);
        if (!response.ok) { tab?.close(); return 'failed'; }
        const url = directionsUrlFor(await response.json());
        if (!url) { tab?.close(); return 'no-address'; }
        if (tab) { tab.opener = null; tab.location.href = url; }
        else window.open(url, '_blank', 'noopener,noreferrer');
        return 'opened';
    } catch {
        tab?.close();
        return 'failed';
    }
}
