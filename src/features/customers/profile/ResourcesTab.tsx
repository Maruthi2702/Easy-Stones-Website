import React from 'react';
import { Eye, FileText, Folder, Loader } from 'lucide-react';
import { formatDate } from '../../../utils/dateUtils';
import { canModifyVisit, canDeleteVisit } from '../../../utils/visitAccess';
import { useMyTeam } from '../../../api/myTeam';
import { isPdfSource } from '../../../utils/attachments';
import { openPdfInline } from '../../../utils/packingList';
import Pagination from '../../../components/shared/Pagination';
import { usePagination, pageCount } from '../../../components/shared/paginationConfig';
import RowMenu from './RowMenu';
import { TabEmpty } from './TabStates';
import type { Loose } from '../../../types/records';

export type ResourcesTabProps = {
    resources: Loose[];
    /** The Customers tab's first page — a resource's client name. */
    customers: Loose[];
    currentUser: Loose | null;
    currentUserId: string | null;
    /** The resource being opened (its buttons wait). */
    loadingResourceId: string | null;
    canAddVisits: boolean;
    onAddResource: () => void;
    onViewResource: (resource: Loose) => void;
    onEditResource: (resource: Loose) => void;
    onDeleteResource: (resourceId: string, customerId?: string | null) => void;
    onOpenGallery: (images: string[], index: number) => void;
    /** Which row is open (kept by the page, so it survives a tab change). */
    expandedResourceId: string | null;
    setExpandedResourceId: (id: string | null) => void;
};

/**
 * Customer profile → Resources: the customer's resources, each opening to its
 * files and notes, 50 to a page. The Add resource button is the header's
 * (2026-10-29); the empty tab holds its own. A row's Edit and Delete are in its ⋯.
 */
export default function ResourcesTab({
    resources, customers, currentUser, currentUserId, loadingResourceId, canAddVisits, onAddResource, onViewResource,
    onEditResource, onDeleteResource, onOpenGallery, expandedResourceId, setExpandedResourceId
}: ResourcesTabProps) {
    const team = useMyTeam(currentUser, currentUserId);
    const paging = usePagination();
    const totalPages = pageCount(resources.length, paging.rowsPerPage);
    const page = Math.min(paging.currentPage, totalPages);
    const first = (page - 1) * paging.rowsPerPage;
    const shown = resources.slice(first, first + paging.rowsPerPage);
    if (resources.length === 0) {
        return (
            <div className="tab-section resources-tab">
                <TabEmpty
                    icon={<Folder size={28} aria-hidden="true" />}
                    title="No resources yet"
                    text="Add plans, quotes and files for this customer."
                    actionLabel={canAddVisits ? 'Add resource' : undefined}
                    onAction={onAddResource}
                />
            </div>
        );
    }
    return (
        <div className="tab-section resources-tab">
            {/* Resources Table */}
            <div className="resources-table-wrapper">
                <table className="resources-table">
                    <thead>
                        <tr>
                            <th style={{ width: '50px' }}>#</th>
                            <th>Date</th>
                            <th>Client</th>
                            <th>Location</th>
                            <th>Type</th>
                            <th style={{ width: '120px' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.length > 0 ? (
                            shown.map((resource, index) => (
                                <React.Fragment key={resource._id || index}>
                                    <tr
                                        className={expandedResourceId === resource._id ? 'expanded' : ''}
                                        onClick={() => setExpandedResourceId(expandedResourceId === resource._id ? null : resource._id)}
                                    >
                                        <td data-label="#">{first + index + 1}</td>
                                        <td data-label="Date">{formatDate(resource.date, { month: '2-digit', day: '2-digit', year: 'numeric' })}</td>
                                        <td data-label="Client">
                                            {(() => {
                                                const customerObj = customers.find(c => c._id === resource.customerId);
                                                return customerObj ? (customerObj.company || customerObj.contactName) : (resource.customer || '-');
                                            })()}
                                        </td>
                                        <td data-label="Location">{resource.location || '-'}</td>
                                        <td data-label="Type">{resource.resourceType || '-'}</td>
                                        <td data-label="Actions">
                                            <div className="action-buttons" onClick={(e) => e.stopPropagation()}>
                                                <button className="icon-btn view" onClick={(e) => { e.stopPropagation(); onViewResource(resource); }} title="View" disabled={loadingResourceId === resource._id}>
                                                    {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
                                                </button>
                                                <RowMenu
                                                    noun="resource"
                                                    onEdit={canModifyVisit({ ...currentUser, id: currentUserId }, { createdBy: resource.uploadedBy || resource.createdBy }, team) ? () => onEditResource(resource) : undefined}
                                                    onDelete={canDeleteVisit({ ...currentUser, id: currentUserId }, { createdBy: resource.uploadedBy || resource.createdBy }, team) ? () => onDeleteResource(resource._id, resource.customerId) : undefined}
                                                />
                                                {resource.url && (
                                                    <a href={resource.url} target="_blank" rel="noopener noreferrer" className="icon-btn link" onClick={(e) => e.stopPropagation()} title="Open Link">
                                                        🔗
                                                    </a>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedResourceId === resource._id && (
                                        <tr className="resource-details-row">
                                            <td colSpan={6}>
                                                <div className="resource-details">
                                                    <div className="detail-item">
                                                        <strong>Attachments</strong>
                                                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                                            {(Array.isArray(resource.image) ? resource.image : (resource.image ? [resource.image] : [])).length > 0 ? (
                                                                (Array.isArray(resource.image) ? resource.image : [resource.image]).map((img, idx) => (
                                                                    isPdfSource(img) ? (
                                                                        <div key={idx} style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => openPdfInline(img)}>
                                                                            <FileText size={40} color="#E5C04A" />
                                                                            <div style={{ fontSize: '10px' }}>PDF</div>
                                                                        </div>
                                                                    ) : (
                                                                        <img
                                                                            key={idx}
                                                                            src={img}
                                                                            alt="Resource"
                                                                            style={{ maxWidth: '100px', maxHeight: '100px', objectFit: 'cover', cursor: 'pointer', borderRadius: '4px', border: '1px solid #ddd' }}
                                                                            onClick={() => {
                                                                                const attachments = Array.isArray(resource.image) ? resource.image : [resource.image];
                                                                                onOpenGallery(attachments, idx);
                                                                            }}
                                                                            loading="lazy"
                                                                        />
                                                                    )
                                                                ))
                                                            ) : (
                                                                <span className="placeholder-img">No attachments</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="detail-item">
                                                        <strong>Description</strong>
                                                        <p>{resource.description || '-'}</p>
                                                    </div>
                                                    <div className="detail-item">
                                                        <strong>Notes</strong>
                                                        <p>{resource.notes || '-'}</p>
                                                    </div>
                                                    <div className="detail-item">
                                                        <strong>Status</strong>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                                                            <span className={`status-badge ${resource.status?.toLowerCase()}`}>
                                                                {resource.status || 'Active'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={6} className="empty-row">No resources found</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {resources.length > paging.rowsPerPage && (
                <Pagination
                    currentPage={page} totalPages={totalPages} onPageChange={paging.setCurrentPage}
                    rowsPerPage={paging.rowsPerPage} onRowsPerPageChange={paging.setRowsPerPage} totalCount={resources.length}
                />
            )}
        </div>
    );
}
