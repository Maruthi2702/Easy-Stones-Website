// The Delivery Schedule (MIGRATION_NOTES.md §4, step B). The Sales shell
// lazy-loads DeliveryScheduleTab.tsx itself (src/features/salesShell/
// SalesTabViews.tsx), so the page keeps its own chunk and CSS order; anything
// else outside this folder imports from here.
export { default as DeliveryScheduleTab } from './DeliveryScheduleTab';
export type { DeliveryScheduleTabProps } from './DeliveryScheduleTab';
export type { Ticket, BoardColumn, ScheduleRole, Assignment, StopOrder } from './types';
