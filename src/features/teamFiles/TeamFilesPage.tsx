import { useState } from 'react';
import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import TeamFilesControls from './components/TeamFilesControls';
import TeamFilesList from './components/TeamFilesList';
import type { TeamFiles } from './useTeamFiles';

export type TeamFilesPageProps = {
    files: TeamFiles;
    /** The page's menu button (opens the side nav), or null. */
    sidebarToggle: ReactNode;
};

/**
 * Sales → Team Files: the folders and files shared with the whole team. Its
 * own page since 2026-10-30 (it was the dashboard's Resources → Team Files
 * sub-tab); the list, the folder trail and the Upload / Add Folder / file
 * pop-ups are the same ones, so nothing about a file changed. The redesign on
 * the claude.ai artifact "Team Files Page Canvas" (folder tree, preview,
 * pinning) waits on the owner's answers there.
 */
export default function TeamFilesPage({ files, sidebarToggle }: TeamFilesPageProps) {
    const [search, setSearch] = useState('');
    return (
        <div className="sales-dashboard-v2 tf-page">
            <div className="dashboard-header-v2">
                <div className="dashboard-header-content">
                    <div className="dashboard-left-section">
                        {sidebarToggle}
                        <div className="dashboard-title-group">
                            <h1>Team Files</h1>
                            <div className="dashboard-breadcrumbs">Folders and files shared with the whole team</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="visits-table-section">
                <div className="section-header">
                    <TeamFilesControls
                        folderPath={files.folderPath}
                        onGoHome={() => {
                            files.setCurrentFolderId(null);
                            files.setFolderPath([]);
                            setSearch('');
                        }}
                        onBreadcrumbClick={files.handleBreadcrumbClick}
                        onRefresh={files.fetchDashboardResources}
                        onAddFolder={() => { files.setFolderName(''); files.setShowAddFolderModal(true); }}
                        onUpload={() => {
                            files.setDashboardUploadForm({ name: '', type: 'file', content: '', file: null });
                            files.setEditingDashboardResource(null);
                            files.setShowDashboardUploadModal(true);
                        }}
                    />
                    <div className="table-controls">
                        <div className="table-search">
                            <Search className="search-icon" size={18} aria-hidden="true" />
                            <input
                                id="tf-search"
                                type="text"
                                placeholder="Search this folder"
                                aria-label="Search this folder"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            {search && (
                                <button type="button" className="table-search-clear" aria-label="Clear search" onClick={() => setSearch('')}>
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <TeamFilesList
                    resources={files.salesResources}
                    folderPath={files.folderPath}
                    searchTerm={search}
                    onBreadcrumbClick={files.handleBreadcrumbClick}
                    onResourceClick={files.handleResourceClick}
                    onEditResource={files.handleEditDashboardResource}
                    onDeleteResource={files.handleDeleteDashboardResource}
                    onOpenUpload={() => files.setShowDashboardUploadModal(true)}
                />
            </div>
        </div>
    );
}
