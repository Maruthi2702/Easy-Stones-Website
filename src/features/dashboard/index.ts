// The Sales dashboard (MIGRATION_NOTES.md §4, step A6): its page and data hook; each tab is a module under this folder.
// Team Files is its own page now (src/features/teamFiles/).
export { default as DashboardPage } from './DashboardPage';
export type { DashboardPageProps } from './DashboardPage';
export { useDashboardData } from './useDashboardData';
export type { DashboardData } from './useDashboardData';
export { default as VisitViewModal } from './components/VisitViewModal';
