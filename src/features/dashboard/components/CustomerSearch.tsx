import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { useCustomerFinder } from './useCustomerFinder';
import CustomerFinderList from './CustomerFinderList';
import { lockPage, unlockPage } from '../../../components/shared/pageLock';
import type { CustomerOption } from '../../../utils/customerOptions';
import './DashboardFocus.css';
import './CustomerSearch.css';

export type CustomerSearchProps = {
    /** Whose recently opened customers to show (kept per person, on this device). */
    userId: string | null;
    onClose: () => void;
    /** A customer was picked: open them. */
    onPick: (customer: CustomerOption) => void;
    /** "Add customer" when nothing matches; absent without Add customer. */
    onAddCustomer?: (name: string) => void;
};

/**
 * Find a customer on an iPad or a phone (option A of the claude.ai artifact
 * "Dashboard customer search", 2026-11-04): a pop-up near the top on a tablet,
 * a sheet with Cancel under 640px (CustomerSearch.css). Since 2026-11-04 the
 * phone sheet starts under the Dashboard's title row, which shows dimmed above
 * it (option A of the claude.ai artifact "Dashboard search with a peek",
 * https://claude.ai/artifact/Pei1RCubnrXnthu6S68DWb): a tap there, Cancel, or
 * dragging the handle down closes it. Laptops and desktops get the header
 * field instead (HeaderCustomerSearch); CustomerFinder picks. ↑ ↓ move, Enter
 * opens, Esc closes.
 */

/** How far the handle must be dragged down before letting go closes the sheet. */
const DRAG_CLOSE_PX = 90;
export default function CustomerSearch({ userId, onClose, onPick, onAddCustomer }: CustomerSearchProps) {
    const finder = useCustomerFinder({ userId, onPick });
    const { query, setQuery, onKeyDown, inputAria } = finder;
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const sheetRef = useRef<HTMLDivElement>(null);
    const dragFrom = useRef<number | null>(null);

    // The phone sheet's handle: the sheet follows the finger down; let go past
    // DRAG_CLOSE_PX and it closes, otherwise it springs back.
    const dragBy = (e: ReactPointerEvent) => Math.max(0, e.clientY - (dragFrom.current ?? e.clientY));
    const onGrabDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        dragFrom.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
        sheetRef.current?.classList.add('is-dragging');
    };
    const onGrabMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (dragFrom.current === null || !sheetRef.current) return;
        sheetRef.current.style.transform = `translateY(${dragBy(e)}px)`;
    };
    const onGrabUp = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (dragFrom.current === null) return;
        const moved = dragBy(e);
        dragFrom.current = null;
        sheetRef.current?.classList.remove('is-dragging');
        if (moved > DRAG_CLOSE_PX) { onClose(); return; }
        if (sheetRef.current) sheetRef.current.style.transform = '';
    };

    // Lock the page behind (as forms do, so the keyboard opening on a phone
    // can't scroll the Dashboard under the sheet), focus the box, give focus
    // back on close. The sheet doesn't slide in: iOS draws the caret where the
    // box was when it got focus, so a moving box left the caret mid-list.
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        lockPage();
        inputRef.current?.focus({ preventScroll: true });
        return () => {
            unlockPage();
            previous?.focus?.({ preventScroll: true });
        };
    }, []);

    // Phones: the sheet never moves or resizes for the keyboard — it fills
    // the screen under the title row and the keyboard covers its bottom, as
    // iOS's own search sheets do. Following visualViewport for its top and
    // height (until 2026-11-04) squeezed it while the keyboard slid, left it
    // too low after the keyboard closed (iOS reports stale offsets), and
    // uncovered a strip of the Dashboard that a drag then scrolled. Only the
    // list's end padding (--dcs-kb) follows the keyboard, so the last rows
    // can be scrolled above it; a stale value there is just blank space.
    useEffect(() => {
        const wrap = wrapRef.current;
        const vv = window.visualViewport;
        if (!wrap || !vv) return undefined;
        let frame = 0;
        const apply = () => {
            frame = 0;
            const kb = vv.scale > 1.01 ? 0 : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
            wrap.style.setProperty('--dcs-kb', `${kb}px`);
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
        apply();
        vv.addEventListener('resize', schedule, { passive: true });
        vv.addEventListener('scroll', schedule, { passive: true });
        return () => {
            if (frame) cancelAnimationFrame(frame);
            vv.removeEventListener('resize', schedule);
            vv.removeEventListener('scroll', schedule);
        };
    }, []);

    // A drag anywhere but the results list moves nothing: not the Dashboard
    // behind, and not the whole screen (with the keyboard up iOS pans the page
    // under a finger). The list scrolls itself and stops at its ends instead
    // of handing the drag on (overscroll-behavior in the CSS, and here for
    // older iOS). The handle's drag-to-close uses pointer events, unaffected.
    useEffect(() => {
        const wrap = wrapRef.current;
        if (!wrap) return undefined;
        let lastY = 0;
        const onStart = (e: TouchEvent) => { lastY = e.touches[0]?.clientY ?? 0; };
        const onMove = (e: TouchEvent) => {
            const y = e.touches[0]?.clientY ?? lastY;
            const dy = y - lastY;
            lastY = y;
            const list = (e.target as Element | null)?.closest?.('.dcs-body') as HTMLElement | null;
            if (list && list.scrollHeight > list.clientHeight + 1) {
                const atTop = list.scrollTop <= 0;
                const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
                if (!((dy > 0 && atTop) || (dy < 0 && atEnd))) return;
            }
            if (e.cancelable) e.preventDefault();
        };
        wrap.addEventListener('touchstart', onStart, { passive: true });
        wrap.addEventListener('touchmove', onMove, { passive: false });
        return () => {
            wrap.removeEventListener('touchstart', onStart);
            wrap.removeEventListener('touchmove', onMove);
        };
    }, []);

    // Esc closes, before anything under the pop-up hears it.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    return createPortal(
        <div ref={wrapRef} className="dcs-wrap">
            <button type="button" className="dcs-backdrop" aria-label="Close search" tabIndex={-1} onClick={onClose} />
            <div ref={sheetRef} className="dcs" role="dialog" aria-modal="true" aria-label="Find a customer">
                {/* Phone only (CustomerSearch.css): drag down to close. */}
                <div
                    className="dcs-grab"
                    aria-hidden="true"
                    onPointerDown={onGrabDown}
                    onPointerMove={onGrabMove}
                    onPointerUp={onGrabUp}
                    onPointerCancel={onGrabUp}
                ><span /></div>
                <div className="dcs-top">
                    <div className="dcs-field">
                        <Search size={19} aria-hidden="true" />
                        <input
                            ref={inputRef}
                            id="dashboard-customer-search"
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={onKeyDown}
                            className="no-capitalize"
                            placeholder="Find a customer…"
                            autoComplete="off"
                            spellCheck={false}
                            {...inputAria}
                        />
                        {query && (
                            <button type="button" className="dcs-clear" aria-label="Clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <button type="button" className="dcs-cancel" onClick={onClose}>Cancel</button>
                </div>
                <CustomerFinderList finder={finder} onAddCustomer={onAddCustomer} />
            </div>
        </div>,
        document.body
    );
}
