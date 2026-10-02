import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Pencil, Trash2, Loader, FileText, ArrowRight } from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { formatDate } from '../../utils/dateUtils';
import { isPdfSource } from '../../utils/attachments';
import { splitCustomer } from './visitsListHelpers';
import './VisitsListDetail.css';

const resolveImageSrc = (img) => {
    if (!img) return '';
    if (img.startsWith('data:') || img.startsWith('http')) return img;
    if (img.startsWith('/uploads')) return `${API_URL}${img}`;
    return `${API_URL}/uploads/visits/${img}`;
};

/**
 * Dashboard Sales Visits as a list + detail (design option C).
 *
 * Wide screens show the list and the selected visit side by side; under 768px
 * the list shows alone and tapping a visit swaps in its detail, with a back
 * button (pure CSS on [data-open], see VisitsListDetail.css). The list rows
 * come from GET /api/dashboard/visits, which carries no photos or comments;
 * the selected visit's photos and manager/HQ comments are fetched on their own
 * from the single-visit route, so the list stays light.
 *
 * Edit, delete, opening the customer and the photo gallery are the page's own
 * handlers, passed in — this only lays the visits out. canModify / canDelete
 * say whether to offer Edit and Delete for a visit (canModifyVisit /
 * canDeleteVisit in src/utils/visitAccess.js); omitted, both are offered.
 */
const VisitsListDetail = ({ visits = [], dataVersion, loading = false, busyVisitId = null, canModify, canDelete, onOpenCustomer, onEdit, onDelete, onOpenGallery }) => {
    const [selectedId, setSelectedId] = useState(null);
    const [mobileOpen, setMobileOpen] = useState(false);
    // visitId → { status, images, managerComment, headquartersComment } — the
    // parts of a visit the dashboard list doesn't carry.
    const [details, setDetails] = useState({});
    const rootRef = useRef(null);

    const selected = useMemo(
        () => visits.find(v => v._id === selectedId) || visits[0] || null,
        [visits, selectedId]
    );

    // Each new server response (a save, a delete, a new range or location) is
    // the token — `dataVersion`, not `visits`: searching or paging re-slices the
    // same data and mustn't refetch. A visit's photos/comments read for an older one stay on screen
    // until they're re-read for this one, then replaced. This used to clear
    // everything on a new list — and when the same visit stayed selected nothing
    // asked for it again, so its photos sat on "Loading…" for good.
    const listToken = dataVersion ?? visits;
    // Read inside the fetch effect without making every details change refetch.
    const detailsRef = useRef(details);
    useEffect(() => { detailsRef.current = details; }, [details]);

    useEffect(() => {
        const id = selected?._id;
        if (!id || !selected.customerId) return undefined;
        const have = detailsRef.current[id];
        if (have && have.token === listToken) return undefined;
        let cancelled = false;
        authFetch(`${API_URL}/api/customers/${selected.customerId}/visits/${id}`)
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (cancelled) return;
                const visit = data?.visit || {};
                const img = visit.image;
                const images = Array.isArray(img) ? img.filter(Boolean) : (img ? [img] : []);
                setDetails(p => ({
                    ...p,
                    [id]: {
                        status: 'done',
                        token: listToken,
                        images,
                        managerComment: (visit.managerComment || '').trim(),
                        headquartersComment: (visit.headquartersComment || '').trim()
                    }
                }));
            })
            .catch(() => {
                if (!cancelled) setDetails(p => ({ ...p, [id]: { status: 'error', images: [], token: listToken } }));
            });
        return () => { cancelled = true; };
    }, [selected?._id, selected?.customerId, listToken]);

    const openVisit = (visit) => {
        setSelectedId(visit._id);
        setMobileOpen(true);
        // On a phone the detail replaces the list in place; bring its top into view.
        if (window.innerWidth < 768) {
            requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
        }
    };

    if (visits.length === 0) {
        return (
            <div className="vld vld--empty">
                {loading
                    ? <span><Loader size={16} className="animate-spin vld-spin" /> Loading…</span>
                    : <span>No visits for this period.</span>}
            </div>
        );
    }

    const sel = selected ? splitCustomer(selected) : null;
    const selectedEditable = Boolean(selected) && (canModify ? canModify(selected) : true);
    const selectedDeletable = Boolean(selected) && (canDelete ? canDelete(selected) : true);
    const photoState = selected ? details[selected._id] : null;
    const hasComments = Boolean(photoState?.managerComment || photoState?.headquartersComment);

    return (
        <div className="vld" data-open={mobileOpen ? 'true' : 'false'} ref={rootRef}>
            <ul className="vld-list" aria-label="Sales visits">
                {visits.map(visit => {
                    const { company, contact } = splitCustomer(visit);
                    const isSelected = selected?._id === visit._id;
                    return (
                        <li key={visit._id}>
                            <button
                                type="button"
                                className={`vld-row${isSelected ? ' is-selected' : ''}`}
                                aria-current={isSelected ? 'true' : undefined}
                                onClick={() => openVisit(visit)}
                            >
                                <span className="vld-row-top">
                                    <span className="vld-row-company">{company}</span>
                                    <span className="vld-row-date">{formatDate(visit.date, { month: 'short', day: 'numeric' })}</span>
                                </span>
                                <span className="vld-row-bottom">
                                    <span className="vld-row-contact">{contact || ' '}</span>
                                    {/* The customer's branch, not the visit type: the type is
                                        in the detail, and "Meeting" on 72% of rows told nobody anything. */}
                                    {visit.location && (
                                        <span className="vld-tag vld-tag--location">
                                            <MapPin size={12} aria-hidden="true" />{visit.location}
                                        </span>
                                    )}
                                </span>
                                <ChevronRight size={18} className="vld-row-chevron" aria-hidden="true" />
                            </button>
                        </li>
                    );
                })}
            </ul>

            {selected && (
                <section className="vld-detail" aria-label={`Visit to ${sel.company}`}>
                    <button type="button" className="vld-back" onClick={() => setMobileOpen(false)}>
                        <ChevronLeft size={20} aria-hidden="true" /> Visits
                    </button>

                    <div className="vld-head">
                        <div className="vld-head-text">
                            <button type="button" className="vld-company" onClick={() => onOpenCustomer?.(selected)}>
                                {sel.company}
                            </button>
                            <span className="vld-sub">
                                {sel.contact ? `${sel.contact} · ` : ''}
                                {formatDate(selected.date, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                        </div>
                        {(selectedEditable || selectedDeletable) && (
                        <div className="vld-actions">
                            {selectedEditable && (
                            <button type="button" className="vld-btn" onClick={() => onEdit?.(selected)} disabled={busyVisitId === selected._id}>
                                {busyVisitId === selected._id ? <Loader size={16} className="animate-spin" /> : <Pencil size={16} />}
                                Edit
                            </button>
                            )}
                            {selectedDeletable && (
                            <button type="button" className="vld-btn vld-btn--danger" aria-label="Delete visit" onClick={() => onDelete?.(selected)}>
                                <Trash2 size={17} />
                            </button>
                            )}
                        </div>
                        )}
                    </div>

                    <dl className="vld-meta">
                        <div className="vld-meta-type"><dt>Visit type</dt><dd>{selected.purpose || '—'}</dd></div>
                        <div><dt>Logged by</dt><dd>{selected.createdByName || '—'}</dd></div>
                        <div>
                            <dt>Location</dt>
                            <dd className="vld-location">
                                {selected.location ? <><MapPin size={15} aria-hidden="true" />{selected.location}</> : '—'}
                            </dd>
                        </div>
                        <div>
                            <dt>Follow-up</dt>
                            <dd className={selected.followUpDate ? 'vld-followup' : ''}>
                                {selected.followUpDate
                                    ? formatDate(selected.followUpDate, { weekday: 'short', month: 'short', day: 'numeric' })
                                    : 'None'}
                            </dd>
                        </div>
                    </dl>

                    <div className="vld-block">
                        <h3>Notes</h3>
                        <p>{selected.notes || 'No notes.'}</p>
                    </div>

                    {(selected.followUp || selected.nextAction) && (
                        <div className="vld-block">
                            <h3>Follow-up notes</h3>
                            <p>{selected.followUp || selected.nextAction}</p>
                        </div>
                    )}

                    {selected.outcome && (
                        <div className="vld-block">
                            <h3>Outcome</h3>
                            <p>{selected.outcome}</p>
                        </div>
                    )}

                    {/* Manager and HQ comments: someone else's words on this
                        visit, so set apart from the rep's own notes above. */}
                    {hasComments && (
                        <div className="vld-block">
                            <h3>Comments</h3>
                            <div className="vld-comments">
                                {photoState.managerComment && (
                                    <div className="vld-comment vld-comment--manager">
                                        <span className="vld-comment-who">Manager</span>
                                        <p>{photoState.managerComment}</p>
                                    </div>
                                )}
                                {photoState.headquartersComment && (
                                    <div className="vld-comment vld-comment--hq">
                                        <span className="vld-comment-who">HQ</span>
                                        <p>{photoState.headquartersComment}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="vld-block">
                        <h3>Photos</h3>
                        {(!photoState || photoState.status === 'loading') && (
                            <span className="vld-muted"><Loader size={14} className="animate-spin vld-spin" /> Loading photos…</span>
                        )}
                        {photoState?.status === 'error' && <span className="vld-muted">Couldn&apos;t load photos.</span>}
                        {photoState?.status === 'done' && photoState.images.length === 0 && <span className="vld-muted">No photos.</span>}
                        {photoState?.status === 'done' && photoState.images.length > 0 && (
                            <div className="vld-photos">
                                {photoState.images.map((img, idx) => (
                                    <button
                                        type="button"
                                        key={idx}
                                        className="vld-photo"
                                        onClick={() => onOpenGallery?.(photoState.images, idx)}
                                        aria-label={isPdfSource(img) ? `Open PDF ${idx + 1}` : `Open photo ${idx + 1}`}
                                    >
                                        {isPdfSource(img)
                                            ? <span className="vld-photo-pdf"><FileText size={22} aria-hidden="true" />PDF</span>
                                            : <img src={resolveImageSrc(img)} alt="" loading="lazy" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button type="button" className="vld-open-customer" onClick={() => onOpenCustomer?.(selected)}>
                        Open customer <ArrowRight size={16} aria-hidden="true" />
                    </button>
                </section>
            )}
        </div>
    );
};

export default VisitsListDetail;
