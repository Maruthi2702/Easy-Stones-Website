import { useEffect, useState } from 'react';
import { ChevronDown, MapPin, Eye, Loader, User } from 'lucide-react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { formatDate, parseAsLocal } from '../../../utils/dateUtils';
import { splitCustomer } from '../../../components/sales/visitsListHelpers';
import VisitViewModal from './VisitViewModal';
import type { VisitDetails } from './VisitViewModal';
import type { Loose } from '../../../types/records';
import './DashboardFocus.css';

/**
 * Dashboard Sales Visits, the Focus board's list (design "Option A"): one row
 * per visit — date chip, company over contact, branch — that opens in place
 * to the visit's type, who logged it, follow-up and notes, with View / Edit /
 * Delete; the customer's name opens their card. View opens VisitViewModal, which reads the photos
 * and manager / HQ comments from the single-visit route (the list carries
 * neither). Edit / Delete / the name link are the page's own handlers.
 * canModify / canDelete say whether to offer them per visit; canOpenCustomer
 * is view_customers.
 */
export type VisitsFocusListProps = {
    visits?: Loose[];
    loading?: boolean;
    busyVisitId?: string | null;
    canModify?: (visit: Loose) => boolean;
    canDelete?: (visit: Loose) => boolean;
    canOpenCustomer?: boolean;
    /** More than the viewer is in view (the People filter): each row says who logged it. */
    showWhoLogged?: boolean;
    onOpenCustomer?: (visit: Loose) => void;
    onEdit?: (visit: Loose) => void;
    onDelete?: (visit: Loose) => void;
    onOpenGallery?: (images: string[], index: number) => void;
};

const VisitsFocusList = ({ visits = [], loading = false, busyVisitId = null, canModify, canDelete, canOpenCustomer = true, showWhoLogged = false, onOpenCustomer, onEdit, onDelete, onOpenGallery }: VisitsFocusListProps) => {
    const [openId, setOpenId] = useState<string | null>(null);
    const [viewing, setViewing] = useState<Loose | null>(null);
    // The opened visit's photos and comments; cleared on every open so an edit
    // saved meanwhile is read again.
    const [details, setDetails] = useState<VisitDetails | null>(null);

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
            .then((data: Loose | null) => {
                if (cancelled) return;
                const visit: Loose = data?.visit || {};
                const img = visit.image;
                setDetails({
                    status: 'done',
                    images: Array.isArray(img) ? img.filter(Boolean) : (img ? [img as string] : []),
                    managerComment: String(visit.managerComment || '').trim(),
                    headquartersComment: String(visit.headquartersComment || '').trim()
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

    const allowedEdit = (v: Loose) => (canModify ? canModify(v) : true);
    const allowedDelete = (v: Loose) => (canDelete ? canDelete(v) : true);

    return (
        <>
            <ul className="dfx-list" aria-label="Sales visits">
                {visits.map(visit => {
                    const { company, contact } = splitCustomer(visit);
                    const open = openId === visit._id;
                    const d = parseAsLocal(visit.date) as Date;
                    const valid = Boolean(d) && Number.isFinite(d.getTime());
                    const by = showWhoLogged ? String(visit.createdByName || '').trim() : '';
                    return (
                        <li key={visit._id as string} className={open ? 'is-open' : ''}>
                            <div className="dfx-row" onClick={() => setOpenId(open ? null : (visit._id as string))}>
                                <span className="dfx-date" aria-hidden="true">
                                    <span>{valid ? d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : ''}</span>
                                    <strong>{valid ? d.getDate() : ''}</strong>
                                </span>
                                <span className="dfx-row-text">
                                    {canOpenCustomer && visit.customerId ? (
                                        <button
                                            type="button" className="dfx-row-company dfx-name-link" title="Open customer"
                                            onClick={(e) => { e.stopPropagation(); onOpenCustomer?.(visit); }}
                                        >{company}</button>
                                    ) : (
                                        <span className="dfx-row-company">{company}</span>
                                    )}
                                    <span className="dfx-row-contact">{contact || ' '}{Boolean(visit.location) && <span className="dfx-phone-only"> · {visit.location as string}</span>}{Boolean(by) && <span className="dfx-phone-only"> · by {by}</span>}</span>
                                </span>
                                {Boolean(visit._saving) && <span className="dfx-saving" role="status"><Loader size={12} className="animate-spin" aria-hidden="true" />Saving…</span>}
                                {Boolean(by) && <span className="dfx-pill dfx-pill--rep" title={`Logged by ${by}`}><User size={11} aria-hidden="true" />{by}</span>}
                                {Boolean(visit.location) && <span className="dfx-pill"><MapPin size={11} aria-hidden="true" />{visit.location as string}</span>}
                                <button
                                    type="button" className="dfx-chev-btn" aria-expanded={open}
                                    aria-label={open ? 'Hide visit details' : 'Show visit details'}
                                    onClick={(e) => { e.stopPropagation(); setOpenId(open ? null : (visit._id as string)); }}
                                >
                                    <ChevronDown size={18} className="dfx-chev" aria-hidden="true" />
                                </button>
                            </div>
                            {open && (
                                <div className="dfx-open">
                                    <div className="dfx-chips">
                                        <span><em>Type </em><strong>{(visit.purpose as string) || '—'}</strong></span>
                                        <span><em>Logged by </em><strong>{(visit.createdByName as string) || '—'}</strong></span>
                                        <span><em>Follow-up </em><strong>{visit.followUpDate ? formatDate(visit.followUpDate as string, { month: 'short', day: 'numeric' }) : 'None'}</strong></span>
                                    </div>
                                    <p>{(visit.notes as string) || 'No notes.'}</p>
                                    <div className="dfx-actions">
                                        <button type="button" className="dfx-btn dfx-btn--dark" onClick={() => setViewing(visit)} disabled={Boolean(visit._saving)}><Eye size={15} aria-hidden="true" />View</button>
                                        {allowedEdit(visit) && (
                                            <button type="button" className="dfx-btn" onClick={() => onEdit?.(visit)} disabled={Boolean(visit._saving) || busyVisitId === visit._id}>Edit</button>
                                        )}
                                        {allowedDelete(visit) && (
                                            <button type="button" className="dfx-btn dfx-btn--danger" onClick={() => onDelete?.(visit)} disabled={Boolean(visit._saving)}>Delete</button>
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
