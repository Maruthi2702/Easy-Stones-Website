// Dashboard → Team Files: the data hook and its three pop-ups (MIGRATION_NOTES.md §4, step A6).
export { useTeamFiles } from './useTeamFiles';
export type { TeamFiles, TeamFileForm, DeleteRequest } from './useTeamFiles';
export { default as TeamFilePreview } from './TeamFilePreview';
export { default as TeamFileUploadModal } from './TeamFileUploadModal';
export { default as AddFolderModal } from './AddFolderModal';
