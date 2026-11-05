import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import CustomerSearch from './CustomerSearch';
import HeaderCustomerSearch from './HeaderCustomerSearch';
import type { CustomerSearchProps } from './CustomerSearch';
import './CustomerSearch.css';

/**
 * Which look Find a customer takes (owner, 2026-11-04): the header field on a
 * laptop or desktop — 1024px and up *with a mouse or trackpad* — and the
 * pop-up / phone sheet everywhere else. Width alone would give an iPad in
 * landscape (1024–1366px) the field; its pointer is coarse, so it gets the pop-up.
 */
export const HEADER_FIELD_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

const matches = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(HEADER_FIELD_QUERY).matches;

export function useHeaderField(): boolean {
    const [on, setOn] = useState(matches);
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined;
        const mq = window.matchMedia(HEADER_FIELD_QUERY);
        const onChange = () => setOn(mq.matches);
        mq.addEventListener?.('change', onChange);
        return () => mq.removeEventListener?.('change', onChange);
    }, []);
    return on;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

/**
 * Find a customer in the Dashboard header: the round 🔍 before Filters, and
 * what it opens (HeaderCustomerSearch or CustomerSearch). The page holds
 * `open` so Ctrl / ⌘ K can open it too.
 */
export default function CustomerFinder({ open, onOpen, ...search }: CustomerSearchProps & { open: boolean; onOpen: () => void }) {
    const headerField = useHeaderField();
    if (open && headerField) return <HeaderCustomerSearch {...search} />;
    return (
        <>
            <button
                type="button"
                className="dfx-find-btn"
                onClick={onOpen}
                title={isMac ? 'Find a customer (⌘ K)' : 'Find a customer (Ctrl K)'}
                aria-label="Find a customer"
            >
                <Search size={17} strokeWidth={2.2} />
            </button>
            {open && <CustomerSearch {...search} />}
        </>
    );
}
