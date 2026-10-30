import { FolderPlus, RefreshCw, Upload } from 'lucide-react';
import React from 'react';

export type TeamFilesControlsProps = {
    folderPath: { id: string; name: string }[];
    onGoHome: () => void;
    onBreadcrumbClick: (index: number) => void;
    onRefresh: () => void;
    onAddFolder: () => void;
    onUpload: () => void;
};

/** Team Files' breadcrumb trail and its Refresh / Add Folder / Upload buttons. */
export default function TeamFilesControls({ folderPath, onGoHome, onBreadcrumbClick, onRefresh, onAddFolder, onUpload }: TeamFilesControlsProps) {
    return (
        <div className="team-resources-controls">
            <div className="resource-breadcrumbs">
                <span
                    className="breadcrumb-item"
                    onClick={() => {
                        if (folderPath.length > 0) onGoHome();
                    }}
                >
                    Home
                </span>
                {folderPath.map((folder, index) => (
                    <React.Fragment key={folder.id}>
                        <span className="separator">/</span>
                        <span
                            className={`breadcrumb-item ${index === folderPath.length - 1 ? 'current' : ''}`}
                            onClick={() => onBreadcrumbClick(index)}
                        >
                            {folder.name}
                        </span>
                    </React.Fragment>
                ))}
            </div>
            <div className="team-resources-actions">
                <button
                    className="icon-action-btn secondary"
                    title="Refresh Files"
                    onClick={onRefresh}
                >
                    <RefreshCw size={16} />
                </button>
                <button className="icon-action-btn secondary" onClick={onAddFolder}>
                    <FolderPlus size={16} /> <span className="mobile-hide-text">Add Folder</span>
                </button>
                <button className="icon-action-btn primary" onClick={onUpload}>
                    <Upload size={16} /> <span className="mobile-hide-text">Upload</span>
                </button>
            </div>
        </div>
    );
}
