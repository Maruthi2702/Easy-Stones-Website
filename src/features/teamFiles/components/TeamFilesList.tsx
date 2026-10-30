import { ArrowLeft, File, FileImage, FileSearch, FileText, Folder, Link, Pencil, Trash2 } from 'lucide-react';
import { formatDate } from '../../../utils/dateUtils';
import type { Loose } from '../../../types/records';

export type TeamFilesListProps = {
    /** The open folder's files and folders. */
    resources: Loose[];
    folderPath: { id: string; name: string }[];
    searchTerm: string;
    onBreadcrumbClick: (index: number) => void;
    onResourceClick: (resource: Loose) => void;
    onEditResource: (resource: Loose) => void;
    onDeleteResource: (resourceId: string) => void;
    onOpenUpload: () => void;
};

/** Team Files: the open folder's table (name, modified, by), with Back, Edit and Delete. */
export default function TeamFilesList({ resources, folderPath, searchTerm, onBreadcrumbClick, onResourceClick, onEditResource, onDeleteResource, onOpenUpload }: TeamFilesListProps) {
    return (
        <div className="team-resources-content">
            <div className="resources-list-container">
                {folderPath.length > 0 && (
                    <div className="list-back-button" onClick={() => onBreadcrumbClick(folderPath.length - 2)}>
                        <ArrowLeft size={16} />
                        <span>Back</span>
                    </div>
                )}

                {resources.length === 0 ? (
                    <div className="empty-resources-state">
                        <div className="empty-icon">
                            <FileSearch size={48} />
                        </div>
                        <p>No files or folders found in this location</p>
                        <button className="btn-secondary small" onClick={onOpenUpload}>
                            Upload your first file
                        </button>
                    </div>
                ) : (
                    <table className="resources-table">
                        <thead>
                            <tr>
                                <th style={{ width: '40%' }}>Name</th>
                                <th>Modified</th>
                                <th>Modified By</th>
                                <th style={{ width: '100px' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {resources.filter(r => !searchTerm || r.name.toLowerCase().includes(searchTerm.toLowerCase())).map(resource => {
                                const isFolder = resource.type === 'folder';
                                const isLink = resource.type === 'link';
                                const isImage = resource.contentType?.startsWith('image/') || resource.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                                const isPdf = resource.contentType === 'application/pdf' || resource.name.toLowerCase().endsWith('.pdf');

                                return (
                                    <tr
                                        key={resource._id}
                                        className="resource-row"
                                        onClick={() => onResourceClick(resource)}
                                    >
                                        <td className="col-name">
                                            <div className="resource-name-wrapper">
                                                <span className={`resource-icon-small ${resource.type}`}>
                                                    {isFolder ? <Folder size={18} fill="currentColor" /> :
                                                        isLink ? <Link size={18} /> :
                                                            isImage ? <FileImage size={18} /> :
                                                                isPdf ? <FileText size={18} /> :
                                                                    <File size={18} />}
                                                </span>
                                                <span className="name-text">{resource.name}</span>
                                            </div>
                                        </td>
                                        <td className="col-date">
                                            {formatDate(resource.createdAt, { month: 'long', day: 'numeric', year: 'numeric' })}
                                        </td>
                                        <td className="col-user">
                                            <span className="user-pill">
                                                {resource.uploadedBy?.username ?
                                                    resource.uploadedBy.username.charAt(0).toUpperCase() + resource.uploadedBy.username.slice(1)
                                                    : 'Admin'}
                                            </span>
                                        </td>
                                        <td className="col-actions">
                                            <div className="row-actions">
                                                <button
                                                    className="action-icon-btn edit"
                                                    onClick={(e) => { e.stopPropagation(); onEditResource(resource); }}
                                                    title="Edit"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    className="action-icon-btn delete"
                                                    onClick={(e) => { e.stopPropagation(); onDeleteResource(resource._id); }}
                                                    title="Delete"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
