import { prefersReducedMotion } from './useIsPhone';

const FOCUSABLE = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Scroll a form field into the middle of the form body and put the cursor in
 * it — the error banner's "Go to first", and a failed Create. Fields are
 * found by FormField's data-field attribute inside the open form.
 */
export function goToField(name) {
    if (typeof document === 'undefined' || !name) return;
    const dialogs = document.querySelectorAll('.fm-dialog');
    const dialog = dialogs[dialogs.length - 1];
    const field = dialog?.querySelector(`[data-field="${CSS.escape(name)}"]`);
    if (!field) return;
    field.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    const target = field.querySelector(FOCUSABLE);
    target?.focus({ preventScroll: true });
}

/** Keeps Tab inside the topmost layer (discard check > bottom sheet > form). */
export function trapTab(e, root) {
    const layers = root?.querySelectorAll('[data-fm-layer]');
    const layer = layers?.[layers.length - 1];
    if (!layer) return;
    const items = [...layer.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
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

export const firstFocusableIn = (el) => el?.querySelector(FOCUSABLE) || null;

/** aria props for a control inside FormField (its message has id `${id}-msg`). */
export const describedBy = (id, error, status) => ({
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': error || status ? `${id}-msg` : undefined
});
