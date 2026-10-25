import React from 'react';
import { Edit2, Eye, FileText, Loader, Plus, Trash2 } from 'lucide-react';
import { formatDate } from '../../../utils/dateUtils';
import { canModifyVisit, canDeleteVisit } from '../../../utils/visitAccess';
import { isPdfSource } from '../../../utils/attachments';
import { openPdfInline } from '../../../utils/packingList';
import type { Loose } from '../../../types/records';

export type ResourcesTabProps = {
    resources: Loose[];
    /** The Customers tab's first page — a resource's client name. */
    customers: Loose[];
    customerLocation?: string;
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

/** Customer profile → Resources: the customer's resources, each opening to its files and notes. */
export default function ResourcesTab({
    resources, customers, customerLocation, currentUser, currentUserId, loadingResourceId, canAddVisits, onAddResource, onViewResource,
    onEditResource, onDeleteResource, onOpenGallery, expandedResourceId, setExpandedResourceId
}: ResourcesTabProps) {
    return (
        <div className="tab-section resources-tab">
            {/* Filters Section */}


            {/* Header with Title and Add Button */}
            <div className="tab-header">
                <h3>Client Resource</h3>
                {canAddVisits && (
                    <button className="add-resource-btn" onClick={onAddResource}>
                        <Plus size={18} /> Add Resource
                    </button>
                )}
            </div>



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
                        {resources && resources.length > 0 ? (
                            resources.map((resource, index) => (
                                <React.Fragment key={resource._id || index}>
                                    <tr
                                        className={expandedResourceId === resource._id ? 'expanded' : ''}
                                        onClick={() => setExpandedResourceId(expandedResourceId === resource._id ? null : resource._id)}
                                    >
                                        <td data-label="#">{index + 1}</td>
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
                                                {canModifyVisit({ ...currentUser, id: currentUserId }, { createdBy: resource.uploadedBy || resource.createdBy }, customerLocation) && (
                                                    <button className="icon-btn edit" onClick={(e) => { e.stopPropagation(); onEditResource(resource); }} title="Edit">
                                                        <Edit2 size={16} />
                                                    </button>
                                                )}
                                                {canDeleteVisit({ ...currentUser, id: currentUserId }, { createdBy: resource.uploadedBy || resource.createdBy }, customerLocation) && (
                                                    <button className="icon-btn delete" onClick={(e) => { e.stopPropagation(); onDeleteResource(resource._id, resource.customerId); }} title="Delete">
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
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


        </div>
    );
}
