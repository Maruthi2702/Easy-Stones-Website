import { useEffect } from 'react';

/** The width up to which a profile ⋯ menu is a bottom sheet (CustomerProfile.css). */
export const SHEET_MAX_WIDTH = 640;
export const isSheetScreen = () => window.innerWidth <= SHEET_MAX_WIDTH;

/** A portaled sheet is outside its button's wrapper, so Esc (and its scrim) close it instead of click-outside. */
export function useSheetEscape(open: boolean, sheet: boolean, close: () => void) {
    useEffect(() => {
        if (!open || !sheet) return undefined;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [open, sheet, close]);
}
