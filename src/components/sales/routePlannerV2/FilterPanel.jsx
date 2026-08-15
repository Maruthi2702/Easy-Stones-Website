import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Filter, X } from 'lucide-react';
import './FilterPanel.css';

// A separate small hue family from the recency ramp (red/orange/yellow/gray)
// on purpose — type and recency are two different filter dimensions shown in
// two different sections of this same panel, and reusing recency's colours
// here would make a blue-ish "Contractor" row look like it was claiming some
// recency meaning it isn't.
const TYPE_PALETTE = ['#3b6ea5', '#4a8f6b', '#8a5fb0', '#b0793f', '#5f7a8a', '#a0637a'];
const BLANK_COLOR = '#6b6b68';

const Section = ({ title, open, onToggle, children }) => (
    <div className="rpv2-filter-section">
        <button type="button" className="rpv2-filter-section-head" onClick={onToggle} aria-expanded={open}>
            <span>{title}</span>
            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {open && <div className="rpv2-filter-section-body">{children}</div>}
    </div>
);

const CheckRow = ({ label, count, on, color, onClick }) => (
    <button
        type="button"
        className="rpv2-filter-row"
        style={color ? { background: `${color}2e`, borderColor: `${color}55` } : undefined}
        onClick={onClick}
        aria-pressed={on}
    >
        <span className={`rpv2-filter-checkbox ${on ? 'is-on' : ''}`} style={on && color ? { background: color, borderColor: color } : undefined} aria-hidden="true">
            {on && '✓'}
        </span>
        <span className="rpv2-filter-row-label">{label}</span>
        {count !== undefined && <span className="rpv2-filter-row-count">{count}</span>}
    </button>
);

/**
 * "Filter by", opened from the funnel icon in the top bar — the same
 * rpv2-panel fixed right column info/leadInfo/Tools already use, not
 * a new floating popover, so there's one predictable place detail vs. list
 * vs. filter surfaces all land. Type filter is genuinely new (the funnel
 * used to open a single-select CustomSelect for customer type — this
 * replaces that with the same multi-select on/off shape activeBuckets
 * already uses for recency); the "days since last visit" and "sales rep"
 * sections just gather filters that already existed elsewhere into one
 * place, rather than inventing filter dimensions (parent location, days
 * until follow-up, ...) the app has no data or state for yet.
 */
const FilterPanel = ({
    onClose,
    types, activeTypes, typeCounts, onToggleType, onToggleAllTypes,
    recencyBuckets, colors, activeBuckets, recencyCounts, onToggleBucket,
    salesRepOptions, activeSalesReps, repCounts, onToggleSalesRep, onToggleAllSalesReps
}) => {
    const [typeOpen, setTypeOpen] = useState(true);
    const [recencyOpen, setRecencyOpen] = useState(false);
    const [repOpen, setRepOpen] = useState(false);

    const allTypeKeys = [...types, '(blank)'];
    const allTypesOn = allTypeKeys.every(t => activeTypes[t] !== false);
    const allRepsOn = salesRepOptions.every(r => activeSalesReps[r.key] === true);

    return (
        <div className="rpv2-panel" data-dialog="filters">
            <div className="rpv2-panel-head">
                <div className="rpv2-panel-head-top">
                    <Filter size={16} />
                    <span className="rpv2-panel-head-title">Filter by</span>
                    <button type="button" className="rpv2-panel-close" onClick={onClose} aria-label="Close">
                        <X size={18} />
                    </button>
                </div>
            </div>

            <div className="rpv2-panel-body rpv2-filter-body">
                <Section title="Type filter" open={typeOpen} onToggle={() => setTypeOpen(v => !v)}>
                    {types.map((type, i) => (
                        <CheckRow
                            key={type}
                            label={type}
                            count={typeCounts[type] ?? 0}
                            on={activeTypes[type] !== false}
                            color={TYPE_PALETTE[i % TYPE_PALETTE.length]}
                            onClick={() => onToggleType(type)}
                        />
                    ))}
                    <CheckRow
                        label="(blank)"
                        count={typeCounts['(blank)'] ?? 0}
                        on={activeTypes['(blank)'] !== false}
                        color={BLANK_COLOR}
                        onClick={() => onToggleType('(blank)')}
                    />
                    <button type="button" className="rpv2-filter-toggle-all" onClick={() => onToggleAllTypes(!allTypesOn)}>
                        {allTypesOn ? 'Toggle all off' : 'Toggle all on'}
                    </button>
                </Section>

                <Section title="Days since last visit filter" open={recencyOpen} onToggle={() => setRecencyOpen(v => !v)}>
                    {recencyBuckets.map(bucket => (
                        <CheckRow
                            key={bucket.key}
                            label={bucket.label}
                            count={recencyCounts[bucket.key] ?? 0}
                            on={activeBuckets[bucket.key]}
                            color={colors[bucket.key]}
                            onClick={() => onToggleBucket(bucket.key)}
                        />
                    ))}
                </Section>

                <Section title="Sales rep filter" open={repOpen} onToggle={() => setRepOpen(v => !v)}>
                    {salesRepOptions.map(rep => (
                        <CheckRow
                            key={rep.key}
                            label={rep.label}
                            count={repCounts[rep.key] ?? 0}
                            on={activeSalesReps[rep.key] === true}
                            onClick={() => onToggleSalesRep(rep.key)}
                        />
                    ))}
                    <button type="button" className="rpv2-filter-toggle-all" onClick={() => onToggleAllSalesReps(!allRepsOn)}>
                        {allRepsOn ? 'Toggle all off' : 'Toggle all on'}
                    </button>
                </Section>

                <p className="rpv2-filter-hint">
                    Use filters to narrow down which customers show up on the map.
                </p>
            </div>
        </div>
    );
};

export default FilterPanel;
