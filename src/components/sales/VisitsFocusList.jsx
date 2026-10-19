import React, { useEffect, useState } from 'react';
import { ChevronDown, MapPin, Eye, Loader } from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { formatDate } from '../../utils/dateUtils';
import { splitCustomer } from './visitsListHelpers';
import VisitViewModal from './VisitViewModal';
import './DashboardFocus.css';

/**
 * Dashboard Sales Visits, the Focus board's list (design "Option A"): one row
 * per visit — date chip, company over contact, branch — that opens in place
 * to the visit's type, who logged it, follow-up and notes, with View / Edit /
 * Delete / Open customer. View opens VisitViewModal, which reads the photos
 * and manager / HQ comments from the single-visit route (the list carries
 * neither). Edit / Delete / the customer link are the page's own handlers.
 * canModify / canDelete say whether to offer them per visit; canOpenCustomer
 * is view_customers.
 */
const VisitsFocusList = ({ visits = [], loading = false, busyVisitId = null, canModify, canDelete, canOpenCustomer = true, onOpenCustomer, onEdit, onDelete, onOpenGallery }) => {
    const [openId, setOpenId] = useState(null);
    const [viewing, setViewing] = useState(null);
    // The opened visit's photos and comments; cleared on every open so an edit
    // saved meanwhile is read again.
    const [details, setDetails] = useState(null);

    // The first visit starts open, as in the design — until the list changes under it.
    useEffect(() => {
        setOpenId(prev => (prev && visits.some(v => v._id === prev) ? prev : (visits[0]?._id ?? null)));
    }, [visits]);

    useEffect(() => {
        if (!viewing) { setDetails(null); return undefined; }
        if (!viewing.customerId) { setDetails({ status: 'done', images: [] }); return undefined; }
        let cancelled = false;
        setDetails({ status: 'loading', images: [] });
        authFetch(`${API_URL}/api/customers/${viewing.customerId}/visits/${viewing._id}`)
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (cancelled) return;
                const visit = data?.visit || {};
                const img = visit.image;
                setDetails({
                    status: 'done',
                    images: Array.isArray(img) ? img.filter(Boolean) : (img ? [img] : []),
                    managerComment: (visit.managerComment || '').trim(),
                    headquartersComment: (visit.headquartersComment || '').trim()
                });
            })
            .catch(() => { if (!cancelled) setDetails({ status: 'error', images: [] }); });
        return () => { cancelled = true; };
    }, [viewing]);

    if (visits.length === 0) {
        return (
            <div className="dfx-empty">
                {loading ? <span><Loader size={16} className="animate-spin" /> Loading…</span> : <span>No visits for this period.</span>}
            </div>
        );
    }

    const allowedEdit = (v) => (canModify ? canModify(v) : true);
    const allowedDelete = (v) => (canDelete ? canDelete(v) : true);

    return (
        <>
            <ul className="dfx-list" aria-label="Sales visits">
                {visits.map(visit => {
                    const { company, contact } = splitCustomer(visit);
                    const open = openId === visit._id;
                    const d = new Date(visit.date);
                    const valid = Number.isFinite(d.getTime());
                    return (
                        <li key={visit._id} className={open ? 'is-open' : ''}>
                            <button type="button" className="dfx-row" aria-expanded={open} onClick={() => setOpenId(open ? null : visit._id)}>
                                <span className="dfx-date" aria-hidden="true">
                                    <span>{valid ? d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : ''}</span>
                                    <strong>{valid ? d.getDate() : ''}</strong>
                                </span>
                                <span className="dfx-row-text">
                                    <span className="dfx-row-company">{company}</span>
                                    <span className="dfx-row-contact">{contact || ' '}{visit.location && <span className="dfx-phone-only"> · {visit.location}</span>}</span>
                                </span>
                                {visit.location && <span className="dfx-pill"><MapPin size={11} aria-hidden="true" />{visit.location}</span>}
                                <ChevronDown size={18} className="dfx-chev" aria-hidden="true" />
                            </button>
                            {open && (
                                <div className="dfx-open">
                                    <div className="dfx-chips">
                                        <span><em>Type </em><strong>{visit.purpose || '—'}</strong></span>
                                        <span><em>Logged by </em><strong>{visit.createdByName || '—'}</strong></span>
                                        <span><em>Follow-up </em><strong>{visit.followUpDate ? formatDate(visit.followUpDate, { month: 'short', day: 'numeric' }) : 'None'}</strong></span>
                                    </div>
                                    <p>{visit.notes || 'No notes.'}</p>
                                    <div className="dfx-actions">
                                        <button type="button" className="dfx-btn dfx-btn--dark" onClick={() => setViewing(visit)}><Eye size={15} aria-hidden="true" />View</button>
                                        {allowedEdit(visit) && (
                                            <button type="button" className="dfx-btn" onClick={() => onEdit?.(visit)} disabled={busyVisitId === visit._id}>Edit</button>
                                        )}
                                        {allowedDelete(visit) && (
                                            <button type="button" className="dfx-btn dfx-btn--danger" onClick={() => onDelete?.(visit)}>Delete</button>
                                        )}
                                        {canOpenCustomer && (
                                            <button type="button" className="dfx-link dfx-open-customer" onClick={() => onOpenCustomer?.(visit)}>Open customer →</button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
            {viewing && (
                <VisitViewModal
                    visit={viewing}
                    details={details}
                    busy={busyVisitId === viewing._id}
                    onClose={() => setViewing(null)}
                    onOpenCustomer={canOpenCustomer ? (v) => { setViewing(null); onOpenCustomer?.(v); } : undefined}
                    onEdit={allowedEdit(viewing) ? (v) => { setViewing(null); onEdit?.(v); } : undefined}
                    onDelete={allowedDelete(viewing) ? (v) => { setViewing(null); onDelete?.(v); } : undefined}
                    onOpenGallery={onOpenGallery}
                />
            )}
        </>
    );
};

export default VisitsFocusList;
