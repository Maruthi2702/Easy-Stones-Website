import { clearListCache } from '../customers/list/listOptions';

/**
 * What a visit save (this browser's or another's) refreshes beyond the open
 * profile: the Customers list (its Last visit comes from visits, so its cache
 * goes and a mounted list refetches) and the dashboard's visit data. The
 * customer dropdown and resources are not touched.
 */
export function refreshVisitData(refreshDashboardVisits: () => void) {
    clearListCache();
    window.dispatchEvent(new Event('customers:changed'));
    refreshDashboardVisits();
}
