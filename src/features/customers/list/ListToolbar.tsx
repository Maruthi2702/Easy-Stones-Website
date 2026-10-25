import type { ReactNode } from 'react';
import { X, SlidersHorizontal } from 'lucide-react';
import { TABS } from './listOptions';

export type ListToolbarProps = {
    activeTab: string;
    onTabChange: (tab: string) => void;
    loading: boolean;
    totalCount: number;
    /** The saved-view picker (null without Full profile). */
    viewPicker: ReactNode;
    /** The filter dropdowns (ListFilterControls). */
    filterControls: ReactNode;
    letter: string;
    onClearLetter: () => void;
    view: string;
    activeFilterCount: number;
    onClearFilters: () => void;
    onOpenSheet: () => void;
};

/** The Fabricators / Partners tabs with the views and filters, and the narrow-screen filter bar. */
export default function ListToolbar(p: ListToolbarProps) {
    const { activeTab, loading, totalCount, viewPicker, filterControls, letter, view, activeFilterCount } = p;
    const currentTab = TABS.find(t => t.key === activeTab);
    const letterChip = letter && (
        <button type="button" className="cl-dd-btn set" onClick={p.onClearLetter} aria-label={`Clear starts-with ${letter}`}>
            Starts with {letter} <X size={13} aria-hidden="true" />
        </button>
    );
    const clearAll = (activeFilterCount > 0 || view) && (
        <button type="button" className="cl-btn sm" style={{ border: 0, background: 'none', color: 'var(--cl-gold-ink)' }} onClick={p.onClearFilters}>Clear all</button>
    );
    return (
        <>
            {/* ── Tabs + views/filters ── */}
            <div className="cl-tabs cl-tabs-filters">
                <div role="tablist" aria-label="Customer type" style={{ display: 'flex', gap: 18 }}>
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        const on = activeTab === tab.key;
                        return (
                            <button key={tab.key} type="button" role="tab" aria-selected={on} className="cl-tab" title={tab.hint} onClick={() => p.onTabChange(tab.key)}>
                                <Icon size={15} aria-hidden="true" />{tab.label}
                                {on && !loading && <span className="n">{totalCount}</span>}
                            </button>
                        );
                    })}
                </div>
                {/* Desktop: views + filters share the tabs row, so the list starts a row higher. */}
                <div className="cl-filters cl-hide-narrow">
                    {viewPicker}
                    {filterControls}
                    {letterChip}
                    {clearAll}
                </div>
            </div>

            {/* ── Filter bar (narrow screens: filters live in a sheet) ── */}
            <div className="cl-bar cl-only-narrow">
                {viewPicker}
                <button type="button" className={`cl-dd-btn${activeFilterCount ? ' set' : ''}`} onClick={p.onOpenSheet}>
                    <SlidersHorizontal size={15} aria-hidden="true" />Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}
                </button>
                {letterChip}
                {clearAll}
                <span className="cl-grow" />
                <span className="cl-muted cl-hide-phone" style={{ fontSize: 12.5 }}>{currentTab?.hint}</span>
            </div>
        </>
    );
}
