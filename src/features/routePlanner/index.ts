// The Route Planner (MIGRATION_NOTES.md §4, step B). The Sales shell
// lazy-loads RoutePlannerV2.tsx itself (src/features/salesShell/
// SalesTabViews.tsx), so the page keeps its own chunk (Google Maps code
// included) and CSS order; anything else outside this folder imports from here.
export { default as RoutePlannerV2 } from './RoutePlannerV2';
export type { RoutePlannerV2Props } from './RoutePlannerV2';
export type { Pin, MapPin, Preselect, ScheduleRow, Booking } from './types';
