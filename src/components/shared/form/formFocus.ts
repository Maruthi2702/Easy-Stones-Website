import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { prefersReducedMotion } from './useIsPhone';

const FOCUSABLE = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Scroll a form field into the middle of the form body and put the cursor in
 * it — the error banner's "Go to first", and a failed Create. Fields are
 * found by FormField's data-field attribute inside the open form.
 */
export function goToField(name: string | null | undefined): void {
    if (typeof document === 'undefined' || !name) return;
    const dialogs = document.querySelectorAll('.fm-dialog');
    const dialog = dialogs[dialogs.length - 1];
    const field = dialog?.querySelector(`[data-field="${CSS.escape(name)}"]`);
    if (!field) return;
    field.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    const target = field.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus({ preventScroll: true });
}

/** Keeps Tab inside the topmost layer (discard check > bottom sheet > form). */
export function trapTab(e: KeyboardEvent | ReactKeyboardEvent, root: HTMLElement | null | undefined): void {
    const layers = root?.querySelectorAll<HTMLElement>('[data-fm-layer]');
    const layer = layers?.[layers.length - 1];
    if (!layer) return;
    const items = [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) {
        e.preventDefault();
        layer.focus?.();
        return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!layer.contains(active)) {
        e.preventDefault();
        first.focus();
    } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
    }
}

export const firstFocusableIn = (el: Element | null | undefined): HTMLElement | null => el?.querySelector<HTMLElement>(FOCUSABLE) || null;

/** aria props for a control inside FormField (its message has id `${id}-msg`). */
export const describedBy = (id: string, error: unknown, status?: unknown) => ({
    'aria-invalid': (error ? 'true' : undefined) as 'true' | undefined,
    'aria-describedby': error || status ? `${id}-msg` : undefined
});

/** Room between a field and the edges of the box it scrolls in (or the window). */
function menuRoom(anchor: Element, scroller: Element | null | undefined): { above: number; below: number } {
    const a = anchor.getBoundingClientRect();
    const b = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    return { below: b.bottom - a.bottom - 12, above: a.top - b.top - 12 };
}

/**
 * Where a desktop dropdown (.fm-menu) opens: below its field, or above it
 * when the form body has more room there, with its height capped to that
 * room. Measured when the list opens, against the form body it scrolls in —
 * or `scroller`, for a dropdown used outside a form (LocationPicker passes
 * the nearest box that would clip it; null measures against the window).
 * `content` is the list's own height when known: a short list doesn't flip
 * above a field that has room for it below.
 */
export function menuPlacement(
    anchor: Element | null | undefined,
    wanted = 440,
    scroller: Element | null | undefined = anchor?.closest('.fm-body, .fm-sheet-body'),
    content = wanted
): { placement: 'up' | 'down'; maxHeight: number } {
    if (!anchor) return { placement: 'down', maxHeight: wanted };
    const { above, below } = menuRoom(anchor, scroller);
    const up = below < Math.min(wanted, content, 240) && above > below;
    return { placement: up ? 'up' : 'down', maxHeight: Math.round(Math.max(160, Math.min(wanted, up ? above : below))) };
}

/** The nearest ancestor that would cut a floating list off (a dropdown outside a form). */
export const clipParentOf = (el: Element | null | undefined): HTMLElement | null => {
    for (let node = el?.parentElement; node && node !== document.body; node = node.parentElement) {
        const { overflowY } = window.getComputedStyle(node);
        if (overflowY !== 'visible') return node;
    }
    return null;
};

export type MenuPlacement = { placement: 'up' | 'down' | 'sheet'; maxHeight: number };
const MENU_START: MenuPlacement = { placement: 'down', maxHeight: 440 };

/**
 * menuPlacement for a dropdown that's open, measured once its list is drawn —
 * and when the form body has no room for the list on either side of the
 * field (a short form: Add resource type's Family under one Name field), it
 * says 'sheet' and the picker shows its phone bottom sheet instead, like the
 * calendar (choosePlacement). Before this the list was cut off by the body.
 * A dropdown outside a form (`scrollerOf` gives null, or no form body is
 * around it) never goes to a sheet. Back to the start when it closes, so the
 * next open measures again.
 */
const formScrollerOf = (anchor: Element) => anchor.closest('.fm-body, .fm-sheet-body');

export function useMenuPlacement(
    open: boolean,
    isPhone: boolean,
    anchorRef: RefObject<Element | null>,
    menuRef: RefObject<Element | null>,
    scrollerOf: (anchor: Element) => Element | null | undefined = formScrollerOf
): MenuPlacement {
    // Menu geometry comes from the DOM. Publish only changed measurements so
    // a caller's inline scroller callback cannot cause a render/reset loop.
    const [measurements] = useState(() => {
        let snapshot = MENU_START;
        const listeners = new Set<() => void>();
        return {
            getSnapshot: () => snapshot,
            subscribe: (listener: () => void) => {
                listeners.add(listener);
                return () => { listeners.delete(listener); };
            },
            update: (next: MenuPlacement) => {
                if (snapshot.placement === next.placement && snapshot.maxHeight === next.maxHeight) return;
                snapshot = next;
                listeners.forEach(listener => listener());
            }
        };
    });
    const pos = useSyncExternalStore(measurements.subscribe, measurements.getSnapshot, () => MENU_START);
    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        if (!open || isPhone || !anchor) return undefined;
        const measure = () => {
            const scroller = scrollerOf(anchor);
            const content = menuRef.current?.scrollHeight || 0;
            const placed = menuPlacement(anchor, 440, scroller, content || 440);
            const { above, below } = menuRoom(anchor, scroller);
            const room = placed.placement === 'up' ? above : below;
            const noRoom = Boolean(scroller?.closest('.fm-body')) && content > 0 && room < Math.min(content, 160);
            measurements.update(noRoom ? { placement: 'sheet', maxHeight: 440 } : placed);
        };
        measure();
        window.addEventListener('resize', measure);
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        observer?.observe(anchor);
        if (menuRef.current) observer?.observe(menuRef.current);
        return () => {
            window.removeEventListener('resize', measure);
            observer?.disconnect();
        };
    }, [open, isPhone, anchorRef, menuRef, scrollerOf, measurements]);
    return open && !isPhone ? pos : MENU_START;
}
