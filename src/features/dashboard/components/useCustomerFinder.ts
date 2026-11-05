import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useCustomerOptions } from '../../../api/customerOptions';
import { findCustomers, recentCustomers, recentKey, rememberRecent } from '../../../utils/customerQuickSearch';
import type { CustomerOption } from '../../../utils/customerOptions';

const readRecent = (key: string): string[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch { return []; }
};
const writeRecent = (key: string, ids: string[]) => {
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* private mode: no recent list */ }
};

/**
 * Find a customer's engine, shared by its two looks — the pop-up / phone sheet
 * (CustomerSearch, iPad and phone) and the header field (HeaderCustomerSearch,
 * laptop and desktop): what's typed, the rows (recent when blank), the
 * highlighted row, ↑ ↓ Enter, and remembering a pick.
 */
export function useCustomerFinder({ userId, onPick }: { userId: string | null; onPick: (customer: CustomerOption) => void }) {
    const { options, loading, refresh } = useCustomerOptions();
    const [query, setQueryRaw] = useState('');
    const [active, setActive] = useState(0);
    const [recentIds, setRecentIds] = useState<string[]>(() => readRecent(recentKey(userId)));
    const listRef = useRef<HTMLDivElement>(null);
    const listId = useId();

    const typed = query.trim();
    const found = useMemo(() => findCustomers(options, typed), [options, typed]);
    const recent = useMemo(() => recentCustomers(options, recentIds), [options, recentIds]);
    const rows = typed ? found.rows : recent;

    const setQuery = (value: string) => { setQueryRaw(value); setActive(0); };

    // Keep the highlighted row in view by scrolling the list only (scrollIntoView
    // would scroll the page's body too — see LocationPicker in CLAUDE.md).
    useEffect(() => {
        const list = listRef.current;
        const row = list?.querySelector<HTMLElement>(`[data-row="${active}"]`);
        if (!list || !row) return;
        if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop - 8;
        else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight + 8;
    }, [active]);

    const pick = (customer: CustomerOption) => {
        const next = rememberRecent(recentIds, String(customer.value));
        setRecentIds(next);
        writeRecent(recentKey(userId), next);
        onPick(customer);
    };

    /** ↑ ↓ move, Enter opens; for the text box's onKeyDown. */
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!rows.length) return;
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => (i + step + rows.length) % rows.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const row = rows[active];
            if (row) pick(row);
        }
    };

    return {
        query, setQuery, typed, active, setActive, rows, found, recent, pick, onKeyDown, listRef, listId,
        loading: loading && !options.length,
        failed: !loading && options.length === 0,
        refresh,
        /** The text box's combobox attributes. */
        inputAria: {
            role: 'combobox' as const,
            'aria-expanded': true,
            'aria-controls': listId,
            'aria-activedescendant': rows[active] ? `${listId}-${active}` : undefined,
            'aria-label': 'Search customers'
        }
    };
}

export type CustomerFinder = ReturnType<typeof useCustomerFinder>;
