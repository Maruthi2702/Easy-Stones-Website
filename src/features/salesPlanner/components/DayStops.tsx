import type { PlannerItem } from '../plannerSchedule';
import PlannerCard, { type CardActions } from './PlannerCard';
import useNow from '../useNow';
import { isSameDay, nowLineIndex, timeParts } from '../salesPlanner';

/** The phone's NOW marker: a red line on the timeline between what's done and what's next. */
function NowLine({ now }: { now: Date }) {
    const { clock } = timeParts(now);
    return (
        <div className="pl-now" role="separator" aria-label={`Now, ${clock}`}>
            <span className="pl-now-time">{clock}</span>
            <span className="pl-now-dot" aria-hidden="true" />
            <i aria-hidden="true" />
            <b>NOW</b>
        </div>
    );
}

/**
 * A day's cards with the insertion line threaded between them, so the gap a
 * drop is aimed at is the gap that opens up. Today's list also carries the NOW
 * line (drawn on a phone only; see SalesPlannerMobile.css).
 */
export default function DayStops({ day, items, ...actions }: { day: Date; items: PlannerItem[] } & CardActions) {
    const now = useNow();
    const nowAt = isSameDay(day, now) && items.length > 0 ? nowLineIndex(items, now) : -1;
    const nodes: React.ReactNode[] = [];
    for (let i = 0; i <= items.length; i++) {
        if (actions.move.showSlot(day, i)) nodes.push(<div key={`gap-${i}`} className="pl-slot" aria-hidden="true" />);
        if (i === nowAt) nodes.push(<NowLine key="now" now={now} />);
        if (i < items.length) nodes.push(<PlannerCard key={items[i]._id} item={items[i]} {...actions} />);
    }
    return <>{nodes}</>;
}
