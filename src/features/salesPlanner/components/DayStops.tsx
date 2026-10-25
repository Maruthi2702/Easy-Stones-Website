import type { PlannerItem } from '../plannerSchedule';
import PlannerCard, { type CardActions } from './PlannerCard';

/**
 * A day's cards with the insertion line threaded between them, so the gap a
 * drop is aimed at is the gap that opens up.
 */
export default function DayStops({ day, items, ...actions }: { day: Date; items: PlannerItem[] } & CardActions) {
    const nodes: React.ReactNode[] = [];
    for (let i = 0; i <= items.length; i++) {
        if (actions.move.showSlot(day, i)) nodes.push(<div key={`gap-${i}`} className="pl-slot" aria-hidden="true" />);
        if (i < items.length) nodes.push(<PlannerCard key={items[i]._id} item={items[i]} {...actions} />);
    }
    return <>{nodes}</>;
}
