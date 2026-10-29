import { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { toCustomerOptions, type CustomerOption } from '../../utils/customerOptions';
import type { Loose } from '../../types/records';
import useSalesPlannerData from './useSalesPlannerData';
import useActivityEditor from './useActivityEditor';
import useEdgeFlip from './useEdgeFlip';
import useMoveStop from './useMoveStop';
import { ACTIVITY_COLORS, activityColor, customerName, dayKey, isCurrentPeriod, isSameDay, relativeDayLabel, timeLabel, titleFor } from './salesPlanner';
import PlannerToolbar from './components/PlannerToolbar';
import DayColumn from './components/DayColumn';
import WeekendRail from './components/WeekendRail';
import MonthGrid from './components/MonthGrid';
import ActivityDialog from './components/ActivityDialog';
import DeleteActivityDialog from './components/DeleteActivityDialog';

/**
 * The sales planner.
 *
 * The working week is Monday to Friday and those five days get the full width —
 * squeezing in two days nobody books was costing the readability of the five
 * that are. But a weekend booking is still real: it comes in from the calendar
 * sync, or somebody agrees to a Saturday walkthrough. So Saturday and Sunday sit
 * in a slim rail beside the week rather than being dropped, which is what the
 * old Mon-Fri loop did — silently, with no way to tell from the screen that
 * anything was missing.
 *
 * Every day carries its own + button. Booking Wednesday should not mean opening
 * a form and re-picking a date the calendar already knew. The same goes for
 * moving one: a stop can be dragged onto another day, which is the same edit
 * with the calendar as the input rather than a date field inside a modal.
 *
 * The schedule itself is not held here — it lives in ./plannerSchedule,
 * because the dashboard unmounts this component every time another tab is
 * shown. See that module for what survives the unmount and how a change made
 * elsewhere finds its way onto this screen.
 *
 * The parts: useSalesPlannerData (the day, view and schedule on screen),
 * useActivityEditor (the add / edit form and the delete check), useEdgeFlip and
 * useMoveStop (moving a stop by mouse, finger or keyboard), the pure rules in
 * salesPlanner.ts, and the views in components/.
 */

export type SalesPlannerTabProps = {
    customerSelection?: Loose[]; customerOptions?: Loose[];
    onSelectCustomer?: (customer: Loose) => void; onScheduleChange?: () => void;
    isDropdownLoading?: boolean; currentUserId?: string | null;
};

const SalesPlannerTab = ({ customerSelection = [], customerOptions = [], onSelectCustomer, onScheduleChange, isDropdownLoading, currentUserId = null }: SalesPlannerTabProps) => {
    const data = useSalesPlannerData(currentUserId);
    const { currentDate, setCurrentDate, viewMode, setViewMode, today, itemsFor, weekdays, weekendDays, monthWeeks, todayCount, loading, loadError, refresh, stepPeriod } = data;
    const editor = useActivityEditor(onScheduleChange);
    const edge = useEdgeFlip(stepPeriod);
    const { edgeDir, scrollRef } = edge;
    const move = useMoveStop({ ...data, edge, onScheduleChange });
    const { drag, ghostRef, announcement, moveError, clearMoveError } = move;

    const effectiveCustomerOptions = useMemo(() => {
        if (customerOptions && customerOptions.length > 0) return customerOptions as CustomerOption[];
        // Same options as every other customer dropdown (customerOptions.js).
        return toCustomerOptions(customerSelection || []);
    }, [customerSelection, customerOptions]);

    const titleLabel = useMemo(() => titleFor(viewMode, currentDate), [viewMode, currentDate]);

    const weekendItemCount = weekendDays.reduce((n, d) => n + itemsFor(d).length, 0);
    const weekendHasToday = weekendDays.some(d => isSameDay(d, today));
    const weekendQuiet = weekendItemCount === 0 && !weekendHasToday;

    const cardActions = { move, onSelectCustomer, onEdit: editor.openEdit, onDelete: editor.handleDelete };
    const dayProps = { today, loading, onAdd: editor.openAdd, ...cardActions };

    return (
        <div className="pl-wrap">
            <PlannerToolbar
                viewMode={viewMode}
                currentDate={currentDate}
                titleLabel={titleLabel}
                todayCount={todayCount}
                dayLabel={relativeDayLabel(currentDate, today)}
                dayCount={itemsFor(currentDate).length}
                isCurrent={isCurrentPeriod(currentDate, viewMode, today)}
                edgeDir={edgeDir}
                navHoverProps={move.navHoverProps}
                onPrev={() => stepPeriod(-1)}
                onNext={() => stepPeriod(1)}
                onToday={() => setCurrentDate(new Date())}
                onViewMode={setViewMode}
                onDate={setCurrentDate}
                onNew={() => editor.openAdd(null)}
            />

            {loadError && (
                <div className="pl-error" role="alert">
                    <AlertCircle size={16} />
                    <span>{loadError}</span>
                    <button type="button" onClick={refresh}>Try again</button>
                </div>
            )}

            {moveError && (
                <div className="pl-error" role="alert">
                    <AlertCircle size={16} />
                    <span>{moveError}</span>
                    <button type="button" onClick={clearMoveError}>Dismiss</button>
                </div>
            )}

            <div
                className="pl-scroll"
                ref={scrollRef}
                onDragOver={move.onScrollDragOver}
            >
                {viewMode === 'day' && (
                    <div className="pl-grid pl-grid--day">
                        <DayColumn key={dayKey(currentDate)} day={currentDate} items={itemsFor(currentDate)} {...dayProps} />
                    </div>
                )}

                {viewMode === 'week' && (
                    <div className={`pl-grid pl-grid--week${weekendQuiet ? ' is-quiet-weekend' : ''}`}>
                        {weekdays.map(day => <DayColumn key={dayKey(day)} day={day} items={itemsFor(day)} {...dayProps} />)}
                        <WeekendRail days={weekendDays} itemsFor={itemsFor} quiet={weekendQuiet} hasToday={weekendHasToday} {...dayProps} />
                    </div>
                )}

                {viewMode === 'month' && (
                    <MonthGrid
                        weeks={monthWeeks}
                        currentDate={currentDate}
                        today={today}
                        itemsFor={itemsFor}
                        move={move}
                        onAdd={editor.openAdd}
                        onEdit={editor.openEdit}
                        onShowDay={(day) => { setCurrentDate(new Date(day)); setViewMode('day'); }}
                    />
                )}
            </div>

            {/* A finger has no drag image of its own, and the card it picked up
                is somewhere under it. This is what it is holding. */}
            {drag?.source === 'touch' && (
                <div className="pl-ghost" ref={ghostRef} aria-hidden="true">
                    <span
                        className="pl-typedot"
                        style={{ background: activityColor(drag.item.activityType) }}
                    />
                    <span className="pl-ghost-name">{customerName(drag.item)}</span>
                    <span className="pl-ghost-time">{timeLabel(drag.item.startTime)}</span>
                </div>
            )}

            {/* A keyboard move happens entirely off screen for anyone using a
                reader — this is the only place it is spoken. */}
            <div className="pl-live" role="status" aria-live="polite">{announcement}</div>

            <div className="pl-legend">
                {Object.keys(ACTIVITY_COLORS).map(type => (
                    <span className="pl-lg" key={type}>
                        <span className="pl-typedot" style={{ background: ACTIVITY_COLORS[type] }} aria-hidden="true" />
                        {type}
                    </span>
                ))}
            </div>

            {editor.showAddModal && (
                <ActivityDialog editor={editor} customerOptions={effectiveCustomerOptions} isDropdownLoading={isDropdownLoading} itemsFor={itemsFor} />
            )}

            {editor.showDeleteModal && (
                <DeleteActivityDialog onClose={editor.closeDelete} onConfirm={editor.confirmDelete} />
            )}
        </div>
    );
};

export default SalesPlannerTab;
