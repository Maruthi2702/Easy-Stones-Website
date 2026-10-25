import { useRef, useState } from 'react';
import { ChevronDown, AlertTriangle, LayoutList } from 'lucide-react';
import { STATUSES, statusMeta, SAVED_VIEWS } from '../../../utils/customerList';
import { orderLocations, homeLocationOf } from '../../../utils/locationFilter';
import { FilterDropdown } from './parts';
import { useDismiss } from './uiHelpers';
import { LEVELS, PARTNER_TYPES, MODA_OPTIONS } from './listOptions';
import type { ListFilters } from './useListFilters';
import type { Loose } from '../../../types/records';

/** Saved-view picker — first control in the filter row (and the narrow-screen bar). */
export const ViewPicker = ({ view, counts, onChange }: { view: string; counts: Record<string, number>; onChange: (view: string) => void }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useDismiss(open, setOpen, ref);
    const current = SAVED_VIEWS.find(v => v.key === view);
    return (
        <div className="cl-dd" ref={ref}>
            <button type="button" className={`cl-dd-btn${current ? ' set' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
                <LayoutList size={14} aria-hidden="true" />
                <span className="lbl">{current ? current.label : 'All customers'}</span>
                {current && counts[current.key] !== undefined && <span style={{ opacity: 0.75, fontSize: 11.5 }}>{counts[current.key]}</span>}
                <ChevronDown size={14} aria-hidden="true" />
            </button>
            {open && (
                <div className="cl-pop" role="menu">
                    <button type="button" role="menuitemradio" aria-checked={!view} className="cl-opt" onClick={() => { setOpen(false); onChange(''); }}>All customers</button>
                    {SAVED_VIEWS.map(v => (
                        <button key={v.key} type="button" role="menuitemradio" aria-checked={view === v.key} className="cl-opt" onClick={() => { setOpen(false); onChange(v.key); }}>
                            {v.warn && <AlertTriangle size={14} style={{ color: 'var(--cl-warn)' }} aria-hidden="true" />}
                            {v.label}
                            {counts[v.key] !== undefined && <span className="n">{counts[v.key]}</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export type ListFilterControlsProps = {
    filters: ListFilters;
    user: Loose | null;
    uniqueCities: string[];
    canProfile: boolean;
    isFabTab: boolean;
    /** A filter's change, which also goes back to page 1. */
    withReset: (setter: (next: string[]) => void) => (v: string[]) => void;
};

/** The filter controls, shared by the bar and the phone sheet. */
export default function ListFilterControls({ filters, user, uniqueCities, canProfile, isFabTab, withReset }: ListFilterControlsProps) {
    const f = filters;
    return (
        <>
            <FilterDropdown
                label="Status"
                allLabel="Status: All"
                options={STATUSES.map(s => ({ value: s, label: s, dot: statusMeta(s).tone }))}
                selected={f.filterStatuses}
                onChange={withReset(f.setFilterStatuses)}
            />
            <FilterDropdown
                label="Rep"
                allLabel="Sales rep"
                options={f.repOptions}
                selected={f.filterSalesReps}
                onChange={withReset(f.setFilterSalesReps)}
                searchable
                note={f.repNote}
                renderValue={(sel, labelOf) => (sel.length === 1 ? labelOf(sel[0]) : `${sel.length} reps`)}
            />
            {f.scoped.locations.length > 0 && (
                <FilterDropdown
                    label="Location"
                    options={orderLocations(f.scoped.locations, homeLocationOf(user)).map(l => ({ value: l, label: l === homeLocationOf(user) ? `${l} · Home` : l }))}
                    selected={f.filterLocations}
                    onChange={withReset(f.setFilterLocations)}
                    note={f.locationNote}
                />
            )}
            <FilterDropdown label="City" options={uniqueCities.map(c => ({ value: c, label: c }))} selected={f.filterCities} onChange={withReset(f.setFilterCities)} searchable />
            {canProfile && <FilterDropdown label="Level" options={LEVELS.map(l => ({ value: l, label: l }))} selected={f.filterLevels} onChange={withReset(f.setFilterLevels)} />}
            {!isFabTab && (
                <FilterDropdown label="Type" options={PARTNER_TYPES.map(t => ({ value: t, label: t }))} selected={f.filterTypes} onChange={withReset(f.setFilterTypes)} />
            )}
            {canProfile && <FilterDropdown label="Moda Resources" options={MODA_OPTIONS} selected={f.filterModa} onChange={withReset(f.setFilterModa)} align="right" />}
        </>
    );
}
