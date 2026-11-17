import { useId, useState } from 'react';
import { ChevronLeft, ChevronRight, Route, Search, X } from 'lucide-react';
import { DatePicker, MonthPicker } from '../../../components/shared/calendar/Calendar';
import { withMonth } from '../../../components/shared/calendar/calendarDates';
import type { StopMove } from '../useMoveStop';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import { dayKey, parseISOLocal, shortDayTitle, type ViewMode } from '../salesPlanner';

export type PlannerToolbarProps = {
    viewMode: ViewMode; currentDate: Date; titleLabel: string; todayCount: number | null; edgeDir: number;
    /** The Day view's subtitle: 'Today' / 'Tomorrow' / 'Yesterday' (or null) and how many stops that day holds. */
    dayLabel: string | null; dayCount: number;
    /** The hours the day's stops span ('11:25 AM – 3:20 PM'); the phone's summary line adds it. */
    daySpan?: string;
    /** The day, week or month on screen holds today (the phone hides its Today button then). */
    isCurrent: boolean;
    navHoverProps: StopMove['navHoverProps'];
    onPrev: () => void; onNext: () => void; onToday: () => void;
    onViewMode: (mode: ViewMode) => void;
    onDate: (date: Date) => void;
    /**
     * The dashboard's search box, at the end of the toolbar (under Day / Week / Month
     * on a phone). Adding is the dashboard's round +, not a button here (owner, 2026-10-31).
     */
    searchBox?: React.ReactNode;
    searchActive?: boolean;
    /** Day view only: re-order the day's stops by location. Absent when the day isn't yours to arrange. */
    onOptimize?: () => void;
    /** The day holds at least two of your stops. */
    canOptimize?: boolean;
    /** Month view on a phone: how many stops the month holds (the line under the title). */
    monthCount?: number;
};

/** Day · Week · Month; a phone has no Week (the month grid and the date picker cover it). */
const VIEWS: [ViewMode, string][] = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const PHONE_VIEWS_FILTER = (phone: boolean) => (phone ? VIEWS.filter(([mode]) => mode !== 'week') : VIEWS);

/** Back / Day·Week·Month / forward, Today, the title's calendar, today's count, and the search box. */
export default function PlannerToolbar({ viewMode, currentDate, titleLabel, todayCount, edgeDir, dayLabel, dayCount, daySpan = '', isCurrent, navHoverProps, onPrev, onNext, onToday, onViewMode, onDate, searchBox = null, searchActive = false, onOptimize, canOptimize = false, monthCount = 0 }: PlannerToolbarProps) {
    // The long day ("Thursday, October 29, 2026") doesn't fit between the arrows on a phone.
    const phone = useIsPhone();
    const [searchOpen, setSearchOpen] = useState(false);
    const searchId = useId();
    const shownTitle = phone && viewMode === 'day' ? shortDayTitle(currentDate) : titleLabel;
    return (
        <div className="pl-toolbar" data-view={viewMode} data-here={isCurrent ? 'true' : 'false'}>
            <div className="pl-toolbar-left">
                <div className="pl-nav">
                    {!phone && (
                    <button
                        type="button"
                        onClick={onPrev}
                        className={`pl-navbtn${edgeDir < 0 ? ' is-edge' : ''}`}
                        aria-label="Previous"
                        {...navHoverProps(-1)}
                    >
                        <ChevronLeft size={18} />
                    </button>
                    )}
                    <div className="pl-views" role="group" aria-label="Calendar view">
                        {(PHONE_VIEWS_FILTER(phone)).map(([mode, label]) => (
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
                    {!phone && (
                    <button
                        type="button"
                        onClick={onNext}
                        className={`pl-navbtn${edgeDir > 0 ? ' is-edge' : ''}`}
                        aria-label="Next"
                        {...navHoverProps(1)}
                    >
                        <ChevronRight size={18} />
                    </button>
                    )}
                </div>

                {!phone && <button type="button" className="pl-today" data-here={isCurrent ? 'true' : 'false'} onClick={onToday}>Today</button>}

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
                            formatText={() => shownTitle}
                            onChange={(iso) => iso && onDate(parseISOLocal(iso))}
                            ariaLabel={viewMode === 'week' ? 'Week shown' : 'Day shown'}
                            sheetTitle="Go to date"
                        />
                    )}
                </div>

                {viewMode === 'day' && (
                    <span className="pl-sub">
                        {dayLabel === 'Today' ? <span className="pl-sub-tag">Today</span> : dayLabel && <>{dayLabel} · </>}
                        {dayCount === 0 ? 'No stops' : `${dayCount} ${dayCount === 1 ? 'stop' : 'stops'}`}
                        {daySpan && <span className="pl-sub-span"> · {daySpan}</span>}
                    </span>
                )}

                {phone && viewMode === 'month' && (
                    <span className="pl-sub">{monthCount === 0 ? 'No stops this month' : `${monthCount} ${monthCount === 1 ? 'stop' : 'stops'} this month`}</span>
                )}

                {viewMode === 'day' && onOptimize && (
                    <button type="button" className="pl-today pl-optimize" onClick={onOptimize} disabled={!canOptimize}
                        title={canOptimize ? 'Put this day\'s stops in driving order' : 'Needs two or more of your stops on this day'}>
                        <Route size={14} aria-hidden="true" /> Optimize<span className="pl-opt-long"> route</span>
                    </button>
                )}

                {todayCount !== null && todayCount > 0 && (
                    <span className="pl-chip">
                        {todayCount} {todayCount === 1 ? 'stop' : 'stops'} today
                    </span>
                )}
            </div>

            {phone && searchBox && (
                <button type="button" className={`pl-search-toggle${searchActive ? ' has-value' : ''}`}
                    aria-label={`${searchOpen ? 'Hide calendar search' : 'Search calendar'}${searchActive ? ' (filter active)' : ''}`}
                    aria-expanded={searchOpen} aria-controls={searchId} onClick={() => setSearchOpen(value => !value)}>
                    {searchOpen ? <X size={18} /> : <Search size={18} />}
                </button>
            )}
            {searchBox && <div id={searchId} className="pl-search" hidden={phone && !searchOpen}>{searchBox}</div>}
        </div>
    );
}
