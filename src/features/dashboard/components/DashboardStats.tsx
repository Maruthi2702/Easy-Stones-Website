import { useState } from 'react';
import { UserPlus, FolderPlus, Clock, Calendar, ChevronDown } from 'lucide-react';
import { RANGES, rangeFooter } from '../dashboardFocus';
import type { Loose } from '../../../types/records';
import './DashboardFocus.css';

/**
 * The Dashboard's time range (design "Option A"): a segmented control in the
 * header on wide screens, one button opening a bottom sheet under 640px.
 */
export type DashboardRangeProps = { value: string; onChange: (id: string) => void };

export const DashboardRange = ({ value, onChange }: DashboardRangeProps) => {
    const [open, setOpen] = useState(false);
    const current = RANGES.find(r => r.id === value) || RANGES[0];
    return (
        <>
            <div className="dfx-range" role="group" aria-label="Time range">
                {RANGES.map(r => (
                    <button
                        key={r.id}
                        type="button"
                        aria-pressed={value === r.id}
                        className={value === r.id ? 'is-on' : ''}
                        onClick={() => onChange(r.id)}
                    >{r.short}</button>
                ))}
            </div>
            <button
                type="button"
                className="dfx-range-phone"
                aria-haspopup="dialog"
                aria-label={`Time range: ${current.label}`}
                onClick={() => setOpen(true)}
            >
                <Calendar size={16} aria-hidden="true" />
                <span>{current.label}</span>
                <ChevronDown size={16} aria-hidden="true" />
            </button>
            {open && (
                <div className="dfx-sheet-wrap">
                    <button type="button" className="dfx-sheet-backdrop" aria-label="Close" onClick={() => setOpen(false)} />
                    <div className="dfx-sheet" role="dialog" aria-modal="true" aria-label="Time range">
                        <div className="dfx-sheet-grip" aria-hidden="true" />
                        <h2>Show visits from</h2>
                        {RANGES.map(r => (
                            <button
                                key={r.id}
                                type="button"
                                role="radio"
                                aria-checked={value === r.id}
                                className={value === r.id ? 'is-on' : ''}
                                onClick={() => { onChange(r.id); setOpen(false); }}
                            >
                                <span>{r.label}</span>
                                <span className="dfx-sheet-ring" aria-hidden="true" />
                            </button>
                        ))}
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
    activeDashboardTab: string;
    setActiveDashboardTab: (tab: string) => void;
    todayScheduleCount: number;
};

const DashboardStats = ({
    stats,
    statsLoading,
    dashboardTimeRange,
    activeDashboardTab,
    setActiveDashboardTab,
    todayScheduleCount
}: DashboardStatsProps) => {
    const footer = rangeFooter(dashboardTimeRange);
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
