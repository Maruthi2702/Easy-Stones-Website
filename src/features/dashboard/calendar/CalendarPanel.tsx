import { Suspense } from 'react';
import { lazyRetry } from '../../../utils/lazyRetry';
import type { Loose } from '../../../types/records';

const SalesPlannerTab = lazyRetry(() => import('../../salesPlanner/SalesPlannerTab'));

export type CalendarPanelProps = {
    customerSelection: Loose[];
    customerOptions: Loose[];
    isDropdownLoading: boolean;
    currentUserId: string | null;
    fallback: React.ReactNode;
    onSelectCustomer: (customer: Loose) => void;
    /** A stop was added, moved or removed: the tiles' counts reload. */
    onScheduleChange: () => void;
    /** The team calendar, from the People filter (SalesPlannerTab's props of the same names). */
    viewing: string;
    includesMe: boolean;
    justMe: boolean;
};

/** Dashboard → Calendar: the sales planner. */
export default function CalendarPanel({ customerSelection, customerOptions, isDropdownLoading, currentUserId, fallback, onSelectCustomer, onScheduleChange, viewing, includesMe, justMe }: CalendarPanelProps) {
    return (
        <div className="planner-dashboard-container">
            <Suspense fallback={fallback}>
            <SalesPlannerTab
                customerSelection={customerSelection}
                customerOptions={customerOptions}
                isDropdownLoading={isDropdownLoading}
                currentUserId={currentUserId}
                onSelectCustomer={onSelectCustomer}
                onScheduleChange={onScheduleChange}
                viewing={viewing}
                includesMe={includesMe}
                justMe={justMe}
            />
            </Suspense>
        </div>
    );
}
