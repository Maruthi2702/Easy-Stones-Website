import { Suspense, useState } from 'react';
import { lazyRetry } from '../../../utils/lazyRetry';
import type { Loose } from '../../../types/records';
import DashboardSearch from '../components/DashboardSearch';

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
    /** The + asked for "Schedule activity": open the form once, then say so. */
    scheduleRequest?: boolean;
    onScheduleRequestTaken?: () => void;
};

/** Dashboard → Calendar: the sales planner. */
export default function CalendarPanel({ customerSelection, customerOptions, isDropdownLoading, currentUserId, fallback, onSelectCustomer, onScheduleChange, viewing, includesMe, justMe, scheduleRequest = false, onScheduleRequestTaken }: CalendarPanelProps) {
    // The dashboard's one search box: shows only the stops whose customer matches.
    const [search, setSearch] = useState('');
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
                search={search}
                searchBox={<DashboardSearch value={search} onChange={setSearch} label="Search the calendar" />}
                openAdd={scheduleRequest}
                onOpenAddTaken={onScheduleRequestTaken}
            />
            </Suspense>
        </div>
    );
}
