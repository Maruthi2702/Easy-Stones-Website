// The Sales Planner (MIGRATION_NOTES.md §4, step B): Dashboard → Calendar.
// CalendarPanel lazy-loads SalesPlannerTab.tsx by path, so the planner keeps a
// chunk of its own; this is the module's surface for anything else.
export { default as SalesPlannerTab } from './SalesPlannerTab';
export type { SalesPlannerTabProps } from './SalesPlannerTab';
export type { PlannerItem } from './plannerSchedule';
