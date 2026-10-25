import { Suspense } from 'react';
import { lazyRetry } from '../../utils/lazyRetry';
import type { CheckInLog } from './useCheckInLog';

const CheckInLogPanel = lazyRetry(() => import('./log/CheckInLogPanel'));

/**
 * The Sales page's Check-In Log tab: CheckInLogPanel fed from `log`
 * (useCheckInLog, held by the page). `sidebarToggle` is the page's menu button
 * when the side nav is closed; `fallback` its loading view.
 */
export type CheckInLogTabProps = {
  log: CheckInLog;
  locations: unknown[];
  sidebarToggle: React.ReactNode;
  fallback: React.ReactNode;
};

export default function CheckInLogTab({ log, locations, sidebarToggle, fallback }: CheckInLogTabProps) {
  return (
    <Suspense fallback={fallback}>
      <CheckInLogPanel
        checkIns={log.checkIns}
        loading={log.loading && log.checkIns.length === 0}
        refreshing={log.loading && log.checkIns.length > 0}
        onRefresh={log.refresh}
        searchTerm={log.search}
        onSearchChange={log.setSearch}
        lastUpdated={null}
        totalCount={log.totalCount}
        todayCount={log.todayCount}
        monthCount={log.monthCount}
        allTimeCount={log.allTimeCount}
        currentPage={log.page}
        totalPages={log.totalPages}
        onPageChange={log.setPage}
        rowsPerPage={log.limit}
        onRowsPerPageChange={log.setLimit}
        filterMonth={log.month}
        filterYear={log.year}
        onFilterMonthChange={log.setMonth}
        onFilterYearChange={log.setYear}
        filterLocation={log.location}
        onFilterLocationChange={log.setLocation}
        embedded={true}
        sidebarToggle={sidebarToggle}
        onView={log.view}
        onEdit={log.edit}
        onDelete={log.remove}
        locations={locations}
        onExport={log.exportAll}
        isExporting={log.exporting}
        exportFilters={{ search: log.search, month: log.month, year: log.year, location: log.location }}
      />
    </Suspense>
  );
}
