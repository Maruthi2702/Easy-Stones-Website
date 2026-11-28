import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { milesBetween } from '../../../utils/routePlan';
import type { useLeadSearch } from '../useLeadSearch';
import type { LatLng, Lead } from '../types';
import { areaWords, boxAround, mapMoved, orderByDistance, SEARCH_STEPS, searchAreaFor, widerStep } from './leadsPhoneRules';
import type { Box } from './leadsPhoneRules';
import type { MapView, NumberedLead } from './leadsPhoneRules';

/** What the sheet is saying: nothing yet, the leads, none found, or the search failed. */
export type LeadsPhase = 'typing' | 'results' | 'empty' | 'error';

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

/** The longest the map is waited for after Search wider fits it to the new area. */
const FIT_WAIT_MS = 1500;
/** Room left for the search bar above and the sheet below when the map is fitted. */
const FIT_PADDING = { top: 90, bottom: 270, left: 24, right: 24 };

/** Fits the map to `box` and answers once it has settled (or after a moment). */
const fitTo = (map: google.maps.Map, box: Box): Promise<void> => new Promise((resolve) => {
    if (typeof map.fitBounds !== 'function' || typeof map.addListener !== 'function') { resolve(); return; }
    let done = false;
    let listener: google.maps.MapsEventListener | undefined;
    const finish = () => { if (done) return; done = true; listener?.remove?.(); clearTimeout(timer); resolve(); };
    const timer = setTimeout(finish, FIT_WAIT_MS);
    listener = map.addListener('idle', finish);
    map.fitBounds(box, FIT_PADDING);
});

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
    // How wide the map is now, and where the last search looked.
    const [mapMiles, setMapMiles] = useState(0);
    const [searched, setSearched] = useState<{ miles: number; onScreen: boolean } | null>(null);
    const [moved, setMoved] = useState(false);
    // A later search wins: an answer for an older one is dropped.
    const seq = useRef(0);

    // Follow the map while the search is open: how wide it is, has it moved since the search ran.
    useEffect(() => {
        const map = mapRef.current;
        if (!open || !map || typeof map.addListener !== 'function') return undefined;
        const check = () => {
            const view = viewOf(map);
            if (!view) return;
            setMapMiles(view.widthMiles);
            setMoved(searchedAt ? mapMoved(view, searchedAt) : false);
        };
        check();
        const listener = map.addListener('idle', check);
        return () => listener?.remove?.();
    }, [open, mapRef, searchedAt]);

    // `widerMiles`: Search wider — fit the map to that many miles around its centre and look there.
    const run = useCallback(async (term?: string, widerMiles?: number) => {
        const q = (term ?? leads.leadQuery).trim();
        if (!q) return;
        if (term !== undefined) leads.setLeadQuery(term);
        const mine = ++seq.current;
        const map = mapRef.current;
        setSelectedId(null);
        setExpanded(false);
        let view = map ? viewOf(map) : null;
        let box: Box | null = null;
        let miles = 0;
        let onScreen = true;
        if (view && widerMiles) {
            box = boxAround(view.center, widerMiles);
            miles = widerMiles;
            onScreen = false;
            await fitTo(map as google.maps.Map, box);
            if (mine !== seq.current) return;
            view = viewOf(map as google.maps.Map) ?? view;
        } else if (view) {
            const area = searchAreaFor(view);
            box = area.box;
            miles = area.miles;
            onScreen = !area.box;
        }
        const found = await leads.searchLeads(q, null, box ?? undefined);
        if (mine !== seq.current) return;
        if (!found) { setPhase('error'); return; }
        const centre: LatLng | undefined = view?.center ?? found[0]?.coordinates;
        setResults(centre ? orderByDistance(found, centre) : []);
        setSavedIds(new Set());
        setSearched({ miles, onScreen });
        setSearchedAt(view ? { ...view, widthMiles: Math.min(view.widthMiles, miles || view.widthMiles) } : null);
        setMoved(false);
        setPhase(found.length ? 'results' : 'empty');
    }, [leads, mapRef]);

    const nextStep = searched && searched.miles > 0 ? widerStep(searched.miles) : null;
    const wider = useCallback(() => { if (nextStep) void run(leads.leadQuery, nextStep); }, [nextStep, run, leads.leadQuery]);

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
        setSearched(null);
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
        setSearched(null);
        setMoved(false);
        leads.clearLeadResults();
    }, [leads]);

    const pins: LeadPinsView = useMemo(() => ({
        numberOf: new Map(results.map((r) => [r.lead.placeId, r.n])),
        selectedId,
        hiddenIds: savedIds
    }), [results, selectedId, savedIds]);

    const selected = useMemo(() => results.find((r) => r.lead.placeId === selectedId) ?? null, [results, selectedId]);

    // What the search bar's panel says it will search: the screen, or the capped box around the centre.
    const capped = mapMiles > SEARCH_STEPS[0];
    const areaText = searched ? areaWords(searched.onScreen, searched.miles) : '';

    return {
        open, phase, results, selected, savedIds, expanded, setExpanded, moved, capped, areaText, nextStep, pins,
        begin, close, run, wider, selectLead, backToList, save
    };
}

export type LeadsPhoneState = ReturnType<typeof useLeadsPhone>;
