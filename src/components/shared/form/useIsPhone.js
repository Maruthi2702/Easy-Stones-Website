import { useSyncExternalStore } from 'react';

// The form template's phone breakpoint (FORM_TEMPLATE.md, FormModal.css).
export const PHONE_QUERY = '(max-width: 639px)';

const subscribe = (onChange) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mq = window.matchMedia(PHONE_QUERY);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
};
const getSnapshot = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE_QUERY).matches : false);

/** True while the screen is phone-sized — pickers open as bottom sheets then. */
export default function useIsPhone() {
    return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
