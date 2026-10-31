import { Plus } from 'lucide-react';
import type { PlannerItem } from '../plannerSchedule';
import { addLabel, dayKey, isSameDay } from '../salesPlanner';
import DayStops from './DayStops';
import type { CardActions } from './PlannerCard';

export type WeekendRailProps = {
    days: Date[]; itemsFor: (day: Date) => PlannerItem[]; today: Date; quiet: boolean; hasToday: boolean;
    onAdd?: (day: Date) => void;
} & CardActions;

/** Saturday and Sunday in a slim rail beside the week (see SalesPlannerTab). */
export default function WeekendRail({ days, itemsFor, today, quiet, hasToday, onAdd, ...actions }: WeekendRailProps) {
    return (
        <div className={`pl-rail${quiet ? ' is-quiet' : ''}${hasToday ? ' is-today' : ''}`}>
            <div className="pl-rail-head">Weekend</div>
            {days.map(day => {
                const items = itemsFor(day);
                const isToday = isSameDay(day, today);
                return (
                    <div
                        key={dayKey(day)}
                        className={`pl-rail-day${isToday ? ' is-today' : ''}${actions.move.dropClass(day)}`}
                        {...actions.move.dayDropProps(day)}
                    >
                        <div className="pl-rail-dh">
                            <span className="pl-rail-dow">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                            <span className="pl-headright">
                                {isToday && <span className="pl-todaytag">Today</span>}
                                <span className="pl-rail-dnum">{day.getDate()}</span>
                                {onAdd && (
                                <button
                                    type="button"
                                    className="pl-addday"
                                    onClick={() => onAdd(day)}
                                    title={addLabel(day)}
                                    aria-label={addLabel(day)}
                                >
                                    <Plus size={13} />
                                </button>
                                )}
                            </span>
                        </div>
                        {items.length > 0 && (
                            <div className="pl-rail-items"><DayStops day={day} items={items} {...actions} /></div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
