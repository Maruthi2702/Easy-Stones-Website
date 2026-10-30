import { FileText, Trash2 } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import { FormSection } from '../../../components/shared/form/FormControls';
import { isPdfSource } from '../../../utils/attachments';
import { formatDate } from '../../../utils/dateUtils';
import { resourceQty } from '../../../utils/resourceForm';
import type { Loose } from '../../../types/records';
import { attachmentList, attachmentSrc } from './attachmentSrc';
import './ResourceForm.css';

export type ResourceViewProps = {
    resource: Loose;
    customerLabel: string;
    onClose: () => void;
    /** Edit resource (the main button); absent for a login that may not edit it. */
    onEdit?: () => void;
    /** Delete, on the footer's left; absent for a login that may not delete it. */
    onDelete?: () => void;
    /** "Open customer ›" (the customer's Resources tab). */
    onOpenCustomer?: () => void;
    onOpenGallery: (images: string[], index: number) => void;
    onDownload: (file: Loose) => void;
};

/**
 * A resource opened from a row: the same form shell, read-only (design: "Click
 * a row · view" on the Resources Redesign Canvas). Photos open full size, a
 * PDF downloads; Edit resource turns the same window into the edit form.
 */
export default function ResourceView({ resource, customerLabel, onClose, onEdit, onDelete, onOpenCustomer, onOpenGallery, onDownload }: ResourceViewProps) {
    const files = attachmentList(resource.image ?? resource.content);
    const photos = files.filter((f) => !isPdfSource(f));
    const type = resource.resourceType || resource.title || '—';
    const loggedBy = String(resource.uploadedByName || '').trim();

    return (
        <FormModal
            title={<>Resource <span className="fm-title-sub">· {customerLabel || 'Customer'}</span></>}
            size="m"
            onClose={onClose}
            onSubmit={() => onEdit?.()}
            submitLabel="Edit resource"
            hideSubmit={!onEdit}
            footerStart={onDelete ? (
                <button type="button" className="fm-btn fm-btn-text-danger" onClick={onDelete}>
                    <Trash2 size={16} aria-hidden="true" />
                    Delete resource
                </button>
            ) : null}
            footerNote={loggedBy ? `Logged by ${loggedBy}` : null}
        >
            <FormSection>
                <div className="rf-view-customer">
                    <div>
                        <strong>{customerLabel || '—'}</strong>
                        {resource.city ? <span>{resource.city}</span> : null}
                    </div>
                    {onOpenCustomer && (
                        <button type="button" className="rf-link" onClick={onOpenCustomer}>Open customer ›</button>
                    )}
                </div>
                <dl className="rf-facts">
                    <div><dt>Resource</dt><dd>{type}</dd></div>
                    <div><dt>Qty</dt><dd>{resourceQty(resource)}</dd></div>
                    <div><dt>Date</dt><dd>{resource.date ? formatDate(resource.date) : '—'}</dd></div>
                    <div><dt>Status</dt><dd>{resource.status || 'Active'}</dd></div>
                </dl>
            </FormSection>

            {(resource.description || resource.notes) && (
                <FormSection>
                    {resource.description && (
                        <div>
                            <div className="rf-note-label">Description</div>
                            <p className="rf-note">{resource.description}</p>
                        </div>
                    )}
                    {resource.notes && (
                        <div>
                            <div className="rf-note-label">Internal notes</div>
                            <p className="rf-note">{resource.notes}</p>
                        </div>
                    )}
                </FormSection>
            )}

            <FormSection>
                <div className="rf-note-label">Photos and PDFs</div>
                {files.length === 0 ? (
                    <span className="rf-empty">None added.</span>
                ) : (
                    <div className="rf-photos">
                        {files.map((src, idx) => (isPdfSource(src) ? (
                            <button
                                key={idx}
                                type="button"
                                className="rf-photo is-pdf"
                                onClick={() => onDownload({ content: src, name: `Attachment-${idx + 1}.pdf`, type: 'file' })}
                                aria-label={`Download PDF ${idx + 1}`}
                            >
                                <FileText size={22} aria-hidden="true" />PDF
                            </button>
                        ) : (
                            <button
                                key={idx}
                                type="button"
                                className="rf-photo"
                                onClick={() => onOpenGallery(photos.map(attachmentSrc), photos.indexOf(src))}
                                aria-label={`Open photo ${photos.indexOf(src) + 1} full size`}
                            >
                                <img src={attachmentSrc(src)} alt="" loading="lazy" />
                            </button>
                        )))}
                    </div>
                )}
            </FormSection>
        </FormModal>
    );
}
