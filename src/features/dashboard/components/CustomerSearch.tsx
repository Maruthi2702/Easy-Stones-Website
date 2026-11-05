import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { useCustomerFinder } from './useCustomerFinder';
import CustomerFinderList from './CustomerFinderList';
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
 * a full-screen sheet with Cancel under 640px (CustomerSearch.css). Laptops and
 * desktops get the header field instead (HeaderCustomerSearch); CustomerFinder
 * picks. ↑ ↓ move, Enter opens, Esc closes.
 */
export default function CustomerSearch({ userId, onClose, onPick, onAddCustomer }: CustomerSearchProps) {
    const finder = useCustomerFinder({ userId, onPick });
    const { query, setQuery, onKeyDown, inputAria } = finder;
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus the box, lock the page behind, give focus back on close.
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        inputRef.current?.focus({ preventScroll: true });
        const html = document.documentElement;
        const had = html.style.overflow;
        html.style.overflow = 'hidden';
        return () => {
            html.style.overflow = had;
            previous?.focus?.({ preventScroll: true });
        };
    }, []);

    // Esc closes, before anything under the pop-up hears it.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    return createPortal(
        <div className="dcs-wrap">
            <button type="button" className="dcs-backdrop" aria-label="Close search" tabIndex={-1} onClick={onClose} />
            <div className="dcs" role="dialog" aria-modal="true" aria-label="Find a customer">
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
