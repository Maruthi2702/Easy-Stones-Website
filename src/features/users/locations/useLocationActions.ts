import { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { hasPrintableAddress } from '../../../utils/locationForm';
import type { AdminLocation } from '../types';

/**
 * Users & Roles → Locations: which location the Add / Edit form shows, the
 * saved / deleted / failed message (gone after 5 seconds), delete with its
 * confirm, and the branches still printing the Kent address.
 */
export function useLocationActions(locations: AdminLocation[], fetchLocations?: () => void) {
    // Add / Edit location form: null (closed), 'new', or the location being edited.
    const [locationForm, setLocationForm] = useState<AdminLocation | 'new' | null>(null);
    const [locationError, setLocationError] = useState('');
    const [locationSuccess, setLocationSuccess] = useState('');

    useEffect(() => {
        if (locationSuccess || locationError) {
            const t = setTimeout(() => {
                setLocationSuccess('');
                setLocationError('');
            }, 5000);
            return () => clearTimeout(t);
        }
    }, [locationSuccess, locationError]);

    const locationSaved = (saved: AdminLocation, wasNew: boolean) => {
        setLocationError('');
        setLocationSuccess(wasNew ? `${saved.fullName || saved.name} added.` : `${saved.fullName || saved.name} saved.`);
        if (fetchLocations) fetchLocations();
    };

    // From the row's trash button and the edit form's "Delete location".
    // Resolves true when it was deleted, so the form knows to close.
    const deleteLocation = async (loc: AdminLocation): Promise<boolean> => {
        if (!window.confirm(`Delete ${loc.fullName || loc.name}? Users assigned to this location might lose access.`)) return false;

        try {
            const res = await authFetch(`${API_URL}/api/admin/locations/${loc._id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                setLocationSuccess('Location deleted successfully!');
                if (fetchLocations) fetchLocations();
                return true;
            }
            const data = await res.json().catch(() => ({}));
            setLocationError(data.message || 'Failed to delete location');
        } catch (err) {
            console.error('Error deleting location:', err);
            setLocationError('Network error. Failed to delete location.');
        }
        return false;
    };

    // Branches whose selection sheets still print the Kent address.
    const locationsMissingAddress = useMemo(
        () => (Array.isArray(locations) ? locations : []).filter((l) => l && typeof l === 'object' && !hasPrintableAddress(l)),
        [locations]
    );

    return { locationForm, setLocationForm, locationError, locationSuccess, locationSaved, deleteLocation, locationsMissingAddress };
}

export type LocationActions = ReturnType<typeof useLocationActions>;
