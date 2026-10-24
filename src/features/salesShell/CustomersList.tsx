import { Suspense } from 'react';
import type { ComponentType } from 'react';
import { lazyRetry } from '../../utils/lazyRetry';
import type { Loose } from '../../types/records';
import TabLoader from './TabLoader';

// Loaded when the Customers list (or Dashboard → Leads) first shows. Still
// JavaScript, so taken as taking any props until it's typed.
const PartnersSheet = lazyRetry(() => import('../../components/sales/PartnersSheet')) as unknown as ComponentType<Loose>;

export type CustomersListProps = {
    onSelectCustomer: (customer: Loose) => void;
    onOpenSidebar: () => void;
    isSidebarOpen: boolean;
    customerRefreshTrigger: number;
    /** The selection bar's "Plan route"; undefined without the Route Planner. */
    onPlanRoute?: (rows: Loose[]) => void;
};

/** The Customers list (PartnersSheet), with its loading view. */
export default function CustomersList({ onSelectCustomer, onOpenSidebar, isSidebarOpen, customerRefreshTrigger, onPlanRoute }: CustomersListProps) {
    return (
        <Suspense fallback={<TabLoader />}>
            <PartnersSheet
                onSelectCustomer={onSelectCustomer}
                onToggleSidebar={onOpenSidebar}
                isSidebarOpen={isSidebarOpen}
                customerRefreshTrigger={customerRefreshTrigger}
                onPlanRoute={onPlanRoute}
            />
        </Suspense>
    );
}
