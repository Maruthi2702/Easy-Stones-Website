import React, { useState } from 'react';
import { X, FileText } from 'lucide-react';
import { API_URL } from '../../config/api';
import { formatDate } from '../../utils/dateUtils';
import { isPdfSource } from '../../utils/attachments';
import { hasFollowUp } from '../../utils/visitForm';
import VisitForm from './VisitForm';

const VisitModal = ({
    showVisitModal,
    isViewingVisit,
    handleCloseVisitModal,
    editingVisit,
    visitForm,
    setVisitForm,
    customerOptions,
    isSaving,
    handleSaveVisit,
    handleVisitImageUpload,
    handleRemoveVisitImage,
    selectedCustomer,
    customers,
    handleDashboardDownload,
    handleOpenGallery,
    onCreateNew,
    isDropdownLoading,
    // Add / Edit form only:
    canDelete = false,
    onDelete,
    // True while Add customer is open on top: the form steps aside (it would
    // otherwise paint over it) and comes back with everything still filled in.
    suspended = false
}) => {
    const formOpen = showVisitModal && !isViewingVisit;

    // One open form: where it started (for "Save changes" and the discard
    // check) and the follow-up toggle. Kept here, not in VisitForm, so both
    // survive the form stepping aside (`suspended`).
    //   choice — the follow-up toggle once touched (null = on if the visit
    //            already has follow-up details)
    //   kept   — what turning it off cleared, put back if it's turned on again
    const [session, setSession] = useState(null);
    if (formOpen && !session) setSession({ initial: visitForm, choice: null, kept: null });
    if (!formOpen && session) setSession(null);

    if (!showVisitModal) return null;

    const resolveImageSrc = (img) => {
        if (!img) return '';
        if (img.startsWith('data:') || img.startsWith('http')) return img;
        if (img.startsWith('/uploads')) return `${API_URL}${img}`;
        return `${API_URL}/uploads/visits/${img}`;
    };

    const customerName = () => {
        const id = visitForm.customerId || editingVisit?.customerId;
        const option = (customerOptions || []).find((o) => o.value === id);
        if (option) return option.label;
        if (selectedCustomer && (!id || selectedCustomer._id === id)) return selectedCustomer.company || selectedCustomer.contactName;
        const c = (customers || []).find((x) => x._id === id);
        if (c) return c.company || c.contactName;
        return visitForm?.customerContactName || visitForm?.customerName || editingVisit?.customerName || '';
    };

    const renderAddEditForm = () => {
        if (suspended || !session) return null;
        const { initial } = session;
        const followUpOn = session.choice ?? hasFollowUp(initial);
        // Off clears the follow-up fields so they aren't saved.
        const setFollowUp = (on) => {
            if (on === followUpOn) return;
            if (!on) {
                const kept = { followUp: visitForm.followUp || '', followUpDate: visitForm.followUpDate || '' };
                setVisitForm((v) => ({ ...v, followUp: '', followUpDate: '' }));
                setSession((s) => ({ ...s, choice: false, kept }));
            } else {
                if (session.kept) setVisitForm((v) => ({ ...v, ...session.kept }));
                setSession((s) => ({ ...s, choice: true, kept: null }));
            }
        };
        return (
            <VisitForm
                isEdit={Boolean(editingVisit)}
                visit={editingVisit}
                values={visitForm}
                setValues={setVisitForm}
                initial={initial}
                followUpOn={followUpOn}
                onFollowUpChange={setFollowUp}
                customerOptions={customerOptions}
                customersLoading={isDropdownLoading}
                customerLabel={editingVisit || visitForm.customerId ? customerName() : ''}
                saving={isSaving}
                onSave={handleSaveVisit}
                onClose={handleCloseVisitModal}
                onUpload={handleVisitImageUpload}
                onRemoveImage={handleRemoveVisitImage}
                onCreateCustomer={onCreateNew}
                canDelete={canDelete}
                onDelete={onDelete}
            />
        );
    };

    const renderViewModal = () => (
        <div className="modal-overlay visit-modal-overlay" onClick={handleCloseVisitModal}>
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
                        {!visitForm.purpose?.toLowerCase().match(/quick note|resource placement|resource update/i) && (
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
                                            {isPdfSource(img) ? (
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

    return isViewingVisit ? renderViewModal() : renderAddEditForm();
};

export default VisitModal;
