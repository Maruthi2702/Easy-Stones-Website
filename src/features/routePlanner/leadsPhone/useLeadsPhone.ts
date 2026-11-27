import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { milesBetween } from '../../../utils/routePlan';
import type { useLeadSearch } from '../useLeadSearch';
import type { LatLng, Lead } from '../types';
import { mapMoved, orderByDistance, tooFarOut, ZOOM_IN_TO } from './leadsPhoneRules';
import type { MapView, NumberedLead } from './leadsPhoneRules';

/** What the sheet is saying: nothing yet, the leads, none found, the map is too wide, or the search failed. */
export type LeadsPhase = 'typing' | 'results' | 'empty' | 'zoom' | 'error';

/** What MapCanvas needs to draw the phone's results: numbers, the open one, and the saved ones (now customers). */
export type LeadPinsView = { numberOf: Map<string, number>; selectedId: string | null; hiddenIds: Set<string> };

type LeadSearchApi = ReturnType<typeof useLeadSearch>;

/** How far a pin is moved up from the map's centre so it sits above the sheet. */
const ABOVE_SHEET_PX = 150;

const viewOf = (map: google.maps.Map): MapView | null => {
    const c = map.getCenter?.();
    const zoom = map.getZoom?.();
    if (!c || typeof zoom !== 'number') return null;
    const center = { lat: c.lat(), lng: c.lng() };
    const b = map.getBounds?.();
    const widthMiles = b
        ? milesBetween({ lat: center.lat, lng: b.getSouthWest().lng() }, { lat: center.lat, lng: b.getNorthEast().lng() })
        : Infinity;
    return { center, zoom, widthMiles };
};

/**
 * The phone's "Find new leads" (Route Planner → ⋯ → Find new leads): a search bar at the top
 * of the screen and a sheet of results at the bottom, instead of an input inside the menu where
 * the keyboard covered it. It runs the page's one lead search (useLeadSearch) over what the map
 * shows, and keeps its own list: numbered nearest-first, a saved lead stays on it, marked Saved.
 * Design: claude.ai artifact "Find new leads on a phone"
 * (https://claude.ai/artifact/4cQPkTME848RD4sULAAdQC).
 */
export function useLeadsPhone({ mapRef, leads }: { mapRef: MutableRefObject<google.maps.Map | null>; leads: LeadSearchApi }) {
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState<LeadsPhase>('typing');
    const [results, setResults] = useState<NumberedLead[]>([]);
    const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [searchedAt, setSearchedAt] = useState<MapView | null>(null);
    const [zoomedOut, setZoomedOut] = useState(false);
    const [moved, setMoved] = useState(false);
    // A later search wins: an answer for an older one is dropped.
    const seq = useRef(0);

    // Follow the map while the search is open: is it too wide to search, has it moved since the search ran.
    useEffect(() => {
        const map = mapRef.current;
        if (!open || !map || typeof map.addListener !== 'function') return undefined;
        const check = () => {
            const view = viewOf(map);
            if (!view) return;
            setZoomedOut(tooFarOut(view.zoom));
            setMoved(searchedAt ? mapMoved(view, searchedAt) : false);
        };
        check();
        const listener = map.addListener('idle', check);
        return () => listener?.remove?.();
    }, [open, mapRef, searchedAt]);

    const run = useCallback(async (term?: string) => {
        const q = (term ?? leads.leadQuery).trim();
        if (!q) return;
        if (term !== undefined) leads.setLeadQuery(term);
        const mine = ++seq.current;
        const map = mapRef.current;
        const view = map ? viewOf(map) : null;
        setSelectedId(null);
        setExpanded(false);
        if (view && tooFarOut(view.zoom)) { setResults([]); setSearchedAt(null); setPhase('zoom'); return; }
        const found = await leads.searchLeads(q);
        if (mine !== seq.current) return;
        if (!found) { setPhase('error'); return; }
        const centre: LatLng | undefined = view?.center ?? found[0]?.coordinates;
        setResults(centre ? orderByDistance(found, centre) : []);
        setSavedIds(new Set());
        setSearchedAt(view);
        setMoved(false);
        setPhase(found.length ? 'results' : 'empty');
    }, [leads, mapRef]);

    // Zoom the map, then run the search once it has settled.
    const zoomThenSearch = useCallback((zoom: number) => {
        const map = mapRef.current;
        const q = leads.leadQuery.trim();
        if (!map) return;
        map.setZoom(zoom);
        if (q && window.google?.maps?.event?.addListenerOnce) {
            window.google.maps.event.addListenerOnce(map, 'idle', () => { void run(q); });
        }
    }, [leads.leadQuery, mapRef, run]);

    const zoomIn = useCallback(() => zoomThenSearch(ZOOM_IN_TO), [zoomThenSearch]);
    const zoomOut = useCallback(() => zoomThenSearch(Math.max(1, (mapRef.current?.getZoom?.() ?? ZOOM_IN_TO) - 1)), [zoomThenSearch, mapRef]);

    const selectLead = useCallback((placeId: string) => {
        const row = results.find((r) => r.lead.placeId === placeId);
        if (!row) return;
        setSelectedId(placeId);
        const map = mapRef.current;
        map?.setCenter?.(row.lead.coordinates);
        map?.panBy?.(0, ABOVE_SHEET_PX);
    }, [results, mapRef]);

    const backToList = useCallback(() => setSelectedId(null), []);

    const save = useCallback(async (lead: Lead) => {
        const ok = await leads.saveLead(lead, { keepInResults: true });
        if (ok) setSavedIds((prev) => new Set(prev).add(lead.placeId));
    }, [leads]);

    const begin = useCallback(() => {
        seq.current += 1;
        setOpen(true);
        setPhase('typing');
        setResults([]);
        setSelectedId(null);
        setExpanded(false);
        setSearchedAt(null);
        setMoved(false);
    }, []);

    const close = useCallback(() => {
        seq.current += 1;
        setOpen(false);
        setPhase('typing');
        setResults([]);
        setSavedIds(new Set());
        setSelectedId(null);
        setExpanded(false);
        setSearchedAt(null);
        setMoved(false);
        leads.clearLeadResults();
    }, [leads]);

    const pins: LeadPinsView = useMemo(() => ({
        numberOf: new Map(results.map((r) => [r.lead.placeId, r.n])),
        selectedId,
        hiddenIds: savedIds
    }), [results, selectedId, savedIds]);

    const selected = useMemo(() => results.find((r) => r.lead.placeId === selectedId) ?? null, [results, selectedId]);

    return {
        open, phase, results, selected, savedIds, expanded, setExpanded, moved, zoomedOut, pins,
        begin, close, run, zoomIn, zoomOut, selectLead, backToList, save
    };
}

export type LeadsPhoneState = ReturnType<typeof useLeadsPhone>;
