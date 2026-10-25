import { Plus } from 'lucide-react';
import type { PlannerItem } from '../plannerSchedule';
import { addLabel, isSameDay } from '../salesPlanner';
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
    onAdd: (day: Date) => void;
} & CardActions;

/** One weekday (or the Day view's one day): its head with the + button, then its stops. */
export default function DayColumn({ day, items, today, loading, compact = false, onAdd, ...actions }: DayColumnProps) {
    const isToday = isSameDay(day, today);
    return (
        <div
            className={`pl-col${isToday ? ' is-today' : ''}${actions.move.dropClass(day)}`}
            {...actions.move.dayDropProps(day)}
        >
            <div className="pl-colhead">
                <span className="pl-dow">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <span className="pl-headright">
                    {isToday && <span className="pl-todaytag">Today</span>}
                    <span className="pl-dnum">{day.getDate()}</span>
                    <button
                        type="button"
                        className="pl-addday"
                        onClick={() => onAdd(day)}
                        title={addLabel(day)}
                        aria-label={addLabel(day)}
                    >
                        <Plus size={14} />
                    </button>
                </span>
            </div>
            <div className="pl-colbody">
                {loading && items.length === 0
                    ? <Skeleton count={compact ? 1 : 2} />
                    : items.length > 0
                        ? <DayStops day={day} items={items} {...actions} />
                        : (
                            <button type="button" className="pl-empty" onClick={() => onAdd(day)} title={addLabel(day)}>
                                <Plus size={14} />
                                <span>Add a stop</span>
                            </button>
                        )}
            </div>
        </div>
    );
}
