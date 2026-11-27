import { useState, useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { parseAddressComponents, loadRecentLeadSearches, saveRecentLeadSearch, removeRecentLeadSearch } from './helpers';
import type { CurrentUser } from '../../types/records';
import { leadsInShape, shapeBounds } from './leadsInShape';
import type { Lead, SelectionShape } from './types';

export type LeadSearchDeps = {
    mapRef: MutableRefObject<google.maps.Map | null>;
    currentUser: CurrentUser | null;
    /** The open lead's panel (usePanels): a new search or a save closes it. */
    setLeadInfo: Dispatch<SetStateAction<Lead | null>>;
    /** Closes the open lead, bringing back the Tools panel if it was opened from there. */
    closeLeadInfo: () => void;
    /** Reloads the map's customers after a lead is saved as one. */
    reload: () => Promise<void>;
};

/**
 * Lead generation — searching the visible map area for businesses not yet in
 * the CRM (see MapCanvas's leadResults markers/panel). Kept entirely separate
 * from the customer pins: these are transient search results, not customer
 * data, until saveLead() turns one into a real Customer.
 */
export function useLeadSearch({ mapRef, currentUser, setLeadInfo, closeLeadInfo, reload }: LeadSearchDeps) {
    const [leadQuery, setLeadQuery] = useState('');
    const [leadResults, setLeadResults] = useState<Lead[]>([]);
    const [leadSearching, setLeadSearching] = useState(false);
    const [leadError, setLeadError] = useState('');
    const [savingLead, setSavingLead] = useState(false);
    const [recentLeadSearches, setRecentLeadSearches] = useState(() => loadRecentLeadSearches());

    // Loads the Places library lazily via importLibrary rather than listing
    // 'places' in the page's useJsApiLoader call — @react-google-maps/api's
    // loader is a page-lifetime singleton keyed by its full options object,
    // so any other screen that ever calls useJsApiLoader with different
    // options would throw ("Loader must not be called again with different
    // options") instead of loading. importLibrary sidesteps that entirely
    // since it never touches the shared loader's own options.
    // `area` is the Radius / Lasso the Tools panel drew: Places can only be asked
    // for a rectangle, so it asks for the shape's box and keeps what's inside.
    // Answers with what it found (null when the search itself failed), so the phone's
    // sheet can say "12 leads", "none" or "couldn't search" without reading state back.
    const searchLeads = useCallback(async (queryText: string, area: SelectionShape | null = null): Promise<Lead[] | null> => {
        if (!mapRef.current || !window.google?.maps) return null;
        const bounds = area ? shapeBounds(area) : mapRef.current.getBounds();
        if (!bounds) {
            setLeadError('The map is still loading — try again in a moment.');
            return null;
        }

        setLeadSearching(true);
        setLeadError('');
        try {
            const { Place } = await window.google.maps.importLibrary('places') as google.maps.PlacesLibrary;
            const { places } = await Place.searchByText({
                textQuery: queryText,
                fields: ['id', 'displayName', 'formattedAddress', 'location', 'internationalPhoneNumber', 'types', 'addressComponents'],
                locationRestriction: bounds,
                maxResultCount: 20
            });
            const found = (places || []).map(p => ({
                placeId: p.id,
                name: p.displayName || 'Unnamed business',
                address: p.formattedAddress || '',
                phone: p.internationalPhoneNumber || '',
                types: p.types || [],
                coordinates: { lat: p.location!.lat(), lng: p.location!.lng() },
                addressParts: parseAddressComponents(p.addressComponents as Parameters<typeof parseAddressComponents>[0])
            }));
            const kept = area ? leadsInShape(found, area) : found;
            setLeadResults(kept);
            setLeadInfo(null);
            setRecentLeadSearches(saveRecentLeadSearch(queryText));
            return kept;
        } catch (err) {
            setLeadError((err as Error).message || 'Could not search this area');
            return null;
        } finally {
            setLeadSearching(false);
        }
    }, [mapRef, setLeadInfo]);

    // `keepInResults`: the phone's list keeps a saved lead, marked Saved, instead of dropping it.
    // Answers whether it was saved.
    const saveLead = async (place: Lead, options: { keepInResults?: boolean } = {}): Promise<boolean> => {
        if (savingLead) return false;
        setSavingLead(true);
        setLeadError('');
        try {
            const parts: Partial<Lead['addressParts']> = place.addressParts || {};
            const res = await authFetch(`${API_URL}/api/customers`, {
                method: 'POST',
                body: JSON.stringify({
                    company: place.name,
                    phone: place.phone,
                    address: {
                        street: parts.street || '',
                        city: parts.city || '',
                        state: parts.state || '',
                        zipCode: parts.zipCode || ''
                    },
                    status: 'New Lead',
                    salesRep: currentUser?.id || currentUser?._id,
                    location: currentUser?.location,
                    coordinates: place.coordinates,
                    precision: 'rooftop'
                })
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message || 'Could not save this lead');
            if (!options.keepInResults) setLeadResults(prev => prev.filter(p => p.placeId !== place.placeId));
            closeLeadInfo();
            await reload();
            return true;
        } catch (err) {
            setLeadError((err as Error).message || 'Could not save this lead');
            return false;
        } finally {
            setSavingLead(false);
        }
    };

    const removeRecent = (term: string) => setRecentLeadSearches(removeRecentLeadSearch(term));
    const clearLeadResults = useCallback(() => { setLeadResults([]); setLeadError(''); }, []);

    return { leadQuery, setLeadQuery, leadResults, leadSearching, leadError, savingLead, recentLeadSearches, searchLeads, saveLead, removeRecent, clearLeadResults };
}
