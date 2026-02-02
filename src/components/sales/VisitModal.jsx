import React from 'react';
import { X, FileText, Loader } from 'lucide-react';
import SearchableSelect from '../SearchableSelect';
import CustomDatePicker from '../CustomDatePicker';
import { formatDate } from '../../utils/dateUtils';

const VisitModal = ({
    showVisitModal,
    isViewingVisit,
    handleCloseVisitModal,
    editingVisit,
    visitForm,
    setVisitForm,
    isMobile,
    customerOptions,
    isSaving,
    handleSaveVisit,
    handleVisitImageUpload,
    handleRemoveVisitImage,
    selectedCustomer,
    customers,
    handleDashboardDownload,
    setFullScreenImage
}) => {
    if (!showVisitModal) return null;

    const renderAddEditModal = () => (
        <div className="modal-overlay" onClick={handleCloseVisitModal}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{editingVisit ? 'Edit Visit' : 'Add Visit'}</h2>
                    <button className="close-btn" onClick={handleCloseVisitModal}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <div className="form-group">
                        <label>Date <span style={{ color: 'red' }}>*</span></label>
                        <CustomDatePicker
                            value={visitForm.date}
                            onChange={(value) => setVisitForm({ ...visitForm, date: value })}
                            required
                        />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                        <div className="form-group">
                            <label>Customer <span style={{ color: 'red' }}>*</span></label>
                            <SearchableSelect
                                options={customerOptions}
                                value={visitForm.customerId}
                                onChange={(value) => setVisitForm({ ...visitForm, customerId: value })}
                                placeholder="Select a Customer..."
                            />
                        </div>
                        <div className="form-group">
                            <label>Visit Type <span style={{ color: 'red' }}>*</span></label>
                            <SearchableSelect
                                options={[
                                    'Quick Note',
                                    'Follow up Notes',
                                    'Scheduled in Person Sales Meeting',
                                    'Unscheduled in Person Sales Call',
                                    'Resource Placement',
                                    'Resource Update',
                                    'Formal Presentation',
                                    'Important Remote Meeting/Call',
                                    'In Office Administration Day',
                                    'Personal Time Off'
                                ].map(type => ({ value: type, label: type }))}
                                value={visitForm.purpose}
                                onChange={(value) => setVisitForm({ ...visitForm, purpose: value })}
                                placeholder="Please Select Visit Type"
                            />
                        </div>
                    </div>
                    {visitForm.purpose !== 'Follow up Notes' && (
                        <div className="form-group">
                            <label>Notes</label>
                            <textarea
                                value={visitForm.notes}
                                onChange={(e) => setVisitForm({ ...visitForm, notes: e.target.value })}
                                placeholder="Additional notes"
                                rows="4"
                            />
                        </div>
                    )}
                    {!visitForm.purpose?.toLowerCase().includes('quick note') && (
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                            {visitForm.purpose !== 'Follow up Notes' && (
                                <div className="form-group" style={{ gridColumn: isMobile ? 'span 1' : 'span 2' }}>
                                    <label>Outcome</label>
                                    <textarea
                                        value={visitForm.outcome}
                                        onChange={(e) => setVisitForm({ ...visitForm, outcome: e.target.value })}
                                        placeholder="Visit outcome"
                                        rows="3"
                                    />
                                </div>
                            )}
                            <div className="form-group">
                                <label>Follow Up Date</label>
                                <CustomDatePicker
                                    value={visitForm.followUpDate}
                                    onChange={(value) => setVisitForm({ ...visitForm, followUpDate: value })}
                                />
                            </div>
                            <div className="form-group">
                                <label>Follow Up Notes</label>
                                <textarea
                                    value={visitForm.followUp}
                                    onChange={(e) => setVisitForm({ ...visitForm, followUp: e.target.value })}
                                    placeholder="Followup Notes"
                                    rows="3"
                                />
                            </div>
                        </div>
                    )}
                    <div className="form-group">
                        <label>Attachments</label>
                        <div className="image-upload-container">
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px', marginBottom: '8px' }}>
                                {visitForm.image && (Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image]).map((img, idx) => (
                                    <div key={idx} className="image-preview-wrapper" style={{ width: '100%', height: '80px', position: 'relative' }}>
                                        {img.startsWith('data:application/pdf') ? (
                                            <div className="pdf-preview" style={{
                                                width: '100%',
                                                height: '100%',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                background: '#f5f5f5',
                                                borderRadius: '4px',
                                                border: '1px solid #ddd'
                                            }}>
                                                <FileText size={32} color="#E5C04A" />
                                                <span style={{ fontSize: '10px', marginTop: '4px', color: '#666' }}>PDF</span>
                                            </div>
                                        ) : (
                                            <img src={img} alt="Preview" className="image-preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                                        )}
                                        <button type="button" className="remove-image-btn" onClick={() => handleRemoveVisitImage(idx)} style={{ padding: '2px', position: 'absolute', top: '-6px', right: '-6px', background: 'red', color: 'white', borderRadius: '50%', border: 'none', cursor: 'pointer', zIndex: 10 }}>
                                            <X size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <div className="file-input-wrapper-simple">
                                <input
                                    type="file"
                                    id="visit-image-upload"
                                    accept="image/*,application/pdf"
                                    multiple
                                    onChange={handleVisitImageUpload}
                                    className="file-input"
                                />
                                <label htmlFor="visit-image-upload" className="file-input-label">
                                    Add Files
                                </label>
                            </div>
                        </div>
                    </div>
                    {editingVisit && (
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label>Manager Comment</label>
                                <input
                                    type="text"
                                    value={visitForm.managerComment}
                                    onChange={(e) => setVisitForm({ ...visitForm, managerComment: e.target.value })}
                                    placeholder="Comment from Manager"
                                />
                            </div>
                            <div className="form-group">
                                <label>Headquarters Comment</label>
                                <input
                                    type="text"
                                    value={visitForm.headquartersComment}
                                    onChange={(e) => setVisitForm({ ...visitForm, headquartersComment: e.target.value })}
                                    placeholder="Comment from HQ"
                                />
                            </div>
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={handleCloseVisitModal} disabled={isSaving}>
                        Cancel
                    </button>
                    <button className="btn-primary" onClick={handleSaveVisit} disabled={isSaving}>
                        {isSaving ? 'Saving...' : (editingVisit ? 'Save Changes' : 'Add Visit')}
                    </button>
                </div>
            </div>
        </div>
    );

    const renderViewModal = () => (
        <div className="modal-overlay" onClick={handleCloseVisitModal}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Visit Details</h2>
                    <button className="close-btn" onClick={handleCloseVisitModal}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <div className="visit-details-grid">
                        <div className="visit-detail-item">
                            <div className="visit-detail-label">Date</div>
                            <div className="visit-detail-value">{formatDate(visitForm.date)}</div>
                        </div>
                        <div className="visit-detail-item">
                            <div className="visit-detail-label">Customer</div>
                            <div className="visit-detail-value">
                                {(() => {
                                    if (selectedCustomer) return selectedCustomer.company || selectedCustomer.contactName;
                                    const c = customers.find(c => c._id === (visitForm.customerId || editingVisit?.customerId));
                                    return c ? (c.company || c.contactName) : (visitForm?.customerContactName || visitForm?.customerName || editingVisit?.customerName || '-');
                                })()}
                            </div>
                        </div>
                        <div className="visit-detail-item">
                            <div className="visit-detail-label">Visit Type</div>
                            <div className="visit-detail-value">{visitForm.purpose || '-'}</div>
                        </div>
                        <div className="visit-detail-item full-width">
                            <div className="visit-detail-label">Notes</div>
                            <div className="visit-detail-value" style={{ border: 'none', background: 'none', padding: 0, color: 'var(--text-primary)' }}>
                                {visitForm.notes || 'No notes available.'}
                            </div>
                        </div>
                        {!visitForm.purpose?.toLowerCase().includes('quick note') && (
                            <>
                                <div className="visit-detail-item">
                                    <div className="visit-detail-label">Outcome</div>
                                    <div className="visit-detail-value">{visitForm.outcome || '-'}</div>
                                </div>
                                <div className="visit-detail-item">
                                    <div className="visit-detail-label">Follow Up</div>
                                    <div className="visit-detail-value">{visitForm.followUp || visitForm.nextAction || '-'}</div>
                                </div>
                                {visitForm.followUpDate && (
                                    <div className="visit-detail-item">
                                        <div className="visit-detail-label">Follow Up Date</div>
                                        <div className="visit-detail-value">{formatDate(visitForm.followUpDate)}</div>
                                    </div>
                                )}
                            </>
                        )}
                        <div className="visit-detail-item full-width">
                            <div className="visit-detail-label">Attachments</div>
                            {(visitForm.image && (Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image]).length > 0) ? (
                                <div className="visit-attachments-grid" style={{ marginTop: '0.5rem' }}>
                                    {(Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image]).map((img, idx) => (
                                        <div key={idx} className="attachment-preview-card">
                                            {img.startsWith('data:application/pdf') ? (
                                                <div
                                                    className="attachment-pdf"
                                                    onClick={() => handleDashboardDownload({ content: img, name: `Visit-Doc-${idx}.pdf`, type: 'file' })}
                                                >
                                                    <FileText size={32} />
                                                    <span style={{ fontSize: '10px', marginTop: '4px', fontWeight: 600 }}>PDF</span>
                                                </div>
                                            ) : (
                                                <img
                                                    src={img}
                                                    alt="Preview"
                                                    className="attachment-img"
                                                    onClick={() => setFullScreenImage(img)}
                                                    style={{ borderRadius: '8px', cursor: 'pointer' }}
                                                    loading="lazy"
                                                />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="visit-detail-value">No attachments</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return isViewingVisit ? renderViewModal() : renderAddEditModal();
};

export default VisitModal;
