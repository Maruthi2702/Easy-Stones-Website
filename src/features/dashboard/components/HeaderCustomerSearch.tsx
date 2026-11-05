import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useCustomerFinder } from './useCustomerFinder';
import CustomerFinderList from './CustomerFinderList';
import type { CustomerSearchProps } from './CustomerSearch';
import './DashboardFocus.css';
import './CustomerSearch.css';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

/**
 * Find a customer on a laptop or desktop (option B of the claude.ai artifact
 * "Dashboard customer search", the owner's pick 2026-11-04): the header's 🔍
 * grows into a field, over the time range (the header hides the range while
 * it's open, so nothing jumps), with the list dropping down under it and the
 * page left as it is. Esc, opening a customer, or a click elsewhere with the
 * box empty closes it back to the 🔍; a click elsewhere with text in it only
 * hides the list until the box is used again.
 */
export default function HeaderCustomerSearch({ userId, onClose, onPick, onAddCustomer }: CustomerSearchProps) {
    const finder = useCustomerFinder({ userId, onPick });
    const { query, setQuery, onKeyDown, inputAria } = finder;
    const [listOpen, setListOpen] = useState(true);
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);

    // Esc closes, before the tab's own keys hear it.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || !rootRef.current?.contains(document.activeElement)) return;
            e.stopPropagation();
            onClose();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    // A click elsewhere: back to the 🔍 when empty, else just hide the list.
    useEffect(() => {
        const onDown = (e: PointerEvent) => {
            if (rootRef.current?.contains(e.target as Node)) return;
            if (!inputRef.current?.value.trim()) onClose();
            else setListOpen(false);
        };
        document.addEventListener('pointerdown', onDown);
        return () => document.removeEventListener('pointerdown', onDown);
    }, [onClose]);

    return (
        <div className="dfx-find is-open" ref={rootRef}>
            <div className="dfx-find-field">
                <Search size={17} strokeWidth={2.2} aria-hidden="true" />
                <input
                    ref={inputRef}
                    id="dashboard-customer-search"
                    className="no-capitalize"
                    type="text"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setListOpen(true); }}
                    onFocus={() => setListOpen(true)}
                    onKeyDown={(e) => { setListOpen(true); onKeyDown(e); }}
                    placeholder="Find a customer…"
                    autoComplete="off"
                    spellCheck={false}
                    {...inputAria}
                    aria-expanded={listOpen}
                />
                {query
                    ? <button type="button" className="dcs-clear" aria-label="Clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }}><X size={14} /></button>
                    : <span className="dcs-kbd">{isMac ? '⌘ K' : 'Ctrl K'}</span>}
            </div>
            {listOpen && (
                <div className="dfx-find-menu">
                    <CustomerFinderList finder={finder} onAddCustomer={onAddCustomer} />
                    <div className="dcs-foot">
                        <span><span className="dcs-kbd">↑</span><span className="dcs-kbd">↓</span> move</span>
                        <span><span className="dcs-kbd">Enter</span> open profile</span>
                        <span><span className="dcs-kbd">Esc</span> close</span>
                    </div>
                </div>
            )}
        </div>
    );
}
