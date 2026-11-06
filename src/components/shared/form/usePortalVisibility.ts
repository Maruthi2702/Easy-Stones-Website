import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Activity disconnects a hidden page's effects, but a portal can live outside
 * the DOM ancestor React hides. Hide that portal on disconnect and restore it
 * on return, preserving form state without covering a different page.
 */
export function usePortalVisibility<T extends HTMLElement>(ref: RefObject<T | null>, enabled = true) {
    useLayoutEffect(() => {
        const element = ref.current;
        if (!enabled || !element) return;
        element.style.removeProperty('display');
        return () => { element.style.setProperty('display', 'none', 'important'); };
    }, [ref, enabled]);
}
