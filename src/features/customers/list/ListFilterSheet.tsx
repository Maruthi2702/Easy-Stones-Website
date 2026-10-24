import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { SORTS } from './listOptions';

export type ListFilterSheetProps = {
    /** The filter dropdowns (ListFilterControls). */
    filterControls: ReactNode;
    sortBy: string;
    sortOrder: string;
    /** A sort picked in the sheet ("by:order"); goes back to page 1. */
    onSort: (by: string, order: string) => void;
    canProfile: boolean;
    /** Filters or a view are set ('' or false when not). */
    showClearAll: boolean | string;
    onClearFilters: () => void;
    loading: boolean;
    totalCount: number;
    onClose: () => void;
};

/** Narrow screens: Sort by and the filters, in a bottom sheet. */
export default function ListFilterSheet(p: ListFilterSheetProps) {
    const sheetSort = (
        <label className="cl-dd" style={{ display: 'block' }}>
            <span className="cl-sr">Sort by</span>
            <select
                className="cl-dd-btn"
                style={{ width: '100%', height: 44 }}
                value={`${p.sortBy}:${p.sortOrder}`}
                onChange={(e) => { const [by, order] = e.target.value.split(':'); p.onSort(by, order); }}
            >
                {SORTS.filter(s => p.canProfile || !s.profile).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
        </label>
    );
    return (
        <>
            <div className="cl-scrim" onClick={p.onClose} aria-hidden="true" />
            <section className="cl-sheet cl" role="dialog" aria-modal="true" aria-label="Filters">
                <div className="cl-sheet-handle" aria-hidden="true" />
                <div className="cl-sheet-hd">
                    <h3>Filters</h3>
                    {p.showClearAll && <button type="button" className="cl-btn sm" style={{ border: 0, background: 'none', color: 'var(--cl-gold-ink)' }} onClick={p.onClearFilters}>Clear all</button>}
                    <button type="button" className="cl-ib" aria-label="Close filters" onClick={p.onClose}><X size={20} /></button>
                </div>
                <div className="cl-sheet-bd">
                    <div className="cl-fl">Sort by</div>
                    {sheetSort}
                    <div className="cl-fl">Filter by</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{p.filterControls}</div>
                </div>
                <div className="cl-sheet-ft">
                    <button type="button" className="cl-btn" style={{ height: 48 }} onClick={p.onClearFilters}>Reset</button>
                    <button type="button" className="cl-btn gold" style={{ height: 48, flex: 1, justifyContent: 'center' }} onClick={p.onClose}>
                        Show {p.loading ? '' : p.totalCount} results
                    </button>
                </div>
            </section>
        </>
    );
}
