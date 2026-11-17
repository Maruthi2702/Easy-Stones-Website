import { Plus, Route } from 'lucide-react';
import type { PlannerItem } from '../plannerSchedule';
import { addLabel, daySummary, isSameDay } from '../salesPlanner';
import DayStops from './DayStops';
import type { CardActions } from './PlannerCard';

const Skeleton = ({ count }: { count: number }) => (
    <>
        {Array.from({ length: count }, (_, i) => (
            <div key={i} className="pl-skcard" aria-hidden="true">
                <span className="pl-sk" style={{ width: `${70 - i * 12}%` }} />
                <span className="pl-sk pl-sk--thin" style={{ width: `${44 - i * 8}%` }} />
            </div>
        ))}
    </>
);

export type DayColumnProps = {
    day: Date; items: PlannerItem[]; today: Date; loading: boolean; compact?: boolean;
    /** Absent on a team calendar you aren't in: no + buttons. */
    onAdd?: (day: Date) => void;
    /** The Week view's route icon: put this day's stops in driving order. Absent when the day isn't yours to arrange. */
    onOptimize?: (day: Date) => void;
} & CardActions;

/** One weekday (or the Day view's one day): its head with the + button, then its stops. */
export default function DayColumn({ day, items, today, loading, compact = false, onAdd, onOptimize, ...actions }: DayColumnProps) {
    const isToday = isSameDay(day, today);
    const summary = daySummary(items);
    // Two or more of your own stops that are still on (the same rule as the Day view's button).
    const optimizable = items.filter(i => (actions.editable ? actions.editable(i) : true) && i.status !== 'Cancelled').length >= 2;
    return (
        <div
            className={`pl-col${isToday ? ' is-today' : ''}${actions.move.dropClass(day)}`}
            {...actions.move.dayDropProps(day)}
        >
            <div className="pl-colhead">
                <span className="pl-headleft">
                    <span className="pl-dnum">{day.getDate()}</span>
                    <span className="pl-dow">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                    {isToday && <span className="pl-todaytag">Today</span>}
                </span>
                <span className="pl-headright">
                    {onOptimize && optimizable && (
                    <button
                        type="button"
                        className="pl-optday"
                        onClick={() => onOptimize(day)}
                        title="Put this day's stops in driving order"
                        aria-label={`Optimize route for ${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
                    >
                        <Route size={14} />
                    </button>
                    )}
                    {onAdd && (
                    <button
                        type="button"
                        className="pl-addday"
                        onClick={() => onAdd(day)}
                        title={addLabel(day)}
                        aria-label={addLabel(day)}
                    >
                        <Plus size={14} />
                    </button>
                    )}
                </span>
            </div>
            {summary.count > 0 && (
                <div className="pl-daysum">
                    <span>{summary.count} {summary.count === 1 ? 'stop' : 'stops'}{summary.span && ` · ${summary.span}`}</span>
                    <i aria-hidden="true"><b style={{ width: `${summary.fill}%` }} /></i>
                </div>
            )}
            <div className="pl-colbody">
                {loading && items.length === 0
                    ? <Skeleton count={compact ? 1 : 2} />
                    : items.length > 0
                        ? <DayStops day={day} items={items} {...actions} />
                        : onAdd ? (
                            <button type="button" className="pl-empty" onClick={() => onAdd(day)} title={addLabel(day)}>
                                <Plus size={14} />
                                <span>Add a stop</span>
                            </button>
                        ) : <div className="pl-empty pl-empty--quiet">No stops</div>}
            </div>
        </div>
    );
}
