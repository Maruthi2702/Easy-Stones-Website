import React from 'react';
import { X, Link, Download, Plus } from 'lucide-react';
import SearchableSelect from '../SearchableSelect';
import CustomDatePicker from '../CustomDatePicker';

const ResourceModal = ({
    showResourceModal,
    setShowResourceModal,
    editingResource,
    isViewingResource,
    resourceForm,
    setResourceForm,
    customerOptions,
    customers,
    resourceTypes,
    formatDate,
    API_URL,
    isSaving,
    handleSaveResource,
    handleResourceImageUpload,
    handleRemoveResourceImage,
    handleDashboardDownload,
    setFullScreenImage
}) => {
    if (!showResourceModal) return null;

    return (
        <div className="modal-overlay" onClick={() => setShowResourceModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{editingResource ? (isViewingResource ? 'Resource Details' : 'Edit Resource') : 'Add Resource'}</h2>
                    <button className="close-btn" onClick={() => setShowResourceModal(false)}>
                        <X size={20} />
                    </button>
                </div>

                {isViewingResource ? (
                    <div className={`modal-body view-mode ${resourceForm.image ? 'has-image' : ''}`}>
                        {resourceForm.image && (Array.isArray(resourceForm.image) ? resourceForm.image : [resourceForm.image]).length > 0 && (
                            <div className="view-image-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '10px' }}>
                                {(Array.isArray(resourceForm.image) ? resourceForm.image : [resourceForm.image]).map((img, idx) => (
                                    <div key={idx} style={{ position: 'relative', aspectRatio: '1' }}>
                                        <img
                                            src={(() => {
                                                if (!img) return '';
                                                if (img.startsWith('data:') || img.startsWith('http')) return img;
                                                if (img.includes('uploads/')) {
                                                    return `${API_URL}${img.startsWith('/') ? '' : '/'}${img}`;
                                                }
                                                return `${API_URL}/uploads/resources/${img}`;
                                            })()}
                                            alt={`Resource ${idx + 1}`}
                                            onClick={() => setFullScreenImage(img)}
                                            className="view-resource-image"
                                            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px', cursor: 'pointer' }}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="view-content-wrapper">
                            <div className="view-details-grid">
                                <div className="view-detail-item">
                                    <label>Client</label>
                                    <p>{resourceForm.customer || '-'}</p>
                                </div>
                                <div className="view-detail-item">
                                    <label>Type</label>
                                    <p>{resourceForm.resourceType || '-'}</p>
                                </div>
                                <div className="view-detail-item">
                                    <label>Date</label>
                                    <p>{formatDate(resourceForm.date)}</p>
                                </div>
                                <div className="view-detail-item">
                                    <label>Status</label>
                                    <span className={`status-badge ${resourceForm.status?.toLowerCase()}`}>
                                        {resourceForm.status || 'Active'}
                                    </span>
                                </div>
                            </div>

                            <div className="view-section">
                                <label>Description</label>
                                <p className="view-text">{resourceForm.description || 'No description provided.'}</p>
                            </div>

                            {resourceForm.notes && (
                                <div className="view-section">
                                    <label>Notes</label>
                                    <p className="view-text">{resourceForm.notes}</p>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="modal-body">
                        <div className="form-group">
                            <label>Client *</label>
                            <SearchableSelect
                                options={customerOptions}
                                value={resourceForm.customerId}
                                onChange={(value) => {
                                    const selectedC = customers.find(c => c._id === value);
                                    setResourceForm({
                                        ...resourceForm,
                                        customerId: value,
                                        customer: selectedC ? (selectedC.company || selectedC.contactName) : ''
                                    });
                                }}
                                placeholder="Select a Client..."
                            />
                        </div>
                        <div className="form-group">
                            <label>Resource Type *</label>
                            <SearchableSelect
                                options={resourceTypes.map(type => ({ value: type, label: type }))}
                                value={resourceForm.resourceType}
                                onChange={(value) => setResourceForm({ ...resourceForm, resourceType: value, title: value })}
                                placeholder="Please Select Resource Type"
                            />
                        </div>

                        <div className="form-group">
                            <label>Date *</label>
                            <CustomDatePicker
                                value={resourceForm.date}
                                onChange={(value) => setResourceForm({ ...resourceForm, date: value })}
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>Status</label>
                            <SearchableSelect
                                options={[
                                    { value: 'Active', label: 'Active' },
                                    { value: 'Inactive', label: 'Inactive' },
                                    { value: 'Archived', label: 'Archived' }
                                ]}
                                value={resourceForm.status}
                                onChange={(value) => setResourceForm({ ...resourceForm, status: value })}
                                placeholder="Select Status"
                            />
                        </div>

                        <div className="form-group">
                            <label>Description</label>
                            <textarea
                                value={resourceForm.description}
                                onChange={(e) => setResourceForm({ ...resourceForm, description: e.target.value })}
                                placeholder="Add a description"
                                rows="3"
                            />
                        </div>

                        <div className="form-group">
                            <label>Notes</label>
                            <textarea
                                value={resourceForm.notes}
                                onChange={(e) => setResourceForm({ ...resourceForm, notes: e.target.value })}
                                placeholder="Add internal notes"
                                rows="3"
                            />
                        </div>

                        <div className="form-group">
                            <label>Resource Attachment (Images/PDFs)</label>
                            <div className="image-upload-container">
                                <div className="image-upload-grid">
                                    {(Array.isArray(resourceForm.image) ? resourceForm.image : (resourceForm.image ? [resourceForm.image] : [])).map((img, idx) => (
                                        <div key={idx} className="image-preview-wrapper">
                                            {img && (img.toLowerCase().endsWith('.pdf') || img.startsWith('data:application/pdf')) ? (
                                                <div className="pdf-preview-thumbnail">
                                                    <FileText size={24} />
                                                    <span>PDF Document</span>
                                                </div>
                                            ) : (
                                                <img
                                                    src={(() => {
                                                        if (!img) return '';
                                                        if (img.startsWith('data:') || img.startsWith('http')) return img;
                                                        if (img.includes('uploads/')) {
                                                            return `${API_URL}${img.startsWith('/') ? '' : '/'}${img}`;
                                                        }
                                                        return `${API_URL}/uploads/resources/${img}`;
                                                    })()}
                                                    alt="Resource Thumbnail"
                                                    loading="lazy"
                                                />
                                            )}
                                            <button type="button" className="remove-image-btn" onClick={() => handleRemoveResourceImage(idx)}>
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                    <label className="upload-placeholder">
                                        <input type="file" multiple accept="image/*,.pdf" onChange={handleResourceImageUpload} hidden />
                                        <Plus size={24} />
                                        <span>Add Attachment</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="modal-footer">
                    <button className="btn-secondary" onClick={() => setShowResourceModal(false)} disabled={isSaving}>
                        Cancel
                    </button>
                    {!isViewingResource && (
                        <button className="btn-primary" onClick={handleSaveResource} disabled={isSaving}>
                            {isSaving ? 'Saving...' : (editingResource ? 'Update Resource' : 'Save Resource')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ResourceModal;
