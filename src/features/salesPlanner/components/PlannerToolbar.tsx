import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { DatePicker, MonthPicker } from '../../../components/shared/calendar/Calendar';
import { withMonth } from '../../../components/shared/calendar/calendarDates';
import type { StopMove } from '../useMoveStop';
import { dayKey, parseISOLocal, type ViewMode } from '../salesPlanner';

export type PlannerToolbarProps = {
    viewMode: ViewMode; currentDate: Date; titleLabel: string; todayCount: number | null; edgeDir: number;
    navHoverProps: StopMove['navHoverProps'];
    onPrev: () => void; onNext: () => void; onToday: () => void;
    onViewMode: (mode: ViewMode) => void;
    onDate: (date: Date) => void;
    onNew: () => void;
};

/** Back / Day·Week·Month / forward, Today, the title's calendar, today's count, and Schedule Activity. */
export default function PlannerToolbar({ viewMode, currentDate, titleLabel, todayCount, edgeDir, navHoverProps, onPrev, onNext, onToday, onViewMode, onDate, onNew }: PlannerToolbarProps) {
    return (
        <div className="pl-toolbar">
            <div className="pl-toolbar-left">
                <div className="pl-nav">
                    <button
                        type="button"
                        onClick={onPrev}
                        className={`pl-navbtn${edgeDir < 0 ? ' is-edge' : ''}`}
                        aria-label="Previous"
                        {...navHoverProps(-1)}
                    >
                        <ChevronLeft size={18} />
                    </button>
                    <div className="pl-views" role="group" aria-label="Calendar view">
                        {([['day', 'Day'], ['week', 'Week'], ['month', 'Month']] as [ViewMode, string][]).map(([mode, label]) => (
                            <button
                                key={mode}
                                type="button"
                                className={`pl-viewbtn${viewMode === mode ? ' is-on' : ''}`}
                                aria-pressed={viewMode === mode}
                                onClick={() => onViewMode(mode)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={onNext}
                        className={`pl-navbtn${edgeDir > 0 ? ' is-edge' : ''}`}
                        aria-label="Next"
                        {...navHoverProps(1)}
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>

                <button type="button" className="pl-today" onClick={onToday}>Today</button>

                {/* The title opens the calendar: pick any day (or month, in
                    the Month view) to jump there. */}
                <div className="pl-title-wrap">
                    {viewMode === 'month' ? (
                        <MonthPicker
                            variant="bare"
                            triggerClassName="pl-title"
                            value={dayKey(currentDate).slice(0, 7)}
                            formatText={() => titleLabel}
                            onChange={(ym) => ym && onDate(parseISOLocal(withMonth(dayKey(currentDate), ym)))}
                            ariaLabel="Month shown"
                            sheetTitle="Go to month"
                        />
                    ) : (
                        <DatePicker
                            variant="bare"
                            triggerClassName="pl-title"
                            value={dayKey(currentDate)}
                            highlightWeek={viewMode === 'week'}
                            formatText={() => titleLabel}
                            onChange={(iso) => iso && onDate(parseISOLocal(iso))}
                            ariaLabel={viewMode === 'week' ? 'Week shown' : 'Day shown'}
                            sheetTitle="Go to date"
                        />
                    )}
                </div>

                {todayCount !== null && todayCount > 0 && (
                    <span className="pl-chip">
                        {todayCount} {todayCount === 1 ? 'stop' : 'stops'} today
                    </span>
                )}
            </div>

            <button className="pl-new" type="button" onClick={onNew}>
                <Plus size={18} /> Schedule Activity
            </button>
        </div>
    );
}
