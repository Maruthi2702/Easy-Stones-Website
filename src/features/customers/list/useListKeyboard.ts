// The Customers list's keys: / search, ↑↓ move, Enter open, Esc close.
import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Loose } from '../../../types/records';

export type ListKeyboardDeps = {
    rootRef: RefObject<HTMLDivElement | null>;
    searchRef: RefObject<HTMLInputElement | null>;
    partners: Loose[];
    focusIndex: number;
    setFocusIndex: Dispatch<SetStateAction<number>>;
    openIndex: number;
    openCustomer: Loose | null;
    setOpenCustomer: Dispatch<SetStateAction<Loose | null>>;
    narrow: boolean;
    /** A window or sheet over the list: keys are left to it. */
    showAddModal: boolean;
    showImportModal: boolean;
    showSpsConnect: boolean;
    showSpsImport: boolean;
    showFilterSheet: boolean;
    bulkDelete: unknown;
};

// Only while this list is the one on screen — SalesPage keeps it mounted
// (hidden) behind a profile.
export function useListKeyboard(d: ListKeyboardDeps) {
    const {
        rootRef, searchRef, partners, focusIndex, setFocusIndex, openIndex, openCustomer, setOpenCustomer, narrow,
        showAddModal, showImportModal, showSpsConnect, showSpsImport, showFilterSheet, bulkDelete
    } = d;
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (!rootRef.current || rootRef.current.offsetParent === null) return;
            if (showAddModal || showImportModal || showSpsConnect || showSpsImport || showFilterSheet || bulkDelete) return;
            const tag = (target.tagName || '').toLowerCase();
            const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
            if (e.key === 'Escape') {
                if (openCustomer) { setOpenCustomer(null); return; }
                if (typing && target === searchRef.current) { searchRef.current!.blur(); }
                return;
            }
            if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
            if (narrow || !partners.length) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const from = focusIndex >= 0 ? focusIndex : (openIndex >= 0 ? openIndex : -1);
                const next = Math.max(0, Math.min(partners.length - 1, from + (e.key === 'ArrowDown' ? 1 : -1)));
                setFocusIndex(next);
                if (openCustomer) setOpenCustomer(partners[next]);
            } else if (e.key === 'Enter' && focusIndex >= 0 && partners[focusIndex]) {
                e.preventDefault();
                setOpenCustomer(partners[focusIndex]);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
        // Refs and setters are stable; the rest is what the original listed.
    }, [rootRef, searchRef, setFocusIndex, setOpenCustomer, partners, focusIndex, openIndex, openCustomer, narrow, showAddModal, showImportModal, showSpsConnect, showSpsImport, showFilterSheet, bulkDelete]);
}
