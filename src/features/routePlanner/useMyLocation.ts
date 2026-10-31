import { useState, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { readLastPosition, rememberPosition, forgetLocationOk, locationWasOk, locationPermission, shouldAutoLocate } from '../../utils/geolocationAccess';
import { milesBetween } from '../../utils/routePlan';
import type { LatLng } from './types';

export type MyLocationDeps = {
    mapRef: MutableRefObject<google.maps.Map | null>;
    /** This page is the one on screen (the GPS is only read while it is). */
    isActive: boolean;
    setError: (message: string) => void;
};

/**
 * Where the rep is. Location, without asking on every visit
 * (src/utils/geolocationAccess.js): nothing prompts on its own, the map opens
 * on the last known spot, and only a tap on Locate asks. Once the browser has
 * it allowed (or an earlier fix worked on a browser that can't say) the
 * position is followed quietly.
 */
export function useMyLocation({ mapRef, isActive, setError }: MyLocationDeps) {
    const [origin, setOrigin] = useState<LatLng | null>(null);
    const [myPosition, setMyPosition] = useState<LatLng | null>(null);

    const [lastKnownPosition] = useState(() => readLastPosition());
    const [autoLocate, setAutoLocate] = useState(false);
    useEffect(() => {
        let gone = false;
        let status: PermissionStatus | null = null;
        (async () => {
            const state = await locationPermission();
            if (gone) return;
            if (shouldAutoLocate(state, locationWasOk())) setAutoLocate(true);
            try {
                // Allowed or switched off in the browser's settings while this is open.
                status = await navigator.permissions.query({ name: 'geolocation' });
                status.onchange = () => setAutoLocate(status!.state === 'granted');
            } catch { /* a browser that can't say: the first branch above decided */ }
        })();
        return () => { gone = true; if (status) status.onchange = null; };
    }, []);

    // The blue "You" dot on the map (see MapCanvas) — kept separate from
    // `origin` on purpose. `origin` anchors route planning/the Directions
    // request above and the map's initial centring, so it only updates once
    // per session (or on an explicit "locate me" click) — a rep panning
    // around to look at other stops shouldn't have the camera yanked back,
    // and the Directions API shouldn't get re-billed every time the phone
    // reports a new fix. This polls for the device's live position instead,
    // purely for display, so the dot itself still moves with the rep while
    // they drive — but only while this screen is the one showing and the tab
    // is visible, so a screen left in the background isn't reading the GPS.
    //
    // Deliberately setInterval + getCurrentPosition rather than
    // watchPosition: this app installs as a PWA (see vite.config.ts), and
    // Mobile Safari has a long-standing bug where watchPosition quietly
    // stops delivering updates after the screen locks or the app
    // backgrounds even briefly in standalone mode — it fires once and then
    // never again until the page is reloaded, which is exactly the "frozen
    // dot" this effect exists to fix. Re-polling on a plain timer sidesteps
    // that instead of depending on it.
    useEffect(() => {
        if (!autoLocate || !isActive || !navigator.geolocation) return undefined;
        const poll = () => {
            if (document.visibilityState === 'hidden') return;
            navigator.geolocation.getCurrentPosition(
                // A fresh object every 15s re-rendered the whole map even when
                // the rep hadn't moved; only a move of ~20 m or more updates it.
                (pos) => {
                    const next: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    rememberPosition(next);
                    setOrigin(prev => prev || next);
                    setMyPosition((prev) => (prev && milesBetween(prev, next) < 0.0125 ? prev : next));
                },
                (err) => {
                    // Refused (code 1): stop trying until Locate is tapped again.
                    if (err?.code === 1) { forgetLocationOk(); setAutoLocate(false); }
                },
                { enableHighAccuracy: true, timeout: 8000 }
            );
        };
        poll();
        const intervalId = setInterval(poll, 15000);
        document.addEventListener('visibilitychange', poll);
        return () => {
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', poll);
        };
    }, [autoLocate, isActive]);

    // Always takes a fresh fix rather than panning to whatever `origin`/
    // `myPosition` already hold — an explicit tap on this button is the rep
    // saying "where am I *right now*", so a cached point (even one only a
    // few seconds stale from the poll above) isn't good enough here.
    const goToMyLocation = () => {
        if (!navigator.geolocation) {
            setError('This browser cannot report a location.');
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const here: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                rememberPosition(here);
                setAutoLocate(true); // allowed now: follow quietly from here on
                setOrigin(here);
                setMyPosition(here);
                if (!mapRef.current) return;
                mapRef.current.panTo(here);
                mapRef.current.setZoom(12);
            },
            () => {
                forgetLocationOk();
                setError('Location is switched off for this site — turn it on in the browser’s site settings.');
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    };

    return { origin, setOrigin, myPosition, lastKnownPosition, goToMyLocation };
}
