import React, { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Filter, Search, X } from 'lucide-react';
import { typeColors } from '../helpers';
import type { ColorMode, RecencyBucket, RecencyColors, RepOption, Toggles } from '../types';
import './FilterPanel.css';

const PIN_PATH = 'M12,2C8.13,2,5,5.13,5,9c0,5.25,7,13,7,13s7,-7.75,7,-13C19,5.13,15.87,2,12,2z';

// The map's pin in miniature — the row's own colour key, drawn the way the
// pin itself is (MapCanvas.tsx), so the legend and the map can't look different.
const PinSwatch = ({ color, dim }: { color: string; dim: boolean }) => (
    <svg className="rpv2-filter-pin" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ opacity: dim ? 0.3 : 1 }}>
        <path d={PIN_PATH} fill={color} stroke="#20201f" strokeWidth="1.6" />
    </svg>
);

type SectionProps = { title: string; summary?: string; open: boolean; onToggle: () => void; children?: ReactNode; actions?: ReactNode };
const Section = ({ title, summary, open, onToggle, children, actions }: SectionProps) => (
    <div className="rpv2-filter-section">
        <div className="rpv2-filter-section-bar">
            <button type="button" className="rpv2-filter-section-head" onClick={onToggle} aria-expanded={open}>
                <span>{title}{summary && <span className="rpv2-filter-section-sum"> {summary}</span>}</span>
                {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
        </div>
        {open && <div className="rpv2-filter-section-body">{actions}{children}</div>}
    </div>
);

// `color`: the row wears this colour (its tint, checkbox and a pin swatch) —
// only for the dimension the map is currently coloured by; the others stay
// plain with a gold checkbox, so the panel itself says what the colours mean.
type CheckRowProps = { label: string; count?: number; on: boolean; color?: string; onClick: () => void };
const CheckRow = ({ label, count, on, color, onClick }: CheckRowProps) => (
    <button
        type="button"
        className="rpv2-filter-row"
        style={color && on ? { background: `${color}2e`, borderColor: `${color}55` } : { background: 'transparent' }}
        onClick={onClick}
        aria-pressed={on}
    >
        <span
            className={`rpv2-filter-checkbox ${on ? 'is-on' : ''}`}
            style={on ? { background: color || '#d4af37', borderColor: color || '#d4af37', color: color && color !== '#F0E442' && color !== '#E69F00' && color !== '#56B4E9' && color !== '#CC79A7' && color !== '#9A9A95' ? '#ffffff' : '#141414' } : undefined}
            aria-hidden="true"
        >
            {on && '✓'}
        </span>
        {color && <PinSwatch color={color} dim={!on} />}
        <span className="rpv2-filter-row-label">{label}</span>
        {count !== undefined && <span className="rpv2-filter-row-count">{count}</span>}
    </button>
);

/**
 * "Filter by", opened from the funnel icon — the fixed right column the info,
 * lead and Tools panels use. Three sections in this order (the owner's call,
 * 2026-10-18): Sales reps (only the reps this person may see, and only the
 * checked ones' customers are loaded — src/utils/routePlannerScope.js), then
 * Customer type, then Days since last visit. The "Colour pins by" switch in
 * the header decides what the pins' colour means; whichever of the two
 * sections it colours shows its colours here, as the map's key.
 */
export type FilterPanelProps = {
    onClose: () => void;
    colorMode: ColorMode;
    onColorModeChange: (mode: ColorMode) => void;
    types: string[];
    activeTypes: Toggles;
    typeCounts: Record<string, number>;
    onToggleType: (type: string) => void;
    onToggleAllTypes: (showAll: boolean) => void;
    recencyBuckets: RecencyBucket[];
    colors: RecencyColors;
    activeBuckets: Toggles;
    recencyCounts: Record<string, number>;
    onToggleBucket: (key: string) => void;
    salesRepOptions: RepOption[];
    activeSalesReps: Toggles;
    repCounts: Record<string, number>;
    onToggleSalesRep: (key: string) => void;
    onToggleAllSalesReps: (showAll: boolean) => void;
    scopeNote: string;
};

const FilterPanel = ({
    onClose,
    colorMode, onColorModeChange,
    types, activeTypes, typeCounts, onToggleType, onToggleAllTypes,
    recencyBuckets, colors, activeBuckets, recencyCounts, onToggleBucket,
    salesRepOptions, activeSalesReps, repCounts, onToggleSalesRep, onToggleAllSalesReps,
    scopeNote
}: FilterPanelProps) => {
    const [repOpen, setRepOpen] = useState(true);
    const [typeOpen, setTypeOpen] = useState(true);
    const [recencyOpen, setRecencyOpen] = useState(true);

    const allTypeKeys = [...types, '(blank)'];
    const typesOn = allTypeKeys.filter(t => activeTypes[t] !== false).length;
    const repsOn = salesRepOptions.filter(r => activeSalesReps[r.key] === true).length;
    const bucketsOn = recencyBuckets.filter(b => activeBuckets[b.key]).length;

    // Search, then reps under their branch — the format every rep filter shares.
    const [repQuery, setRepQuery] = useState('');
    const q = repQuery.trim().toLowerCase();
    const shownReps = q ? salesRepOptions.filter(r => `${r.label} ${r.group || ''}`.toLowerCase().includes(q)) : salesRepOptions;

    const byType = colorMode === 'type';

    return (
        <div className="rpv2-panel" data-dialog="filters">
            <div className="rpv2-panel-head">
                <div className="rpv2-panel-head-top">
                    <Filter size={16} />
                    <span className="rpv2-panel-head-title">Filter by</span>
                    <div className="rpv2-colour-switch" role="group" aria-label="Colour pins by">
                        <button type="button" aria-pressed={byType} className={byType ? 'is-on' : ''} onClick={() => onColorModeChange('type')}>Type colours</button>
                        <button type="button" aria-pressed={!byType} className={!byType ? 'is-on' : ''} onClick={() => onColorModeChange('visit')}>Visit colours</button>
                    </div>
                    <button type="button" className="rpv2-panel-close" onClick={onClose} aria-label="Close">
                        <X size={18} />
                    </button>
                </div>
            </div>

            <div className="rpv2-panel-body rpv2-filter-body">
                <Section
                    title="Sales reps"
                    summary={`${repsOn} of ${salesRepOptions.length}`}
                    open={repOpen}
                    onToggle={() => setRepOpen(v => !v)}
                    actions={(
                        <div className="rpv2-filter-actions">
                            {scopeNote && <span className="rpv2-filter-scope">{scopeNote}</span>}
                            <span className="rpv2-filter-spacer" />
                            <button type="button" className="rpv2-filter-toggle-all" onClick={() => onToggleAllSalesReps(true)}>All</button>
                            <button type="button" className="rpv2-filter-toggle-all" onClick={() => onToggleAllSalesReps(false)}>None</button>
                        </div>
                    )}
                >
                    <label className="rpv2-filter-search">
                        <Search size={14} aria-hidden="true" />
                        <input
                            type="text"
                            className="no-capitalize"
                            value={repQuery}
                            onChange={(e) => setRepQuery(e.target.value)}
                            placeholder="Search reps"
                            aria-label="Search sales reps"
                        />
                    </label>
                    {shownReps.map((rep, i) => (
                        <React.Fragment key={rep.key}>
                            {rep.group && rep.group !== shownReps[i - 1]?.group && (
                                <div className="rpv2-filter-group">{rep.group}</div>
                            )}
                            <CheckRow
                                label={rep.label}
                                count={repCounts[rep.key] ?? 0}
                                on={activeSalesReps[rep.key] === true}
                                onClick={() => onToggleSalesRep(rep.key)}
                            />
                        </React.Fragment>
                    ))}
                    {shownReps.length === 0 && (
                        <p className="rpv2-filter-hint">{q ? `No reps match “${repQuery.trim()}”` : 'No reps to show.'}</p>
                    )}
                </Section>

                <Section
                    title="Customer type"
                    summary={`${typesOn} of ${allTypeKeys.length}`}
                    open={typeOpen}
                    onToggle={() => setTypeOpen(v => !v)}
                >
                    {types.map(type => (
                        <CheckRow
                            key={type}
                            label={type}
                            count={typeCounts[type] ?? 0}
                            on={activeTypes[type] !== false}
                            color={byType ? typeColors(type).color : undefined}
                            onClick={() => onToggleType(type)}
                        />
                    ))}
                    <CheckRow
                        label="No type set"
                        count={typeCounts['(blank)'] ?? 0}
                        on={activeTypes['(blank)'] !== false}
                        color={byType ? typeColors('').color : undefined}
                        onClick={() => onToggleType('(blank)')}
                    />
                    <button type="button" className="rpv2-filter-toggle-all" onClick={() => onToggleAllTypes(typesOn !== allTypeKeys.length)}>
                        {typesOn === allTypeKeys.length ? 'Toggle all off' : 'Toggle all on'}
                    </button>
                </Section>

                <Section
                    title="Days since last visit"
                    summary={`${bucketsOn} of ${recencyBuckets.length}`}
                    open={recencyOpen}
                    onToggle={() => setRecencyOpen(v => !v)}
                >
                    {recencyBuckets.map(bucket => (
                        <CheckRow
                            key={bucket.key}
                            label={bucket.label}
                            count={recencyCounts[bucket.key] ?? 0}
                            on={activeBuckets[bucket.key]}
                            color={!byType ? colors[bucket.key] : undefined}
                            onClick={() => onToggleBucket(bucket.key)}
                        />
                    ))}
                </Section>

                <p className="rpv2-filter-hint">
                    Only the checked reps’ customers are loaded on the map. A faded pin is a customer marked Not interested.
                </p>
            </div>
        </div>
    );
};

export default FilterPanel;
