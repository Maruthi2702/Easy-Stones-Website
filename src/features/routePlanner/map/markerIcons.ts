import { useCallback, useRef } from 'react';
import { RECENCY_DARK_TEXT, LEAD_PIN_COLOR, OPEN_PIN_COLOR, typeColors } from '../helpers';
import type { PinColors } from '../helpers';
import type { ColorMode, MapPin as Customer, RecencyColors } from '../types';

// A classic map-pin silhouette (rounded head, pointed tail) in a 24x24
// viewBox — the head spans x:[5,19] y:[2,16], the tip sits at (12,22). Used
// only for the currently-selected route stops, matching Badger Maps'
// numbered pin look for "this is where I'm going"; everything else stays a
// plain dot, as it was before.
export const PIN_PATH = 'M12,2C8.13,2,5,5.13,5,9c0,5.25,7,13,7,13s7,-7.75,7,-13C19,5.13,15.87,2,12,2z';

// The stop number used to be a separate google.maps.Marker `label` overlaid
// on top of this icon — two independently-rendered layers (a rasterized SVG
// image underneath, a DOM text node on top) that don't always align or
// anti-alias cleanly at this size, which is why bigger/smaller font sizes
// alone never made it crisp. Baking the digits into the SVG itself as real
// vector `<text>` (see markerIcon below) makes them one image, rendered by
// one engine, so they scale and align exactly like the pin shape does.
// Sized in the 24-unit viewBox, not CSS pixels — the head is ~14 units wide
// (x:[5,19]), so this keeps two- and three-digit stops from overflowing it.
export const stopNumberFontSize = (order: number) => {
    const digits = String(order).length;
    if (digits >= 3) return 5.5;
    if (digits === 2) return 8;
    return 10;
};

// Lead-search results: same map-pin silhouette as a route stop, but a fixed
// teal (LEAD_PIN_COLOR, theme-independent) so a prospect never reads as an
// existing customer's recency colour or the blue "you are here" origin dot.
// Same fixed dark ring as every other pin now uses (see markerIcon's `ring`
// below) rather than a white one, so it doesn't stand out as a leftover
// from before that convention changed.
export const leadMarkerIcon = (): google.maps.Icon | undefined => {
    if (!window.google) return undefined;
    const size = 30;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
        `<path d="${PIN_PATH}" fill="${LEAD_PIN_COLOR}" stroke="#20201f" stroke-width="1.4"/>` +
        `</svg>`;
    return {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
        scaledSize: new window.google.maps.Size(size, size),
        anchor: new window.google.maps.Point(size / 2, size * (22 / 24))
    };
};

// The fill and number colour a pin wears: its customer type, or how long since
// the last visit, per the Filter's "colour pins by" switch.
export const pinLook = (colors: RecencyColors, colorMode: ColorMode, pin: Customer): PinColors => {
    if (colorMode === 'type') return typeColors(pin.customerType);
    return { color: colors[pin.recency.key], ink: RECENCY_DARK_TEXT.has(pin.recency.key) ? '#141414' : '#ffffff' };
};

const PIN_SIZE = 24;       // every customer
const OPEN_SIZE = 38;      // the one whose panel is open
const STOP_SIZE = 44;      // a numbered route stop — large enough to read the number

const svgIcon = (svg: string, size: number): google.maps.Icon => ({
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(size, size),
    // The tip (12,22 in the 24-unit viewBox) is the coordinate being marked,
    // not the icon's centre.
    anchor: new window.google.maps.Point(size / 2, size * (22 / 24))
});

// Builds one pin's icon (cached by markerIcon in MapCanvas). Every customer is
// a map pin in the type or visit colour; a route stop is the same pin, larger,
// with a white outline and its number; the open customer is coral with a ring.
export const buildMarkerIcon = ({ color, ink }: PinColors, order: number | undefined, isOpen: boolean) => {
    const ring = '#20201f';

    // The one pin whose detail panel is open — a fixed coral fill and a hollow
    // ring instead of a stop number, so it reads as "the one you have open"
    // whatever colour or stop number it would otherwise wear. Closing the
    // panel falls straight through to the cases below.
    if (isOpen) {
        return svgIcon(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${OPEN_SIZE}" height="${OPEN_SIZE}" viewBox="0 0 24 24">` +
            `<path d="${PIN_PATH}" fill="${OPEN_PIN_COLOR}" stroke="${ring}" stroke-width="1.4"/>` +
            `<circle cx="12" cy="9" r="3.3" fill="none" stroke="#ffffff" stroke-width="1.8"/>` +
            `</svg>`, OPEN_SIZE);
    }

    if (!order) {
        return svgIcon(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_SIZE}" height="${PIN_SIZE}" viewBox="0 0 24 24">` +
            `<path d="${PIN_PATH}" fill="${color}" stroke="${ring}" stroke-width="1.6"/>` +
            `<circle cx="12" cy="9" r="2.6" fill="${ring}" fill-opacity="0.45"/>` +
            `</svg>`, PIN_SIZE);
    }

    // The order number is real SVG text in the same image as the pin (see
    // stopNumberFontSize for why not a Marker `label`). (12, 9) is the round
    // head's centre in the 24-unit viewBox.
    return svgIcon(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${STOP_SIZE}" height="${STOP_SIZE}" viewBox="0 0 24 24">` +
        `<path d="${PIN_PATH}" fill="${color}" stroke="#ffffff" stroke-width="2.2"/>` +
        `<path d="${PIN_PATH}" fill="none" stroke="${ring}" stroke-width="0.9"/>` +
        `<text x="12" y="9" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="Arial, Helvetica, sans-serif" font-size="${stopNumberFontSize(order)}" ` +
        `font-weight="700" fill="${ink}">${order}</text>` +
        `</svg>`, STOP_SIZE);
};

// Builds this pin's icon. Stable across renders unless colors/theme
// actually change, so the clustering effect below can depend on it
// without re-running (and rebuilding every marker) on every unrelated
// render.
//
// Only route stops (currently selected, numbered by order) get the
// map-pin silhouette — everything unselected goes back to the plain dot
// it used to be. A gold ring was tried on the pin to mark it as "on
// your plan" but didn't read well against the recency fill, so every
// pin/dot now gets the same ring regardless of type.
//
// That ring is always dark now rather than flipping white-on-dark-theme
// — the thing it has to contrast against is the map underneath it,
// which doesn't change with the app's theme, and a dark outline is what
// gives an icon its "printed, deliberate" look on a map (see how every
// pin in the Badger Maps reference has one, regardless of anything else
// about the app around it).
// Icons are cached per look (fill × number colour × stop number × open): the
// same object every render, so Google isn't told "new icon" for every pin
// each time anything changes. Keyed by the look itself, so a theme or
// colour-mode change needs no invalidation.
export function usePinIcons(colors: RecencyColors, colorMode: ColorMode) {
    const iconCache = useRef(new Map<string, google.maps.Icon>());
    return useCallback((pin: Customer, order: number | undefined, isOpen = false) => {
        if (!window.google) return undefined;
        const look = pinLook(colors, colorMode, pin);
        const key = `${look.color}|${look.ink}|${order || ''}|${isOpen ? 1 : 0}`;
        const hit = iconCache.current.get(key);
        if (hit) return hit;
        const made = buildMarkerIcon(look, order, isOpen);
        iconCache.current.set(key, made);
        return made;
    }, [colors, colorMode]);
}
