// The Sales dashboard (MIGRATION_NOTES.md §4, step A6): its page, data hook and Team Files; each tab is a module under this folder.
export { default as DashboardPage } from './DashboardPage';
export type { DashboardPageProps } from './DashboardPage';
export { useDashboardData } from './useDashboardData';
export type { DashboardData } from './useDashboardData';
export { useTeamFiles, TeamFilePreview, TeamFileUploadModal, AddFolderModal } from './teamFiles';
export type { TeamFiles, TeamFileForm, DeleteRequest } from './teamFiles';
export { default as VisitViewModal } from './components/VisitViewModal';
