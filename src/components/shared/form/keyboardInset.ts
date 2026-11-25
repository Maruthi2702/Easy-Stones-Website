/**
 * How much of a phone's screen the keyboard covers, and how tall the form should be, from what the browser or the app reports.
 * Pure so the rules can be tested (FormModal writes the answer to CSS variables).
 *
 *  - In a phone browser the page's visual viewport shrinks for the keyboard (`innerHeight` doesn't), so the keyboard is the gap
 *    between the two and the form is as tall as the visual viewport.
 *  - In the app the web view is never resized: `innerHeight` stays the whole screen, and the keyboard's height comes from the
 *    phone (`--native-kb`, NativeKeyboard). The web view may also shrink its visual viewport for the keyboard (the React Native
 *    WebView does; the old Capacitor one didn't), so the larger of the two is the keyboard — and the form is the screen
 *    minus it either way. (Until 2026-11-24 a shrunk visual viewport left the form full height, its lower half under the keyboard.)
 *  - Pinch-zoom shrinks the visual viewport too; a zoomed page never counts as a keyboard.
 */
export type ViewportReading = {
    innerHeight: number;
    vvHeight: number;
    vvOffsetTop: number;
    vvScale: number;
    /** `--native-kb`: the keyboard height the phone reported; 0 when none. */
    nativeKb: number;
    /** Capacitor.isNativePlatform() — the app, not a browser. */
    native: boolean;
};

export function phoneViewportFor(r: ViewportReading): { kb: number; viewHeight: number } {
    const zoomed = r.vvScale > 1.01;
    const browserKb = zoomed ? 0 : Math.max(0, Math.round(r.innerHeight - r.vvOffsetTop - r.vvHeight));
    const kb = Math.max(browserKb, r.nativeKb);
    const viewHeight = r.native
        ? r.innerHeight - kb
        : r.vvHeight - (browserKb ? 0 : r.nativeKb);
    return { kb, viewHeight: Math.max(0, viewHeight) };
}
