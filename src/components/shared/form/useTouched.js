import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Which fields to show errors for before Save is pressed (FORM_TEMPLATE.md:
 * a field is checked when the person leaves it).
 *
 * Two details that matter more than they look:
 *   - Leaving a field you never typed in doesn't count — tabbing or clicking
 *     past an empty field shouldn't turn it red; Save catches it.
 *   - The error is shown after the click that moved focus away has finished.
 *     Focus leaves on mousedown; an error line appearing right then pushes the
 *     rest of the form down under the pointer, so the mouseup lands somewhere
 *     else and the click the person aimed (Locations, Create…) never happens.
 *
 * touch(name, changed) — call from onBlur; `changed` is whether the value
 * differs from where the form started.
 */
export default function useTouched() {
    const [touched, setTouched] = useState({});
    const pointerDown = useRef(false);

    useEffect(() => {
        const down = () => { pointerDown.current = true; };
        const up = () => { pointerDown.current = false; };
        document.addEventListener('pointerdown', down, true);
        document.addEventListener('pointerup', up, true);
        document.addEventListener('pointercancel', up, true);
        return () => {
            document.removeEventListener('pointerdown', down, true);
            document.removeEventListener('pointerup', up, true);
            document.removeEventListener('pointercancel', up, true);
        };
    }, []);

    const markNow = useCallback((name) => setTouched((t) => (t[name] ? t : { ...t, [name]: true })), []);

    const touch = useCallback((name, changed = true) => {
        if (!changed) return;
        if (!pointerDown.current) {
            markNow(name);
            return;
        }
        // Click order is pointerup → mouseup → click in one task, so a timer
        // started at pointerup runs after the click has been delivered.
        let done = false;
        const apply = () => { if (!done) { done = true; markNow(name); } };
        document.addEventListener('pointerup', () => setTimeout(apply, 0), { once: true, capture: true });
        setTimeout(apply, 1500); // a press that never ends (dragged off-screen)
    }, [markNow]);

    return [touched, touch, markNow];
}
