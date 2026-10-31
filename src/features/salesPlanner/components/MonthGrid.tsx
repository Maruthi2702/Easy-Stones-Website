import { Plus, Check, AlertTriangle } from 'lucide-react';
import type { PlannerItem } from '../plannerSchedule';
import type { StopMove } from '../useMoveStop';
import { activityColor, addLabel, customerName, dayKey, isSameDay, timeLabel, visitFlag } from '../salesPlanner';

export type MonthGridProps = {
    weeks: Date[][]; currentDate: Date; today: Date; itemsFor: (day: Date) => PlannerItem[]; move: StopMove;
    onAdd?: (day: Date) => void;
    onEdit: (item: PlannerItem) => void;
    /** Whether a stop is yours to change; someone else's opens its day instead. */
    editable?: (item: PlannerItem) => boolean;
    /** More than you is on screen: each stop's tooltip says whose it is. */
    showOwner?: boolean;
    /** "+N more": show that day in the Day view. */
    onShowDay: (day: Date) => void;
};

/** The Month view: a cell per day, its first three stops, "+N more" for the rest. */
export default function MonthGrid({ weeks, currentDate, today, itemsFor, move, onAdd, onEdit, editable, showOwner = false, onShowDay }: MonthGridProps) {
    return (
        <div className="pl-month">
            <div className="pl-dowrow" aria-hidden="true">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="pl-monthgrid">
                {weeks.map((week, wi) => (
                    <div className="pl-mrow" key={wi}>
                        {week.map(day => {
                            const items = itemsFor(day);
                            const isToday = isSameDay(day, today);
                            const offMonth = day.getMonth() !== currentDate.getMonth();
                            const shown = items.slice(0, 3);
                            return (
                                <div
                                    key={dayKey(day)}
                                    className={`pl-cell${offMonth ? ' is-off' : ''}${isToday ? ' is-today' : ''}${move.dropClass(day)}`}
                                    {...move.dayDropProps(day, { ordered: false })}
                                >
                                    <div className="pl-cellhead">
                                        <span className="pl-cnum">{day.getDate()}</span>
                                        {onAdd && (
                                        <button
                                            type="button"
                                            className="pl-celladd"
                                            onClick={() => onAdd(day)}
                                            title={addLabel(day)}
                                            aria-label={addLabel(day)}
                                        >
                                            <Plus size={12} />
                                        </button>
                                        )}
                                    </div>
                                    {shown.map(item => {
                                        const flag = visitFlag(item);
                                        const mine = editable ? editable(item) : true;
                                        const drag = move.dragProps(item);
                                        const owner = showOwner && item.ownerName ? ` · ${item.ownerName}` : '';
                                        return (
                                            <button
                                                key={item._id}
                                                type="button"
                                                className={`pl-ev${move.itemState(item)}${flag ? ` is-${flag}` : ''}`}
                                                onClick={() => (mine ? onEdit(item) : onShowDay(day))}
                                                title={`${timeLabel(item.startTime)} · ${customerName(item)}${owner}${flag === 'done' ? ' · Visited' : flag === 'missed' ? ' · Missed' : ''}${'draggable' in drag ? ' — drag to another day, or press Space to move it with the arrow keys' : ''}`}
                                                {...drag}
                                            >
                                                <span
                                                    className="pl-typedot"
                                                    style={{ background: activityColor(item.activityType) }}
                                                    aria-hidden="true"
                                                />
                                                <span className="pl-evtime">{timeLabel(item.startTime)}</span>
                                                <span className="pl-evname">{customerName(item)}</span>
                                                {flag === 'done' && <Check size={10} className="pl-ev-flag pl-ev-flag--done" aria-hidden="true" />}
                                                {flag === 'missed' && <AlertTriangle size={10} className="pl-ev-flag pl-ev-flag--missed" aria-hidden="true" />}
                                            </button>
                                        );
                                    })}
                                    {items.length > shown.length && (
                                        <button
                                            type="button"
                                            className="pl-more"
                                            onClick={() => onShowDay(day)}
                                        >
                                            +{items.length - shown.length} more
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
