/**
 * The side nav's small rules (CustomerSidebar.tsx): the account button's
 * initials, and the pin tip new staff see until they pin a page or tap
 * "Got it" — remembered per device.
 */

/** Two initials from a name; "U" when there is none. */
export const getInitials = (name: string | undefined) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

// New staff: until someone pins a page or taps "Got it", the pin buttons
// show faintly on every page and a short tip explains them. Per device.
export const PIN_TIP_KEY = 'sideNavPinTipDismissed';

export const readPinTipDismissed = () => {
    try {
        return localStorage.getItem(PIN_TIP_KEY) === '1';
    } catch {
        return false;
    }
};

export const savePinTipDismissed = () => {
    try {
        localStorage.setItem(PIN_TIP_KEY, '1');
    } catch {
        // storage unavailable — the tip just comes back next visit
    }
};
