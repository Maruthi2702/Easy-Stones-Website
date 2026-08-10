import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    ChevronLeft, ChevronRight, Calendar as CalendarIcon,
    Plus, Trash2, Edit2, AlertCircle, X
} from 'lucide-react';
import { API_URL } from '../config/api';
import SearchableSelect from './SearchableSelect';

import GoogleStyleDateTimePicker from './GoogleStyleDateTimePicker';

/**
 * The sales planner.
 *
 * The working week is Monday to Friday and those five days get the full width —
 * squeezing in two days nobody books was costing the readability of the five
 * that are. But a weekend booking is still real: it comes in from the calendar
 * sync, or somebody agrees to a Saturday walkthrough. So Saturday and Sunday sit
 * in a slim rail beside the week rather than being dropped, which is what the
 * old Mon-Fri loop did — silently, with no way to tell from the screen that
 * anything was missing.
 *
 * Every day carries its own + button. Booking Wednesday should not mean opening
 * a form and re-picking a date the calendar already knew.
 */

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' in local time — the key a day is stored and looked up under. */
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Schedules are stored as a local ISO string with no zone suffix, and are read
 * back the same way. Anything that builds a startTime has to match that or the
 * item lands on the wrong day for anyone east of UTC.
 */
const localISO = (d) =>
    `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000`;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Monday of whatever week `d` falls in. Sunday belongs to the week just ending. */
const mondayOf = (d) => {
    const x = startOfDay(d);
    const g = x.getDay();
    return addDays(x, g === 0 ? -6 : 1 - g);
};

const isSameDay = (a, b) => dayKey(a) === dayKey(b);

const ACTIVITY_COLORS = {
    'Visit': '#4ade80',
    'Call': '#3b82f6',
    'Drop-off': '#facc15',
    'Other': '#94a3b8'
};

const activityModifier = (type) => {
    switch (type) {
        case 'Call': return 'call';
        case 'Drop-off': return 'dropoff';
        case 'Other': return 'other';
        default: return 'visit';
    }
};

const activityColor = (type) => ACTIVITY_COLORS[type] || ACTIVITY_COLORS.Other;

const timeLabel = (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const customerName = (item) =>
    item.customerId?.company || item.customerId?.contactName || 'Unknown';

/**
 * A new activity opens on the day you clicked. On today that means the next
 * five-minute mark, so the picker doesn't hand you a time that has already been
 * and gone; on any other day, 9am — early enough to be worth dragging later.
 */
const defaultStartFor = (day) => {
    const now = new Date();
    const d = day ? new Date(day) : new Date();
    if (isSameDay(d, now)) {
        // setMinutes rolls the hour over on its own when this reaches 60.
        d.setHours(now.getHours(), Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
    } else {
        d.setHours(9, 0, 0, 0);
    }
    return localISO(d);
};

const EMPTY_FORM = { customerId: '', startTime: '', activityType: 'Visit', notes: '' };

const SalesPlannerTab = ({ customerSelection = [], customerOptions = [], onSelectCustomer, onScheduleChange, isDropdownLoading }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState('week');
    const [scheduleItems, setScheduleItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [addingForDay, setAddingForDay] = useState(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [itemToDelete, setItemToDelete] = useState(null);

    const [form, setForm] = useState(EMPTY_FORM);

    const today = useMemo(() => startOfDay(new Date()), []);

    /**
     * The span to fetch, which is not the same as the span to draw: week view
     * renders five columns but pulls all seven days, because the weekend rail
     * can only show what was asked for.
     */
    const range = useMemo(() => {
        if (viewMode === 'day') {
            const s = startOfDay(currentDate);
            return { start: s, end: s };
        }
        if (viewMode === 'week') {
            const s = mondayOf(currentDate);
            return { start: s, end: addDays(s, 6) };
        }
        const first = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const last = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        return {
            start: addDays(startOfDay(first), -first.getDay()),
            end: addDays(startOfDay(last), 6 - last.getDay())
        };
    }, [currentDate, viewMode]);

    const rangeStartKey = dayKey(range.start);
    const rangeEndKey = dayKey(range.end);

    /**
     * Clicking through months faster than the network answers used to leave
     * whichever response happened to land last on screen, regardless of which
     * month it belonged to. Only the newest request is allowed to write.
     */
    const requestSeq = useRef(0);

    useEffect(() => {
        const seq = ++requestSeq.current;
        let alive = true;
        setLoading(true);
        setLoadError(null);

        fetch(`${API_URL}/api/schedule?start=${rangeStartKey}T00:00:00.000&end=${rangeEndKey}T23:59:59.999`, {
            credentials: 'include'
        })
            .then(res => {
                if (!res.ok) throw new Error('Could not load the schedule.');
                return res.json();
            })
            .then(data => {
                if (!alive || seq !== requestSeq.current) return;
                setScheduleItems(Array.isArray(data) ? data : []);
            })
            .catch(err => {
                if (!alive || seq !== requestSeq.current) return;
                console.error('Error fetching schedule:', err);
                setLoadError(err.message || 'Could not load the schedule.');
            })
            .finally(() => {
                if (!alive || seq !== requestSeq.current) return;
                setLoading(false);
            });

        return () => { alive = false; };
    }, [rangeStartKey, rangeEndKey, refreshKey]);

    const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

    /** One pass over the response instead of a filter per day per render. */
    const itemsByDay = useMemo(() => {
        const map = new Map();
        for (const item of scheduleItems || []) {
            const d = new Date(item.startTime);
            if (Number.isNaN(d.getTime())) continue;
            const key = dayKey(d);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(item);
        }
        for (const list of map.values()) {
            list.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
        }
        return map;
    }, [scheduleItems]);

    const itemsFor = useCallback((day) => itemsByDay.get(dayKey(day)) || [], [itemsByDay]);

    const weekdays = useMemo(() => {
        const s = mondayOf(currentDate);
        return [0, 1, 2, 3, 4].map(i => addDays(s, i));
    }, [currentDate]);

    const weekendDays = useMemo(() => {
        const s = mondayOf(currentDate);
        return [addDays(s, 5), addDays(s, 6)];
    }, [currentDate]);

    const monthWeeks = useMemo(() => {
        if (viewMode !== 'month') return [];
        const weeks = [];
        let cursor = new Date(range.start);
        while (cursor <= range.end) {
            weeks.push([0, 1, 2, 3, 4, 5, 6].map(i => addDays(cursor, i)));
            cursor = addDays(cursor, 7);
        }
        return weeks;
    }, [viewMode, range.start, range.end]);

    /**
     * Only meaningful when today is actually inside the span that was fetched —
     * a count of "0 today" while looking at next March would be a lie.
     */
    const todayCount = useMemo(() => {
        if (today < range.start || today > range.end) return null;
        return itemsFor(today).length;
    }, [today, range.start, range.end, itemsFor]);

    const handlePrev = () => {
        const d = new Date(currentDate);
        if (viewMode === 'day') d.setDate(d.getDate() - 1);
        else if (viewMode === 'week') d.setDate(d.getDate() - 7);
        else d.setMonth(d.getMonth() - 1);
        setCurrentDate(d);
    };

    const handleNext = () => {
        const d = new Date(currentDate);
        if (viewMode === 'day') d.setDate(d.getDate() + 1);
        else if (viewMode === 'week') d.setDate(d.getDate() + 7);
        else d.setMonth(d.getMonth() + 1);
        setCurrentDate(d);
    };

    const handleToday = () => setCurrentDate(new Date());

    const openAdd = (day) => {
        setEditingItem(null);
        setAddingForDay(day ? new Date(day) : new Date());
        setSaveError(null);
        setForm({ ...EMPTY_FORM, startTime: defaultStartFor(day) });
        setShowAddModal(true);
    };

    const openEdit = (item) => {
        setEditingItem(item);
        setAddingForDay(null);
        setSaveError(null);
        setForm({
            customerId: item.customerId?._id || item.customerId || '',
            startTime: item.startTime,
            activityType: item.activityType || 'Visit',
            notes: item.notes || ''
        });
        setShowAddModal(true);
    };

    const closeModal = () => {
        setShowAddModal(false);
        setEditingItem(null);
        setAddingForDay(null);
        setSaveError(null);
    };

    useEffect(() => {
        if (!showAddModal && !showDeleteModal) return undefined;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (showDeleteModal) setShowDeleteModal(false);
            else closeModal();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [showAddModal, showDeleteModal]);

    const handleSave = async (e) => {
        if (e) e.preventDefault();

        if (!form.customerId || !form.startTime) {
            setSaveError('Pick a customer and a start time.');
            return;
        }

        try {
            setSaving(true);
            setSaveError(null);
            const method = editingItem ? 'PUT' : 'POST';
            const url = editingItem
                ? `${API_URL}/api/schedule/${editingItem._id}`
                : `${API_URL}/api/schedule`;

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(form)
            });

            if (response.ok) {
                refresh();
                if (onScheduleChange) onScheduleChange();
                closeModal();
                setForm(EMPTY_FORM);
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.error('[Planner] Save failed:', errorData);
                setSaveError(errorData.message || errorData.error || 'That did not save. Try again.');
            }
        } catch (error) {
            console.error('[Planner] Save error:', error);
            setSaveError(`Network error: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (id) => {
        setItemToDelete(id);
        setShowDeleteModal(true);
    };

    const confirmDelete = async () => {
        if (!itemToDelete) return;
        try {
            const response = await fetch(`${API_URL}/api/schedule/${itemToDelete}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (response.ok) {
                refresh();
                if (onScheduleChange) onScheduleChange();
                setShowDeleteModal(false);
                setItemToDelete(null);
            }
        } catch (error) {
            console.error('Error deleting schedule:', error);
        }
    };

    const effectiveCustomerOptions = useMemo(() => {
        if (customerOptions && customerOptions.length > 0) return customerOptions;
        return [...(customerSelection || [])].map(c => ({
            value: c._id,
            label: c.company || c.contactName
        })).sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    }, [customerSelection, customerOptions]);

    const activityTypeOptions = [
        { value: 'Visit', label: 'Visit' },
        { value: 'Call', label: 'Call' },
        { value: 'Drop-off', label: 'Drop-off' },
        { value: 'Other', label: 'Other' }
    ];

    const titleLabel = useMemo(() => {
        if (viewMode === 'day') {
            return currentDate.toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
            });
        }
        if (viewMode === 'week') {
            const a = weekdays[0];
            const b = weekendDays[1];
            const sameMonth = a.getMonth() === b.getMonth();
            const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const right = sameMonth
                ? `${b.getDate()}, ${b.getFullYear()}`
                : b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            return `${left} – ${right}`;
        }
        return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }, [viewMode, currentDate, weekdays, weekendDays]);

    const addLabel = (day) =>
        `Schedule an activity on ${day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`;

    const renderSkeleton = (count = 2) => (
        Array.from({ length: count }, (_, i) => (
            <div key={i} className="pl-skcard" aria-hidden="true">
                <span className="pl-sk" style={{ width: `${70 - i * 12}%` }} />
                <span className="pl-sk pl-sk--thin" style={{ width: `${44 - i * 8}%` }} />
            </div>
        ))
    );

    const renderItem = (item) => (
        <div key={item._id} className={`pl-item pl-item--${activityModifier(item.activityType)}`}>
            <div className="pl-item-top">
                <span
                    className="pl-typedot"
                    style={{ background: activityColor(item.activityType) }}
                    aria-hidden="true"
                />
                <button
                    type="button"
                    className="pl-name"
                    onClick={() => onSelectCustomer && onSelectCustomer(item.customerId)}
                    title={`Open ${customerName(item)}`}
                >
                    {customerName(item)}
                </button>
                <div className="pl-acts">
                    <button type="button" className="pl-act" onClick={() => openEdit(item)} aria-label="Edit activity">
                        <Edit2 size={13} />
                    </button>
                    <button type="button" className="pl-act pl-act--danger" onClick={() => handleDelete(item._id)} aria-label="Delete activity">
                        <Trash2 size={13} />
                    </button>
                </div>
            </div>
            <div className="pl-meta">
                {timeLabel(item.startTime)} · {item.activityType || 'Visit'}
            </div>
            {item.notes && <div className="pl-note" title={item.notes}>{item.notes}</div>}
        </div>
    );

    const renderDayColumn = (day, { compact = false } = {}) => {
        const items = itemsFor(day);
        const isToday = isSameDay(day, today);
        return (
            <div key={dayKey(day)} className={`pl-col${isToday ? ' is-today' : ''}`}>
                <div className="pl-colhead">
                    <span className="pl-dow">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                    <span className="pl-headright">
                        {isToday && <span className="pl-todaytag">Today</span>}
                        <span className="pl-dnum">{day.getDate()}</span>
                        <button
                            type="button"
                            className="pl-addday"
                            onClick={() => openAdd(day)}
                            title={addLabel(day)}
                            aria-label={addLabel(day)}
                        >
                            <Plus size={14} />
                        </button>
                    </span>
                </div>
                <div className="pl-colbody">
                    {loading && items.length === 0
                        ? renderSkeleton(compact ? 1 : 2)
                        : items.length > 0
                            ? items.map(renderItem)
                            : (
                                <button type="button" className="pl-empty" onClick={() => openAdd(day)} title={addLabel(day)}>
                                    <Plus size={14} />
                                    <span>Add a stop</span>
                                </button>
                            )}
                </div>
            </div>
        );
    };

    const weekendItemCount = weekendDays.reduce((n, d) => n + itemsFor(d).length, 0);
    const weekendHasToday = weekendDays.some(d => isSameDay(d, today));
    const weekendQuiet = weekendItemCount === 0 && !weekendHasToday;

    const renderWeekendRail = () => (
        <div className={`pl-rail${weekendQuiet ? ' is-quiet' : ''}${weekendHasToday ? ' is-today' : ''}`}>
            <div className="pl-rail-head">Weekend</div>
            {weekendDays.map(day => {
                const items = itemsFor(day);
                const isToday = isSameDay(day, today);
                return (
                    <div key={dayKey(day)} className={`pl-rail-day${isToday ? ' is-today' : ''}`}>
                        <div className="pl-rail-dh">
                            <span className="pl-rail-dow">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                            <span className="pl-headright">
                                {isToday && <span className="pl-todaytag">Today</span>}
                                <span className="pl-rail-dnum">{day.getDate()}</span>
                                <button
                                    type="button"
                                    className="pl-addday"
                                    onClick={() => openAdd(day)}
                                    title={addLabel(day)}
                                    aria-label={addLabel(day)}
                                >
                                    <Plus size={13} />
                                </button>
                            </span>
                        </div>
                        {items.length > 0 && (
                            <div className="pl-rail-items">{items.map(renderItem)}</div>
                        )}
                    </div>
                );
            })}
        </div>
    );

    const renderMonth = () => (
        <div className="pl-month">
            <div className="pl-dowrow" aria-hidden="true">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="pl-monthgrid">
                {monthWeeks.map((week, wi) => (
                    <div className="pl-mrow" key={wi}>
                        {week.map(day => {
                            const items = itemsFor(day);
                            const isToday = isSameDay(day, today);
                            const offMonth = day.getMonth() !== currentDate.getMonth();
                            const shown = items.slice(0, 3);
                            return (
                                <div
                                    key={dayKey(day)}
                                    className={`pl-cell${offMonth ? ' is-off' : ''}${isToday ? ' is-today' : ''}`}
                                >
                                    <div className="pl-cellhead">
                                        <span className="pl-cnum">{day.getDate()}</span>
                                        <button
                                            type="button"
                                            className="pl-celladd"
                                            onClick={() => openAdd(day)}
                                            title={addLabel(day)}
                                            aria-label={addLabel(day)}
                                        >
                                            <Plus size={12} />
                                        </button>
                                    </div>
                                    {shown.map(item => (
                                        <button
                                            key={item._id}
                                            type="button"
                                            className="pl-ev"
                                            onClick={() => openEdit(item)}
                                            title={`${timeLabel(item.startTime)} · ${customerName(item)}`}
                                        >
                                            <span
                                                className="pl-typedot"
                                                style={{ background: activityColor(item.activityType) }}
                                                aria-hidden="true"
                                            />
                                            <span className="pl-evtime">{timeLabel(item.startTime)}</span>
                                            <span className="pl-evname">{customerName(item)}</span>
                                        </button>
                                    ))}
                                    {items.length > shown.length && (
                                        <button
                                            type="button"
                                            className="pl-more"
                                            onClick={() => { setCurrentDate(new Date(day)); setViewMode('day'); }}
                                        >
                                            +{items.length - shown.length} more
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="pl-wrap">
            <div className="pl-toolbar">
                <div className="pl-toolbar-left">
                    <div className="pl-nav">
                        <button type="button" onClick={handlePrev} className="pl-navbtn" aria-label="Previous">
                            <ChevronLeft size={18} />
                        </button>
                        <div className="pl-views" role="group" aria-label="Calendar view">
                            {[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([mode, label]) => (
                                <button
                                    key={mode}
                                    type="button"
                                    className={`pl-viewbtn${viewMode === mode ? ' is-on' : ''}`}
                                    aria-pressed={viewMode === mode}
                                    onClick={() => setViewMode(mode)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <button type="button" onClick={handleNext} className="pl-navbtn" aria-label="Next">
                            <ChevronRight size={18} />
                        </button>
                    </div>

                    <button type="button" className="pl-today" onClick={handleToday}>Today</button>

                    <h3 className="pl-title">{titleLabel}</h3>

                    {todayCount !== null && todayCount > 0 && (
                        <span className="pl-chip">
                            {todayCount} {todayCount === 1 ? 'stop' : 'stops'} today
                        </span>
                    )}
                </div>

                <button className="pl-new" type="button" onClick={() => openAdd(null)}>
                    <Plus size={18} /> Schedule Activity
                </button>
            </div>

            {loadError && (
                <div className="pl-error" role="alert">
                    <AlertCircle size={16} />
                    <span>{loadError}</span>
                    <button type="button" onClick={refresh}>Try again</button>
                </div>
            )}

            <div className="pl-scroll">
                {viewMode === 'day' && (
                    <div className="pl-grid pl-grid--day">
                        {renderDayColumn(currentDate)}
                    </div>
                )}

                {viewMode === 'week' && (
                    <div className={`pl-grid pl-grid--week${weekendQuiet ? ' is-quiet-weekend' : ''}`}>
                        {weekdays.map(day => renderDayColumn(day))}
                        {renderWeekendRail()}
                    </div>
                )}

                {viewMode === 'month' && renderMonth()}
            </div>

            <div className="pl-legend">
                {Object.keys(ACTIVITY_COLORS).map(type => (
                    <span className="pl-lg" key={type}>
                        <span className="pl-typedot" style={{ background: ACTIVITY_COLORS[type] }} aria-hidden="true" />
                        {type}
                    </span>
                ))}
            </div>

            {showAddModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h2>{editingItem ? 'Edit Activity' : 'Schedule New Activity'}</h2>
                                {!editingItem && addingForDay && (
                                    <p className="pl-modal-sub">
                                        <CalendarIcon size={13} />
                                        {addingForDay.toLocaleDateString('en-US', {
                                            weekday: 'long', month: 'long', day: 'numeric'
                                        })}
                                    </p>
                                )}
                            </div>
                            <button type="button" className="close-btn" onClick={closeModal}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <form onSubmit={handleSave} className="planner-form">
                                <div className="form-group">
                                    <label>Customer <span style={{ color: 'red' }}>*</span></label>
                                    <SearchableSelect
                                        options={effectiveCustomerOptions}
                                        value={form.customerId}
                                        onChange={value => setForm({ ...form, customerId: value })}
                                        placeholder="Select a Customer..."
                                        required
                                        isLoading={isDropdownLoading}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Start Time <span style={{ color: 'red' }}>*</span></label>
                                    <GoogleStyleDateTimePicker
                                        value={form.startTime}
                                        onChange={value => setForm({ ...form, startTime: value })}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Activity Type</label>
                                    <SearchableSelect
                                        options={activityTypeOptions}
                                        value={form.activityType}
                                        onChange={value => setForm({ ...form, activityType: value })}
                                        placeholder="Select Type..."
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Notes</label>
                                    <textarea
                                        value={form.notes}
                                        onChange={e => setForm({ ...form, notes: e.target.value })}
                                        placeholder="Agenda or special instructions..."
                                    />
                                </div>
                            </form>
                            {saveError && (
                                <div className="pl-form-err" role="alert">
                                    <AlertCircle size={15} /> <span>{saveError}</span>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button type="button" onClick={closeModal} className="btn-secondary">Cancel</button>
                            <button type="button" onClick={handleSave} className="btn-primary" disabled={saving}>
                                {saving ? 'Saving...' : 'Save Plan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeleteModal && (
                <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
                    <div className="modal-content" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Delete Schedule</h2>
                            <button type="button" className="close-btn" onClick={() => setShowDeleteModal(false)}><X size={20} /></button>
                        </div>
                        <div className="modal-body pl-confirm">
                            <AlertCircle size={44} className="pl-confirm-icon" />
                            <p className="pl-confirm-title">Delete this scheduled activity?</p>
                            <p className="pl-confirm-note">This action cannot be undone.</p>
                        </div>
                        <div className="modal-footer">
                            <button type="button" onClick={() => setShowDeleteModal(false)} className="btn-secondary">Cancel</button>
                            <button type="button" onClick={confirmDelete} className="btn-primary pl-danger-btn">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SalesPlannerTab;
