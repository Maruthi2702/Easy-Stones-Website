import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertCircle } from 'lucide-react';
import useIsPhone, { prefersReducedMotion } from './useIsPhone';
import { goToField, trapTab } from './formFocus';
import './FormModal.css';

/*
 * The app-wide form shell — FORM_TEMPLATE.md is the spec. Every form gets the
 * same behaviour from here rather than re-implementing it:
 *   - sizes s / m / l, and a full-screen sheet below 640px;
 *   - header and footer fixed, only the body scrolls (native momentum, no
 *     scroll listeners; edge shadows from IntersectionObserver sentinels);
 *   - the page behind is locked and keeps its scroll position;
 *   - on phones the sheet follows window.visualViewport, so the footer rides
 *     above the keyboard, and a field the keyboard hides is scrolled into view;
 *   - "N fields need attention" banner with Go to first;
 *   - saving locks every field and the buttons (no double submit);
 *   - ✕ / Esc / a click outside ask before throwing away typed changes;
 *   - focus starts in the first field (not on phones — a keyboard that pops
 *     up before they've seen the form hides half of it), Tab stays inside,
 *     Enter submits, and focus goes back where it was on close.
 */

// More than one form can be open (a form opening another); only the first
// lock saves and the last unlock restores the page.
let lockCount = 0;
let savedScrollY = 0;
const lockPage = () => {
    if (lockCount++ > 0) return;
    savedScrollY = window.scrollY;
    const b = document.body.style;
    b.position = 'fixed';
    b.top = `-${savedScrollY}px`;
    b.left = '0';
    b.right = '0';
    b.width = '100%';
    b.overflow = 'hidden';
};
const unlockPage = () => {
    if (--lockCount > 0) return;
    const b = document.body.style;
    b.position = '';
    b.top = '';
    b.left = '';
    b.right = '';
    b.width = '';
    b.overflow = '';
    window.scrollTo(0, savedScrollY);
};

export default function FormModal({
    title,
    size = 'm',
    onClose,
    onSubmit,
    submitLabel = 'Save',
    savingLabel = 'Saving…',
    saving = false,
    // Edit forms: greyed out until something has changed (FORM_TEMPLATE.md).
    submitDisabled = false,
    cancelLabel = 'Cancel',
    hideCancel = false,
    dirtyCount = 0,
    discardTitle = 'Discard your changes?',
    errors = {},
    showErrors = false,
    fieldLabels = {},
    footerNote = null,
    footerStart = null,
    // Phones only: Cancel and the main button side by side instead of the
    // template's stacked footer. Opt-in — the Locations form uses it.
    phoneFooterRow = false,
    children
}) {
    const isPhone = useIsPhone();
    const titleId = useId();
    const overlayRef = useRef(null);
    const dialogRef = useRef(null);
    const bodyRef = useRef(null);
    const topSentinel = useRef(null);
    const bottomSentinel = useRef(null);
    const pressStartedOnOverlay = useRef(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const errorKeys = Object.keys(errors).filter((k) => errors[k]);
    const bannerVisible = showErrors && errorKeys.length > 0;

    const focusBeforeConfirm = useRef(null);
    const requestClose = () => {
        if (saving) return;
        if (dirtyCount > 0) {
            focusBeforeConfirm.current = document.activeElement;
            setConfirmOpen(true);
        } else {
            onClose?.();
        }
    };
    // "Keep editing": back to exactly where they were, so Tab carries on from there.
    const keepEditing = () => {
        setConfirmOpen(false);
        const el = focusBeforeConfirm.current;
        requestAnimationFrame(() => {
            if (el && document.contains(el) && el.closest?.('.fm-dialog')) el.focus({ preventScroll: true });
            else dialogRef.current?.focus({ preventScroll: true });
        });
    };

    // Page lock + focus in/out. Layout effect so the page never visibly
    // scrolls under the form on the first frame.
    useLayoutEffect(() => {
        const previouslyFocused = document.activeElement;
        lockPage();
        return () => {
            unlockPage();
            if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
                previouslyFocused.focus({ preventScroll: true });
            }
        };
    }, []);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (isPhone) {
            dialog.focus({ preventScroll: true });
            return;
        }
        const first = dialog.querySelector('.fm-fieldset input:not([disabled]):not([type="hidden"]), .fm-fieldset textarea, .fm-fieldset .fm-picker-trigger');
        (first || dialog).focus({ preventScroll: true });
        // Only on open — not every time the screen size changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Typed changes survive an accidental refresh or back-swipe only if the
    // browser asks first.
    useEffect(() => {
        if (dirtyCount === 0) return;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirtyCount]);

    // Edge shadows: attributes on the dialog, toggled only when a sentinel
    // crosses the edge — nothing runs per scroll frame and React never renders.
    useEffect(() => {
        const body = bodyRef.current;
        const dialog = dialogRef.current;
        if (!body || !dialog || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const key = entry.target === topSentinel.current ? 'scrolledTop' : 'scrolledBottom';
                dialog.dataset[key] = entry.isIntersecting ? 'false' : 'true';
            }
        }, { root: body, threshold: 0 });
        if (topSentinel.current) io.observe(topSentinel.current);
        if (bottomSentinel.current) io.observe(bottomSentinel.current);
        return () => io.disconnect();
    }, []);

    // Phones: size the sheet to the visible area (it shrinks when the keyboard
    // opens), written straight to CSS variables, at most once per frame.
    useEffect(() => {
        const dialog = dialogRef.current;
        const vv = window.visualViewport;
        if (!isPhone || !dialog || !vv) return;
        let frame = 0;
        const apply = () => {
            frame = 0;
            dialog.style.setProperty('--fm-vvh', `${vv.height}px`);
            dialog.style.setProperty('--fm-vvtop', `${vv.offsetTop}px`);
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
        apply();
        vv.addEventListener('resize', schedule, { passive: true });
        vv.addEventListener('scroll', schedule, { passive: true });
        return () => {
            if (frame) cancelAnimationFrame(frame);
            vv.removeEventListener('resize', schedule);
            vv.removeEventListener('scroll', schedule);
            dialog.style.removeProperty('--fm-vvh');
            dialog.style.removeProperty('--fm-vvtop');
        };
    }, [isPhone]);

    // Phones: once the keyboard has settled, bring the field being typed in
    // into view — only if it's actually hidden; never nudge a visible one.
    useEffect(() => {
        const body = bodyRef.current;
        if (!isPhone || !body) return;
        let timer = 0;
        const onFocusIn = (e) => {
            const el = e.target;
            if (!(el instanceof HTMLElement) || !el.matches('input, textarea, select')) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
                const r = el.getBoundingClientRect();
                const box = body.getBoundingClientRect();
                if (r.top < box.top + 8 || r.bottom > box.bottom - 8) {
                    el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
                }
            }, 320);
        };
        body.addEventListener('focusin', onFocusIn);
        return () => {
            clearTimeout(timer);
            body.removeEventListener('focusin', onFocusIn);
        };
    }, [isPhone]);

    // On the document, not the overlay: if focus ever ends up on <body> (an
    // element that had it was removed), keys still reach the form instead of
    // Tab wandering off into the page behind. A bottom sheet or picker that
    // handles Esc itself stops the event before it gets here.
    const keyHandler = useRef(null);
    keyHandler.current = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            if (confirmOpen) keepEditing();
            else requestClose();
        } else if (e.key === 'Tab') {
            trapTab(e, overlayRef.current);
        }
    };
    useEffect(() => {
        const onKey = (e) => keyHandler.current(e);
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (saving || submitDisabled) return;
        onSubmit?.(e);
    };

    return createPortal(
        <div
            ref={overlayRef}
            className="fm-overlay"
            onMouseDown={(e) => { pressStartedOnOverlay.current = e.target === e.currentTarget; }}
            onClick={(e) => {
                if (pressStartedOnOverlay.current && e.target === e.currentTarget) requestClose();
                pressStartedOnOverlay.current = false;
            }}
        >
            <form
                ref={dialogRef}
                className={`fm-dialog fm-${size}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                noValidate
                onSubmit={handleSubmit}
                data-fm-layer=""
            >
                <header className="fm-header">
                    <h2 className="fm-title" id={titleId}>{title}</h2>
                    <button type="button" className="fm-close" aria-label="Close" title="Close without saving" onClick={requestClose} disabled={saving}>
                        <X size={18} strokeWidth={2.4} aria-hidden="true" />
                    </button>
                </header>

                <div className="fm-body" ref={bodyRef}>
                    <div ref={topSentinel} className="fm-sentinel" aria-hidden="true" />
                    {bannerVisible && (
                        <div className="fm-banner" role="alert">
                            <AlertCircle size={16} aria-hidden="true" />
                            <span className="fm-banner-text">
                                <strong>{errorKeys.length === 1 ? '1 field needs attention' : `${errorKeys.length} fields need attention`}</strong>
                                {' — '}{errorKeys.map((k) => fieldLabels[k] || k).join(', ')}
                            </span>
                            <button type="button" className="fm-banner-link" onClick={() => goToField(errorKeys[0])}>Go to first</button>
                        </div>
                    )}
                    <fieldset className="fm-fieldset" disabled={saving}>
                        {children}
                    </fieldset>
                    <div ref={bottomSentinel} className="fm-sentinel" aria-hidden="true" />
                </div>

                <footer className={`fm-footer${phoneFooterRow ? ' fm-footer-row' : ''}`}>
                    {footerStart && <span className="fm-footer-start">{footerStart}</span>}
                    <span className="fm-footer-note">{footerNote}</span>
                    {!hideCancel && (
                        <button type="button" className="fm-btn fm-btn-cancel" onClick={requestClose} disabled={saving}>{cancelLabel}</button>
                    )}
                    <button type="submit" className="fm-btn fm-btn-primary" disabled={saving || submitDisabled} aria-busy={saving ? 'true' : undefined}>
                        {saving ? <><span className="fm-spinner" aria-hidden="true" />{savingLabel}</> : submitLabel}
                    </button>
                </footer>
            </form>

            {confirmOpen && (
                <div className="fm-confirm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) keepEditing(); }}>
                    <div className="fm-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${titleId}-discard`} data-fm-layer="" tabIndex={-1}>
                        <h3 className="fm-confirm-title" id={`${titleId}-discard`}>{discardTitle}</h3>
                        <p className="fm-confirm-text">
                            {dirtyCount === 1 ? 'You’ve filled in 1 field.' : `You’ve filled in ${dirtyCount} fields.`} {'They’ll be lost if you close now.'}
                        </p>
                        <div className="fm-confirm-actions">
                            <button type="button" className="fm-btn fm-btn-primary" autoFocus onClick={keepEditing}>Keep editing</button>
                            <button type="button" className="fm-btn fm-btn-danger" onClick={() => { setConfirmOpen(false); onClose?.(); }}>Discard</button>
                        </div>
                    </div>
                </div>
            )}
        </div>,
        document.body
    );
}
