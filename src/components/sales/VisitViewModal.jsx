import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Pencil, Trash2, Loader, FileText, Handshake, StickyNote, Calendar } from 'lucide-react';
import { API_URL } from '../../config/api';
import { formatDate } from '../../utils/dateUtils';
import { isPdfSource } from '../../utils/attachments';
import { splitCustomer } from './visitsListHelpers';
import './DashboardFocus.css';

const resolveImageSrc = (img) => {
    if (!img) return '';
    if (img.startsWith('data:') || img.startsWith('http')) return img;
    if (img.startsWith('/uploads')) return `${API_URL}${img}`;
    return `${API_URL}/uploads/visits/${img}`;
};

/**
 * The read view of one visit (design "Option A · View pop-up"): same fields
 * and order as the Add / Edit visit form, a field with nothing in it isn't
 * shown. The customer's name opens their profile only when `onOpenCustomer`
 * is given (view_customers); Edit / Delete only when allowed. A dialog on
 * wide screens, a bottom sheet under 640px (CSS).
 */
const VisitViewModal = ({ visit, details, onClose, onOpenCustomer, onEdit, onDelete, onOpenGallery, busy = false }) => {
    const ref = useRef(null);
    const { company, contact } = splitCustomer(visit);

    useEffect(() => {
        const previous = document.activeElement;
        ref.current?.focus({ preventScroll: true });
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
        document.addEventListener('keydown', onKey, true);
        const html = document.documentElement;
        const had = html.style.overflow;
        html.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey, true);
            html.style.overflow = had;
            previous?.focus?.({ preventScroll: true });
        };
    }, [onClose]);

    const images = details?.images || [];
    // Same kinds and colours as the profile's visit card (VisitPostCard).
    const purpose = (visit.purpose || '').toLowerCase();
    const isQuickNote = purpose.includes('quick note');
    const isResource = purpose.includes('resource');
    const isMeeting = purpose.includes('meeting') || purpose.includes('visit');
    const kind = isQuickNote ? 'quick-note' : (isResource ? 'resource' : 'meeting');
    const plain = /quick note|resource placement|resource update/i.test(visit.purpose || '');
    const rows = [
        !plain && visit.outcome && ['outcome', 'OUTCOME', visit.outcome],
        !plain && visit.followUp && ['follow-up', 'FOLLOW UP', visit.followUp],
        visit.followUpDate && ['follow-up', 'FOLLOW-UP DATE', formatDate(visit.followUpDate, { month: 'short', day: 'numeric', year: 'numeric' })],
        details?.managerComment && ['manager-comment', 'MANAGER COMMENT', details.managerComment],
        details?.headquartersComment && ['hq-comment', 'HQ COMMENT', details.headquartersComment],
        visit.nextAction && ['next-action', 'NEXT STEPS', visit.nextAction],
    ].filter(Boolean);
    const note = visit.createdByName ? `Logged by ${visit.createdByName} · ${formatDate(visit.date, { month: 'short', day: 'numeric' })}` : '';

    return createPortal(
        <div className="dfx-modal-wrap">
            <button type="button" className="dfx-modal-backdrop" aria-label="Close visit" onClick={onClose} />
            <article className="dfx-modal" role="dialog" aria-modal="true" aria-labelledby="dfx-view-title" tabIndex={-1} ref={ref}>
                <header className="dfx-modal-head">
                    <div className="dfx-modal-title">
                        <h2 id="dfx-view-title">
                            {onOpenCustomer
                                ? <button type="button" className="dfx-link" title="Open customer" onClick={() => onOpenCustomer(visit)}>{company}</button>
                                : <span>{company}</span>}
                        </h2>
                        <span>{[contact, visit.location].filter(Boolean).join(' · ')}</span>
                    </div>
                    <button type="button" className="dfx-close" aria-label="Close" title="Close" onClick={onClose}><X size={16} strokeWidth={2.6} /></button>
                </header>

                <div className="dfx-modal-body">
                    <div className="dfx-visit-top">
                        {visit.purpose && (
                            <div className={`post-purpose-badge ${kind}`}>
                                {isMeeting ? <Handshake size={14} className="badge-icon" /> : (isQuickNote ? <StickyNote size={14} className="badge-icon" /> : <Calendar size={14} className="badge-icon" />)}
                                <span>{visit.purpose}</span>
                            </div>
                        )}
                        <span className="dfx-visit-date">{formatDate(visit.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                    {visit.notes && <p className="post-text">{visit.notes}</p>}
                    {rows.length > 0 && (
                        <div className="post-details-ext">
                            {rows.map(([cls, label, value]) => (
                                <div key={cls} className={`post-detail-row ${cls}`}>
                                    <span className="detail-label">{label}:</span>
                                    <span className="detail-value">{value}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {(!details || details.status === 'loading') && (
                        <div className="dfx-muted"><Loader size={14} className="animate-spin" /> Loading photos…</div>
                    )}
                    {details?.status === 'error' && <div className="dfx-muted">Couldn&apos;t load photos or comments.</div>}
                    {images.length > 0 && (
                        <div>
                            <span className="dfx-label">Attachments</span>
                            <div className="dfx-photos">
                                {images.map((img, idx) => (
                                    <button
                                        type="button"
                                        key={idx}
                                        onClick={() => onOpenGallery?.(images, idx)}
                                        aria-label={isPdfSource(img) ? `Open PDF ${idx + 1}` : `Open photo ${idx + 1}`}
                                    >
                                        {isPdfSource(img)
                                            ? <span><FileText size={22} aria-hidden="true" />PDF</span>
                                            : <img src={resolveImageSrc(img)} alt="" loading="lazy" />}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <footer className="dfx-modal-foot">
                    {onDelete && (
                        <button type="button" className="dfx-btn dfx-btn--danger-ghost" onClick={() => onDelete(visit)}>
                            <Trash2 size={16} aria-hidden="true" /> Delete visit
                        </button>
                    )}
                    <span className="dfx-modal-note">{note}</span>
                    {onEdit && (
                        <button type="button" className="dfx-btn dfx-btn--gold" onClick={() => onEdit(visit)} disabled={busy}>
                            {busy ? <Loader size={15} className="animate-spin" /> : <Pencil size={15} aria-hidden="true" />} Edit visit
                        </button>
                    )}
                </footer>
            </article>
        </div>,
        document.body
    );
};

export default VisitViewModal;
