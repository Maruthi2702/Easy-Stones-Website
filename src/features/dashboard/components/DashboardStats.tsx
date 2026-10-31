import { useState } from 'react';
import { UserPlus, FolderPlus, Clock, Calendar, ChevronDown } from 'lucide-react';
import { RANGES, rangeFooter, rangeLabel } from '../dashboardFocus';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import '../../../components/shared/form/FormModal.css';
import type { Loose } from '../../../types/records';
import './DashboardFocus.css';

/**
 * The Dashboard's time range (design "Option A"): a segmented control in the
 * header on wide screens, one button opening a bottom sheet under 640px. One
 * range for every tab and tile (Follow-ups reads it by due date). Custom asks
 * for From / To days (the shared DatePicker) and applies them together.
 */
export type DashboardRangeProps = {
    value: string;
    /** Custom's days, YYYY-MM-DD ('' = open). */
    from?: string;
    to?: string;
    onChange: (id: string, from?: string, to?: string) => void;
};

function CustomDays({ from, to, onApply }: { from: string; to: string; onApply: (from: string, to: string) => void }) {
    const [a, setA] = useState(from);
    const [b, setB] = useState(to);
    return (
        <div className="dfx-custom fm-tokens">
            <div className="dfx-custom-days">
                <DatePicker ariaLabel="From" placeholder="From" value={a} onChange={setA} max={b || undefined} clearable sheetTitle="From" />
                <DatePicker ariaLabel="To" placeholder="To" value={b} onChange={setB} min={a || undefined} clearable sheetTitle="To" />
            </div>
            <button type="button" className="dfx-custom-apply" disabled={!a && !b} onClick={() => onApply(a, b)}>Apply</button>
        </div>
    );
}

/** What the segmented bar offers; All time and Custom are in the Filters panel (RangeFilterGroup). */
const BAR_RANGES = RANGES.filter(r => r.id !== 'all' && r.id !== 'custom');

/** The Filters panel's time-range part: All time, or Custom From / To. */
export const RangeFilterGroup = ({ value, from = '', to = '', onChange }: DashboardRangeProps) => {
    // Custom only reveals its days; nothing changes until Apply.
    const [customOpen, setCustomOpen] = useState(value === 'custom');
    return (
        <div className="lf-group" role="group" aria-label="More time ranges">
            <span className="lf-group-label">Time range</span>
            <div className="dfx-range-more">
                <button type="button" aria-pressed={value === 'all'} className={value === 'all' ? 'is-on' : ''} onClick={() => { setCustomOpen(false); onChange('all'); }}>All time</button>
                <button type="button" aria-pressed={value === 'custom'} aria-expanded={customOpen} className={value === 'custom' ? 'is-on' : ''} onClick={() => setCustomOpen(o => !o)}>Custom</button>
            </div>
            {customOpen && <CustomDays key={`${from}|${to}`} from={from} to={to} onApply={(a, b) => onChange('custom', a, b)} />}
        </div>
    );
};

export const DashboardRange = ({ value, from = '', to = '', onChange }: DashboardRangeProps) => {
    const [open, setOpen] = useState(false);
    const [sheetCustom, setSheetCustom] = useState(false);
    const label = rangeLabel(value, from, to);

    return (
        <>
            <div className="dfx-range" role="group" aria-label="Time range">
                {BAR_RANGES.map(r => (
                    <button
                        key={r.id}
                        type="button"
                        aria-pressed={value === r.id}
                        className={value === r.id ? 'is-on' : ''}
                        onClick={() => onChange(r.id)}
                    >{r.short}</button>
                ))}
                {/* All and Custom live in the Filters panel; the bar just says one is on. */}
                {!BAR_RANGES.some(r => r.id === value) && <span className="dfx-range-now is-on">{label}</span>}
            </div>
            <button
                type="button"
                className="dfx-range-phone"
                aria-haspopup="dialog"
                aria-label={`Time range: ${label}`}
                onClick={() => { setSheetCustom(value === 'custom'); setOpen(true); }}
            >
                <Calendar size={16} aria-hidden="true" />
                <span>{label}</span>
                <ChevronDown size={16} aria-hidden="true" />
            </button>
            {open && (
                <div className="dfx-sheet-wrap">
                    <button type="button" className="dfx-sheet-backdrop" aria-label="Close" onClick={() => setOpen(false)} />
                    <div className="dfx-sheet" role="dialog" aria-modal="true" aria-label="Time range">
                        <div className="dfx-sheet-grip" aria-hidden="true" />
                        <h2>Show from</h2>
                        {RANGES.map(r => (
                            <button
                                key={r.id}
                                type="button"
                                role="radio"
                                aria-checked={r.id === 'custom' ? sheetCustom : value === r.id && !sheetCustom}
                                className={(r.id === 'custom' ? sheetCustom : value === r.id && !sheetCustom) ? 'is-on' : ''}
                                onClick={() => (r.id === 'custom' ? setSheetCustom(true) : (onChange(r.id), setOpen(false)))}
                            >
                                <span>{r.id === 'custom' && value === 'custom' ? `Custom · ${label}` : r.label}</span>
                                <span className="dfx-sheet-ring" aria-hidden="true" />
                            </button>
                        ))}
                        {sheetCustom && <CustomDays from={from} to={to} onApply={(a, b) => { onChange('custom', a, b); setOpen(false); }} />}
                    </div>
                </div>
            )}
        </>
    );
};

export type DashboardStatsProps = {
    stats: Loose;
    statsLoading: boolean;
    dashboardTimeRange: string;
    /** Custom's days (the tiles' footer reads "Oct 1 – Oct 31"). */
    rangeFrom?: string;
    rangeTo?: string;
    activeDashboardTab: string;
    setActiveDashboardTab: (tab: string) => void;
    todayScheduleCount: number;
};

const DashboardStats = ({
    stats,
    statsLoading,
    dashboardTimeRange,
    rangeFrom = '',
    rangeTo = '',
    activeDashboardTab,
    setActiveDashboardTab,
    todayScheduleCount
}: DashboardStatsProps) => {
    const footer = rangeFooter(dashboardTimeRange, rangeFrom, rangeTo);
    const cards: { id: string; title: string; short?: string; Icon: typeof UserPlus; value: unknown; footer: string }[] = [
        { id: 'visits', title: 'SALES VISITS', Icon: UserPlus, value: stats.visits, footer },
        { id: 'resources', title: 'RESOURCES', short: 'RESOURCES', Icon: FolderPlus, value: stats.resources, footer },
        { id: 'followups', title: 'FOLLOW-UP', Icon: Clock, value: stats.followUp, footer },
        { id: 'planner', title: 'CALENDAR', Icon: Calendar, value: todayScheduleCount, footer: 'Today' }
    ];
    return (
        <div className="dfx-cards">
            {cards.map(({ id, title, short, Icon, value, footer: foot }) => (
                <button
                    key={id}
                    type="button"
                    className={`dfx-card${activeDashboardTab === id ? ' is-on' : ''}`}
                    aria-pressed={activeDashboardTab === id}
                    onClick={() => setActiveDashboardTab(id)}
                >
                    <span className="dfx-card-icon" aria-hidden="true"><Icon size={19} /></span>
                    <span className="dfx-card-text">
                        <span className="dfx-card-title">{title === 'SALES VISITS' ? <><span className="dfx-long">SALES </span>VISITS</> : (short || title)}</span>
                        <span className="dfx-card-value">{statsLoading ? '…' : (value as React.ReactNode)}</span>
                    </span>
                    <span className="dfx-card-foot">{foot}</span>
                </button>
            ))}
        </div>
    );
};

export default DashboardStats;
