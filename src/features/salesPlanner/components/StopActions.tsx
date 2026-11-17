import { useState } from 'react';
import { Ellipsis } from 'lucide-react';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import type { PlannerItem } from '../plannerSchedule';
import { customerName } from '../salesPlanner';
import { openDirections } from '../directions';
import PlannerActionsSheet from './PlannerActionsSheet';
import PlannerStopMenu from './PlannerStopMenu';

export type StopActionsProps = {
    item: PlannerItem;
    onViewDetails?: () => void;
    onOpenCustomer?: () => void;
    /** Change the stop in the Calendar (the Today panel can't edit it itself). */
    onOpenCalendar?: () => void;
};

/**
 * A stop's ⋯ for screens outside the Calendar (the Visits tab's Today panel): the same
 * Directions / View details / Open profile as the planner, then "Edit in Calendar". A laptop gets the
 * popover, a phone the bottom sheet, like the planner's own stops.
 */
export default function StopActions({ item, onViewDetails, onOpenCustomer, onOpenCalendar }: StopActionsProps) {
    const phone = useIsPhone();
    const [open, setOpen] = useState(false);
    const customerId = typeof item.customerId === 'string' ? item.customerId : String(item.customerId?._id || '');
    const onDirections = customerId ? () => { void openDirections(customerId); } : undefined;
    if (!phone) return <PlannerStopMenu item={item} onDirections={onDirections} onViewDetails={onViewDetails} onOpenCustomer={onOpenCustomer} onOpenCalendar={onOpenCalendar} />;
    return (
        <>
            <button type="button" className="pl-kebab pl-kebab--aside" aria-haspopup="dialog" aria-expanded={open} aria-label={`More for ${customerName(item)}`} onClick={() => setOpen(true)}>
                <Ellipsis size={20} />
            </button>
            {open && <PlannerActionsSheet item={item} onClose={() => setOpen(false)} onViewDetails={onViewDetails} onOpenCustomer={onOpenCustomer} onDirections={onDirections} onOpenCalendar={onOpenCalendar} />}
        </>
    );
}
