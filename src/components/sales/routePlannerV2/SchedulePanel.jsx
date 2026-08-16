import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { buildMonthGrid, todayKey, nameOf, real } from './helpers';
import ScheduleVisitForm from './ScheduleVisitForm';
import './SchedulePanel.css';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const timeLabel = (startTime) => {
    const d = new Date(startTime);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

// Same activity → colour mapping as the Dashboard's own week/month planner
// (ACTIVITY_COLORS in SalesPlannerTab.jsx, styled via .pl-item--* in
// SalesPage.css) — kept as its own small copy here rather than importing
// across that boundary, since it's four fixed brand colours, not shared
// logic, and the two screens don't otherwise share a module.
const ACTIVITY_MODIFIER = { Visit: 'visit', Call: 'call', 'Drop-off': 'dropoff' };
const activityModifier = (type) => ACTIVITY_MODIFIER[type] || 'other';

/**
 * "Schedule" — a month calendar plus the selected day's scheduled visits,
 * reached from RunDrawer's Calendar icon on every screen size (unlike the
 * map's mobile-only Lasso/locate shortcuts, this is a full nav item, not a
 * shortcut for something reachable elsewhere). Read-only: it's a second
 * lens onto the same `/api/schedule` data Tools/AreaScheduleSection already
 * write to (visitsByDate, grouped in RoutePlannerV2.jsx from whatever's
 * been fetched so far), the way ToolsPanel's own list is a lens onto the
 * current selection rather than a separate source of truth.
 *
 * visitsByDate only ever has what's actually been fetched — RoutePlannerV2
 * doesn't own a full history up front, since that's an unbounded amount of
 * data for a screen that's usually only looking a few weeks out either way.
 * onMonthChange fires below whenever the visible month changes (including
 * on open) so RoutePlannerV2 can fetch that specific month in, keeping
 * paging around the calendar correct for months outside whatever window
 * loadScheduled originally warmed up with.
 *
 * Add/edit opens as a sheet layered over the calendar+list (.rpv2-schedule-
 * form-overlay, absolutely positioned within .rpv2-schedule-body) rather
 * than swapping them out — the calendar+list stay mounted underneath the
 * whole time, so closing the form (Cancel, or a successful save) just
 * removes the overlay and reveals them exactly as they were, instead of
 * re-rendering a "browse" view from scratch.
 */
const SchedulePanel = ({
    onClose, visitsByDate, onSelectVisit, onMonthChange, onDeleteVisit, monthLoading,
    customerOptions, onSaveVisit, savingVisit
}) => {
    const [viewMonth, setViewMonth] = useState(() => {
        const d = new Date();
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        return d;
    });
    const [selectedDate, setSelectedDate] = useState(() => todayKey());
    // formOpen toggles the whole panel body over to ScheduleVisitForm;
    // editingVisit distinguishes which mode that form is in — null while
    // adding a new visit, or the visit object being edited. Kept local
    // (not lifted to RoutePlannerV2) since it's pure "which view is this
    // panel showing right now" state, same as viewMonth/selectedDate above.
    const [formOpen, setFormOpen] = useState(false);
    const [editingVisit, setEditingVisit] = useState(null);
    // Collapses the month grid down to just its header (month label + prev/
    // next) so the day's visit list below gets more room — the grid itself
    // adds little once you already know which day you're looking at, and on
    // a phone (this screen's primary use, see the touch-target comment in
    // SchedulePanel.css) a 22-visit day like the one that prompted this can
    // otherwise get scrolled well below the fold. Defaults open; not
    // persisted, same as viewMonth/selectedDate resetting fresh per mount.
    const [calOpen, setCalOpen] = useState(true);

    useEffect(() => { onMonthChange?.(viewMonth); }, [viewMonth, onMonthChange]);

    const grid = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
    const monthLabel = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const dayVisits = visitsByDate.get(selectedDate) || [];
    const todayCount = (visitsByDate.get(todayKey()) || []).length;
    const selectedLabel = new Date(`${selectedDate}T00:00:00`)
        .toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

    const shiftMonth = (delta) => {
        setViewMonth(prev => {
            const next = new Date(prev);
            next.setMonth(next.getMonth() + delta);
            return next;
        });
    };

    // Paging away from the current month used to be a one-way trip — the
    // only way back was clicking the left chevron however many times it
    // took. This jumps both the visible month and the selected day back to
    // today in one tap, same as the Dashboard planner's own "Today" button.
    const jumpToToday = () => {
        const now = new Date();
        now.setDate(1);
        now.setHours(0, 0, 0, 0);
        setViewMonth(now);
        setSelectedDate(todayKey());
    };

    const openAdd = () => { setEditingVisit(null); setFormOpen(true); };
    const openEdit = (visit) => { setEditingVisit(visit); setFormOpen(true); };
    const closeForm = () => { setFormOpen(false); setEditingVisit(null); };

    // Follows the saved visit to whatever day it actually landed on —
    // editing one can move it to a different day/month than the one you
    // started from, and a rep should see it land there, not have the form
    // just close back onto the day they happened to be looking at before.
    const handleSubmitForm = async (form) => {
        const saved = await onSaveVisit(form, editingVisit?._id);
        if (!saved) return; // onSaveVisit already surfaced the error via RoutePlannerV2's `error` state
        const savedDate = new Date(saved.startTime);
        setSelectedDate(todayKey(savedDate));
        const month = new Date(savedDate.getFullYear(), savedDate.getMonth(), 1);
        setViewMonth(month);
        closeForm();
    };

    return (
        <div className="rpv2-panel" data-dialog="schedule">
            <div className="rpv2-panel-head">
                <div className="rpv2-panel-head-top">
                    <Calendar size={16} />
                    <span className="rpv2-panel-head-title">Schedule</span>
                    {/* Doubles as a status ("N today") and a shortcut back to
                        today once you've paged elsewhere — always clickable,
                        not just shown when there's something to report. */}
                    <button
                        type="button"
                        className={`rpv2-schedule-today-badge ${todayCount > 0 ? 'has-count' : ''}`}
                        onClick={jumpToToday}
                        title="Jump to today"
                    >
                        {todayCount > 0 ? `${todayCount} today` : 'Today'}
                    </button>
                    <button type="button" className="rpv2-panel-close" onClick={onClose} aria-label="Close">
                        <X size={18} />
                    </button>
                </div>
            </div>

            <div className="rpv2-schedule-body">
            <div className="rpv2-schedule-cal">
                <div className="rpv2-schedule-cal-head">
                    <div className="rpv2-schedule-cal-nav">
                        <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                            <ChevronLeft size={16} />
                        </button>
                        <span>{monthLabel}</span>
                        <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month">
                            <ChevronRight size={16} />
                        </button>
                    </div>
                    <button
                        type="button"
                        className="rpv2-schedule-cal-toggle"
                        onClick={() => setCalOpen(prev => !prev)}
                        aria-expanded={calOpen}
                        aria-label={calOpen ? 'Collapse calendar' : 'Expand calendar'}
                        title={calOpen ? 'Collapse calendar' : 'Expand calendar'}
                    >
                        {calOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>

                {calOpen && (
                    <>
                        <div className="rpv2-schedule-cal-weekdays">
                            {WEEKDAY_LABELS.map((w, i) => <span key={i}>{w}</span>)}
                        </div>

                        <div className="rpv2-schedule-cal-grid-wrap">
                            <div className="rpv2-schedule-cal-grid">
                                {grid.map((cellDate, i) => {
                                    if (!cellDate) return <span key={i} className="rpv2-schedule-cal-cell is-empty" aria-hidden="true" />;
                                    const key = todayKey(cellDate);
                                    return (
                                        <button
                                            type="button"
                                            key={i}
                                            className={[
                                                'rpv2-schedule-cal-cell',
                                                key === selectedDate ? 'is-selected' : '',
                                                key === todayKey() ? 'is-today' : ''
                                            ].filter(Boolean).join(' ')}
                                            onClick={() => setSelectedDate(key)}
                                        >
                                            {cellDate.getDate()}
                                            {visitsByDate.has(key) && <span className="rpv2-schedule-cal-dot" aria-hidden="true" />}
                                        </button>
                                    );
                                })}
                            </div>
                            {/* A month with nothing fetched yet would otherwise just
                                render as an ordinary-looking empty grid — no dots,
                                nothing wrong-looking about it — while
                                loadScheduleMonth is still in flight for it, which
                                reads as "there's really nothing here" rather than
                                "still loading". This covers that gap without
                                blocking the grid itself from being clicked. */}
                            {monthLoading && (
                                <div className="rpv2-schedule-cal-loading" aria-hidden="true">
                                    <Loader2 size={18} className="rpv2-schedule-spin" />
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            <div className="rpv2-schedule-list-head">
                <span className="rpv2-schedule-list-date">{selectedLabel}</span>
                <div className="rpv2-schedule-list-head-right">
                    <span className="rpv2-schedule-list-count">{dayVisits.length} visit{dayVisits.length === 1 ? '' : 's'}</span>
                    {customerOptions && (
                        <button type="button" className="rpv2-schedule-add-btn" onClick={openAdd} title="Add a visit" aria-label="Add a visit to this day">
                            <Plus size={15} />
                        </button>
                    )}
                </div>
            </div>

            <div className="rpv2-panel-list rpv2-schedule-visits">
                {dayVisits.length === 0 && (
                    <p className="rpv2-panel-list-empty">Nothing scheduled this day.</p>
                )}
                {dayVisits.map(visit => {
                    const label = nameOf({ company: visit.customerId?.company, contactName: visit.customerId?.contactName });
                    const note = real(visit.notes);
                    return (
                        <div key={visit._id} className={`rpv2-schedule-card rpv2-schedule-card--${activityModifier(visit.activityType)}`}>
                            <button type="button" className="rpv2-schedule-card-info" onClick={() => onSelectVisit(visit)}>
                                <div className="rpv2-schedule-card-top">
                                    <span className="rpv2-schedule-card-dot" aria-hidden="true" />
                                    <span className="rpv2-schedule-card-name">{label}</span>
                                </div>
                                <div className="rpv2-schedule-card-meta">{timeLabel(visit.startTime)} · {visit.activityType || 'Visit'}</div>
                                {note && <div className="rpv2-schedule-card-note" title={note}>{note}</div>}
                            </button>
                            <div className="rpv2-schedule-card-acts">
                                {customerOptions && (
                                    <button
                                        type="button"
                                        className="rpv2-schedule-card-edit"
                                        onClick={() => openEdit(visit)}
                                        title="Edit this visit"
                                        aria-label={`Edit ${label}'s visit`}
                                    >
                                        <Pencil size={15} />
                                    </button>
                                )}
                                {onDeleteVisit && (
                                    <button
                                        type="button"
                                        className="rpv2-schedule-card-delete"
                                        onClick={() => onDeleteVisit(visit)}
                                        title="Remove from schedule"
                                        aria-label={`Remove ${label} from the schedule`}
                                    >
                                        <Trash2 size={17} />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {formOpen && (
                <div className="rpv2-schedule-form-overlay">
                    <ScheduleVisitForm
                        customerOptions={customerOptions}
                        isEdit={Boolean(editingVisit)}
                        initialCustomerId={editingVisit ? String(editingVisit.customerId?._id || editingVisit.customerId || '') : ''}
                        initialStartTime={editingVisit ? editingVisit.startTime : `${selectedDate}T09:00:00.000`}
                        initialActivityType={editingVisit?.activityType || 'Visit'}
                        initialNotes={editingVisit?.notes || ''}
                        saving={savingVisit}
                        onCancel={closeForm}
                        onSubmit={handleSubmitForm}
                        onDelete={editingVisit && onDeleteVisit ? () => { onDeleteVisit(editingVisit); closeForm(); } : null}
                    />
                </div>
            )}
            </div>
        </div>
    );
};

export default SchedulePanel;
