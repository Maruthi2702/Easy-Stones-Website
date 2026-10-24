// Small pieces of the Customers list's screen state: the window width, the
// pop-ups it opens, and messages that clear themselves.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useDismiss } from './uiHelpers';
import type { Loose } from '../../../types/records';

export const useWindowWidth = () => {
    const [w, setW] = useState(() => window.innerWidth);
    useEffect(() => {
        const onResize = () => setW(window.innerWidth);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return w;
};

/** Which of the list's windows and menus are open, and the customer Add/Edit is on. */
export function useListDialogs() {
    const [showAddModal, setShowAddModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [showSpsConnect, setShowSpsConnect] = useState(false);
    const [showSpsImport, setShowSpsImport] = useState(false);
    const [editingPartner, setEditingPartner] = useState<Loose | null>(null);
    const [viewingPartner, setViewingPartner] = useState<Loose | null>(null);
    const [showFilterSheet, setShowFilterSheet] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const moreRef = useRef<HTMLDivElement>(null);
    useDismiss(moreOpen, setMoreOpen, moreRef);

    /** Add customer: a blank form. */
    const openAdd = () => { setEditingPartner(null); setViewingPartner(null); setShowAddModal(true); };
    /** Edit customer: the form on this row. */
    const openEdit = (row: Loose) => { setEditingPartner(row); setViewingPartner(null); setShowAddModal(true); };
    const closeAdd = () => { setShowAddModal(false); setEditingPartner(null); setViewingPartner(null); };

    return {
        showAddModal, showImportModal, setShowImportModal, showSpsConnect, setShowSpsConnect, showSpsImport, setShowSpsImport,
        editingPartner, setEditingPartner, viewingPartner, setViewingPartner,
        showFilterSheet, setShowFilterSheet, moreOpen, setMoreOpen, moreRef,
        openAdd, openEdit, closeAdd
    };
}
export type ListDialogs = ReturnType<typeof useListDialogs>;

/** A message that clears itself after `ms`. */
export function useFlash(ms: number): [string, Dispatch<SetStateAction<string>>] {
    const [message, setMessage] = useState('');
    useEffect(() => {
        if (!message) return undefined;
        const t = setTimeout(() => setMessage(''), ms);
        return () => clearTimeout(t);
    }, [message, ms]);
    return [message, setMessage];
}

/**
 * "Log this call?": a Call tapped on a phone is remembered (sessionStorage,
 * so it survives the browser being backgrounded or reloaded for the call),
 * and when the person comes back to the app they're asked to log it.
 */
export function usePendingCall(canLogCalls: boolean) {
    const [logCallFor, setLogCallFor] = useState<Loose | null>(null);
    const rememberCall = (row: Loose) => {
        if (!canLogCalls || !row?._id) return;
        try {
            sessionStorage.setItem('cl.pendingCall', JSON.stringify({
                at: Date.now(),
                customer: { _id: row._id, company: row.company, contactName: row.contactName, name: row.name }
            }));
        } catch { /* private mode: no prompt, the call itself still works */ }
    };
    useEffect(() => {
        if (!canLogCalls) return undefined;
        const check = () => {
            if (document.visibilityState !== 'visible') return;
            let pending = null;
            try { pending = JSON.parse(sessionStorage.getItem('cl.pendingCall') || 'null'); } catch { pending = null; }
            if (!pending?.customer?._id) return;
            const elapsed = Date.now() - (pending.at || 0);
            // Ignore the instant the dialer hands back without a call, and anything stale.
            if (elapsed < 3000) return;
            try { sessionStorage.removeItem('cl.pendingCall'); } catch { /* ignore */ }
            if (elapsed <= 2 * 60 * 60 * 1000) setLogCallFor(pending.customer);
        };
        document.addEventListener('visibilitychange', check);
        window.addEventListener('focus', check);
        return () => {
            document.removeEventListener('visibilitychange', check);
            window.removeEventListener('focus', check);
        };
    }, [canLogCalls]);
    return { logCallFor, setLogCallFor, rememberCall };
}

/** Ticked rows. Selection persists across pages, so keep the rows themselves for copy/export. */
export function useSelection(partners: Loose[]) {
    const [selected, setSelected] = useState(() => new Map<string, Loose>());
    const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
    const selectedRows = useMemo(() => [...selected.values()], [selected]);
    const toggleRow = (id: string) => setSelected(prev => {
        const next = new Map(prev);
        if (next.has(id)) next.delete(id);
        else { const row = partners.find(p => p._id === id); if (row) next.set(id, row); }
        return next;
    });
    const toggleAll = (on: boolean) => setSelected(prev => {
        const next = new Map(prev);
        partners.forEach(p => (on ? next.set(p._id, p) : next.delete(p._id)));
        return next;
    });
    return { selected, setSelected, selectedIds, selectedRows, toggleRow, toggleAll };
}
