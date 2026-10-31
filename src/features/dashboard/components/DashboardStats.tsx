import { useEffect, useRef, useState } from 'react';
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

export const DashboardRange = ({ value, from = '', to = '', onChange }: DashboardRangeProps) => {
    const [open, setOpen] = useState(false);
    const [customOpen, setCustomOpen] = useState(false);
    const [sheetCustom, setSheetCustom] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const label = rangeLabel(value, from, to);

    // The Custom box closes on a click outside it (its calendars float inside it) or Escape.
    useEffect(() => {
        if (!customOpen) return undefined;
        const onDown = (e: Event) => { if (!wrapRef.current?.contains(e.target as Node)) setCustomOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) setCustomOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [customOpen]);

    return (
        <>
            <div className="dfx-range-wrap" ref={wrapRef}>
                <div className="dfx-range" role="group" aria-label="Time range">
                    {RANGES.map(r => (
                        <button
                            key={r.id}
                            type="button"
                            aria-pressed={value === r.id}
                            aria-expanded={r.id === 'custom' ? customOpen : undefined}
                            className={value === r.id ? 'is-on' : ''}
                            onClick={() => (r.id === 'custom' ? setCustomOpen((o) => !o) : (setCustomOpen(false), onChange(r.id)))}
                        >{r.id === 'custom' && value === 'custom' ? label : r.short}</button>
                    ))}
                </div>
                {customOpen && (
                    <div className="dfx-custom-pop" role="dialog" aria-label="Custom range">
                        <CustomDays from={from} to={to} onApply={(a, b) => { onChange('custom', a, b); setCustomOpen(false); }} />
                    </div>
                )}
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
