import React from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Loader, Plus } from 'lucide-react';
import SearchableSelect from '../SearchableSelect';
import { API_URL } from '../../config/api';
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
    setFullScreenImage,
    handleOpenGallery,
    onCreateNew,
    isDropdownLoading
}) => {
    if (!showVisitModal) return null;

    const resolveImageSrc = (img) => {
        if (!img) return '';
        if (img.startsWith('data:') || img.startsWith('http')) return img;
        if (img.startsWith('/uploads')) return `${API_URL}${img}`;
        return `${API_URL}/uploads/visits/${img}`;
    };

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
                                onCreateNew={onCreateNew}
                                createNewLabel="New Customer"
                                isLoading={isDropdownLoading}
                            />
                        </div>
                        <div className="form-group">
                            <label>Visit Type <span style={{ color: 'red' }}>*</span></label>
                            <select
                                value={visitForm.type}
                                onChange={(e) => setVisitForm({ ...visitForm, type: e.target.value })}
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    borderRadius: '4px',
                                    backgroundColor: 'rgba(255,255,255,0.05)',
                                    color: '#FFF',
                                    minHeight: '38px'
                                }}
                            >
                                <option value="Scheduled In Person Sales Meeting" style={{ backgroundColor: '#1C1C1E' }}>Scheduled In Person Sales Meeting</option>
                                <option value="Cold Call / Cold Visit" style={{ backgroundColor: '#1C1C1E' }}>Cold Call / Cold Visit</option>
                                <option value="Binder / Swatch Dropoff" style={{ backgroundColor: '#1C1C1E' }}>Binder / Swatch Dropoff</option>
                                <option value="Binder Update" style={{ backgroundColor: '#1C1C1E' }}>Binder Update</option>
                                <option value="Showroom Display Install / Update" style={{ backgroundColor: '#1C1C1E' }}>Showroom Display Install / Update</option>
                                <option value="Client Check-In / Relationship Visit" style={{ backgroundColor: '#1C1C1E' }}>Client Check-In / Relationship Visit</option>
                                <option value="Issue Resolution" style={{ backgroundColor: '#1C1C1E' }}>Issue Resolution</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Notes</label>
                        <textarea
                            value={visitForm.notes}
                            onChange={(e) => setVisitForm({ ...visitForm, notes: e.target.value })}
                            placeholder="Additional notes"
                            style={{
                                width: '100%',
                                padding: '0.5rem',
                                border: '1px solid rgba(255,255,255,0.2)',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(255,255,255,0.05)',
                                color: '#FFF',
                                minHeight: '100px',
                                resize: 'vertical'
                            }}
                        />
                    </div>
                    <div className="form-group">
                        <label>Outcome</label>
                        <textarea
                            value={visitForm.outcome}
                            onChange={(e) => setVisitForm({ ...visitForm, outcome: e.target.value })}
                            placeholder="Visit outcome"
                            style={{
                                width: '100%',
                                padding: '0.5rem',
                                border: '1px solid rgba(255,255,255,0.2)',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(255,255,255,0.05)',
                                color: '#FFF',
                                minHeight: '100px',
                                resize: 'vertical'
                            }}
                        />
                    </div>
                    <div className="form-group">
                        <label>Attachments (Images/PDFs)</label>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '5px' }}>
                            <label style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '0.5rem 1rem',
                                border: '1px dashed rgba(255,255,255,0.3)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.875rem'
                            }}>
                                <Plus size={16} /> Upload
                                <input
                                    type="file"
                                    multiple
                                    accept="image/*,application/pdf"
                                    onChange={handleVisitImageUpload}
                                    style={{ display: 'none' }}
                                />
                            </label>
                            {isSaving && <span style={{ fontSize: '0.85rem', color: '#9CA3AF' }}>Uploading...</span>}
                        </div>
                        {visitForm.image && (Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image]).filter(Boolean).length > 0 && (
                            <div className="visit-images-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '10px', marginTop: '10px' }}>
                                {(Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image]).filter(Boolean).map((img, idx) => (
                                    <div key={idx} style={{ position: 'relative', aspectRatio: '1', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                                        {img.toLowerCase().endsWith('.pdf') ? (
                                            <div
                                                style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', cursor: 'pointer' }}
                                                onClick={() => handleDashboardDownload({ content: img, name: `Visit-Doc-${idx}.pdf`, type: 'file' })}
                                            >
                                                <FileText size={24} color="#EF4444" />
                                                <span style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '4px' }}>PDF</span>
                                            </div>
                                        ) : (
                                            <img
                                                src={resolveImageSrc(img)}
                                                alt="Attachment"
                                                style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                                                onClick={() => handleOpenGallery(Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image], idx)}
                                                loading="lazy"
                                            />
                                        )}
                                        <button
                                            onClick={() => handleRemoveVisitImage(idx)}
                                            style={{
                                                position: 'absolute',
                                                top: '2px',
                                                right: '2px',
                                                background: 'rgba(239, 68, 68, 0.9)',
                                                border: 'none',
                                                borderRadius: '50%',
                                                width: '18px',
                                                height: '18px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: '#FFF',
                                                cursor: 'pointer',
                                                padding: 0
                                            }}
                                        >
                                            <X size={10} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
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
                <div className="modal-body visit-view-body" style={{ color: '#FFF' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1.5rem' }}>
                        <div>
                            <div className="visit-detail-label">Date</div>
                            <div className="visit-detail-value">{formatDate(visitForm.date)}</div>
                        </div>
                        <div>
                            <div className="visit-detail-label">Customer</div>
                            <div className="visit-detail-value">
                                {customers.find(c => c._id === visitForm.customerId)?.company || 'Unknown Customer'}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
                        <div>
                            <div className="visit-detail-label">Visit Type</div>
                            <div className="visit-detail-value">{visitForm.type}</div>
                        </div>
                        <div>
                            <div className="visit-detail-label">Notes</div>
                            <div className="visit-detail-value" style={{ whiteSpace: 'pre-wrap' }}>{visitForm.notes || 'No notes added'}</div>
                        </div>
                        <div>
                            <div className="visit-detail-label">Outcome</div>
                            <div className="visit-detail-value" style={{ whiteSpace: 'pre-wrap' }}>{visitForm.outcome || 'No outcome recorded'}</div>
                        </div>
                        <div>
                            <div className="visit-detail-label">Attachments</div>
                            {visitForm.image && (Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image]).filter(Boolean).length > 0 ? (
                                <div className="visit-view-attachments" style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginTop: '5px' }}>
                                    {(Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image]).filter(Boolean).map((img, idx) => (
                                        <div key={idx} className="attachment-item">
                                            {img.toLowerCase().endsWith('.pdf') ? (
                                                <div
                                                    className="attachment-pdf"
                                                    onClick={() => handleDashboardDownload({ content: img, name: `Visit-Doc-${idx}.pdf`, type: 'file' })}
                                                >
                                                    <FileText size={32} />
                                                    <span style={{ fontSize: '10px', marginTop: '4px', fontWeight: 600 }}>PDF</span>
                                                </div>
                                            ) : (
                                                <img
                                                    src={resolveImageSrc(img)}
                                                    alt="Preview"
                                                    className="attachment-img"
                                                    onClick={() => handleOpenGallery(Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image], idx)}
                                                    style={{ borderRadius: '8px', cursor: 'pointer', width: '64px', height: '64px', objectFit: 'cover' }}
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

    return createPortal(
        isViewingVisit ? renderViewModal() : renderAddEditModal(),
        document.body
    );
};

export default VisitModal;
