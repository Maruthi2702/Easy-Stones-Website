import React, { useState, useEffect, useMemo } from 'react';
import {
    ChevronLeft, ChevronRight, Calendar as CalendarIcon,
    Clock, MapPin, Plus, Trash2, Edit2, CheckCircle,
    AlertCircle, X, Search, Navigation
} from 'lucide-react';
import { API_URL } from '../config/api';
import SearchableSelect from './SearchableSelect';

import { formatForDateTimeInput } from '../utils/dateUtils';
import GoogleStyleDateTimePicker from './GoogleStyleDateTimePicker';

const SalesPlannerTab = ({ customers = [], currentUserId, onSelectCustomer }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState('day'); // 'day' or 'week'
    const [scheduleItems, setScheduleItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [itemToDelete, setItemToDelete] = useState(null);

    // Form state
    const [form, setForm] = useState({
        customerId: '',
        startTime: '',
        activityType: 'Visit',
        notes: ''
    });

    // Calculate visible days based on view mode
    const visibleDays = useMemo(() => {
        const start = new Date(currentDate);

        if (viewMode === 'day') {
            return [start];
        }

        if (viewMode === 'week') {
            const day = start.getDay(); // 0 is Sunday, 1 is Monday
            // Calculate distance to Monday
            // If Sunday (0), go back 6 days to last Monday
            // If Monday (1), go back 0 days
            // If Tuesday (2), go back 1 day
            const diffToMonday = day === 0 ? 6 : day - 1;
            start.setDate(start.getDate() - diffToMonday);

            const days = [];
            for (let i = 0; i < 5; i++) { // Mon-Fri
                const d = new Date(start);
                d.setDate(start.getDate() + i);
                days.push(d);
            }
            return days;
        }

        // Month mode
        const year = start.getFullYear();
        const month = start.getMonth();
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);

        // Calculate padding for start of month
        const firstDayWeekday = firstDayOfMonth.getDay(); // 0 is Sunday
        const days = [];

        // Add previous month's trailing days as padding
        for (let i = 0; i < firstDayWeekday; i++) {
            const d = new Date(year, month, 1 - (firstDayWeekday - i));
            days.push(d);
        }

        // Add current month's days
        for (let d = 1; d <= lastDayOfMonth.getDate(); d++) {
            days.push(new Date(year, month, d));
        }

        // Add next month's leading days to complete the last week grid
        const remainingDays = 7 - (days.length % 7);
        if (remainingDays < 7) {
            for (let i = 1; i <= remainingDays; i++) {
                days.push(new Date(year, month + 1, i));
            }
        }

        return days;
    }, [currentDate, viewMode]);

    const fetchSchedule = async () => {
        try {
            setLoading(true);
            const start = new Date(visibleDays[0]);
            start.setHours(0, 0, 0, 0); // Fix: Start from beginning of the day

            const end = new Date(visibleDays[visibleDays.length - 1]);
            end.setHours(23, 59, 59, 999); // End of the last day

            const response = await fetch(`${API_URL}/api/schedule?start=${start.toISOString()}&end=${end.toISOString()}`, {
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                setScheduleItems(data);
            }
        } catch (error) {
            console.error('Error fetching schedule:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSchedule();
    }, [currentDate, viewMode]);

    const handlePrev = () => {
        const d = new Date(currentDate);
        if (viewMode === 'day') {
            d.setDate(d.getDate() - 1);
        } else if (viewMode === 'week') {
            d.setDate(d.getDate() - 7);
        } else {
            d.setMonth(d.getMonth() - 1);
        }
        setCurrentDate(d);
    };

    const handleNext = () => {
        const d = new Date(currentDate);
        if (viewMode === 'day') {
            d.setDate(d.getDate() + 1);
        } else if (viewMode === 'week') {
            d.setDate(d.getDate() + 7);
        } else {
            d.setMonth(d.getMonth() + 1);
        }
        setCurrentDate(d);
    };

    const handleToday = () => {
        setCurrentDate(new Date());
    };

    const handleSave = async (e) => {
        e.preventDefault();
        console.log('[Planner] handleSave triggered', form);

        if (!form.customerId || !form.startTime) {
            alert('Please fill in Customer and Start Time');
            return;
        }

        try {
            setLoading(true);
            const method = editingItem ? 'PUT' : 'POST';
            const url = editingItem ? `${API_URL}/api/schedule/${editingItem._id}` : `${API_URL}/api/schedule`;

            console.log(`[Planner] Sending ${method} request to ${url}`);

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(form)
            });

            if (response.ok) {
                console.log('[Planner] Save successful');
                fetchSchedule();
                setShowAddModal(false);
                setEditingItem(null);
                setForm({
                    customerId: '',
                    startTime: '',
                    activityType: 'Visit',
                    notes: ''
                });
            } else {
                const errorData = await response.json();
                console.error('[Planner] Save failed:', errorData);
                alert(`Failed to save: ${errorData.message || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('[Planner] Save error:', error);
            alert(`Network error: ${error.message}`);
        } finally {
            setLoading(false);
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
                fetchSchedule();
                setShowDeleteModal(false);
                setItemToDelete(null);
            }
        } catch (error) {
            console.error('Error deleting schedule:', error);
        }
    };

    const getItemsForDay = (day) => {
        return scheduleItems.filter(item => {
            const itemDate = new Date(item.startTime);
            return itemDate.toDateString() === day.toDateString();
        }).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    };

    const customerOptions = useMemo(() => {
        return customers.map(c => ({
            value: c._id,
            label: c.company || c.contactName
        })).sort((a, b) => a.label.localeCompare(b.label));
    }, [customers]);

    const activityTypeOptions = [
        { value: 'Visit', label: 'Visit' },
        { value: 'Call', label: 'Call' },
        { value: 'Drop-off', label: 'Drop-off' },
        { value: 'Other', label: 'Other' }
    ];

    // Calculate today's schedule count
    const todayCount = useMemo(() => {
        const today = new Date();
        return scheduleItems.filter(item => {
            const itemDate = new Date(item.startTime);
            return itemDate.toDateString() === today.toDateString();
        }).length;
    }, [scheduleItems]);

    return (
        <div className="planner-container">
            <div className="planner-header">
                <div className="planner-nav">
                    <div className="nav-controls">
                        <button onClick={handlePrev} className="nav-btn prev-btn"><ChevronLeft size={18} /></button>
                        <div className="view-toggle">
                            <button
                                className={`toggle-btn ${viewMode === 'day' ? 'active' : ''}`}
                                onClick={() => {
                                    setViewMode('day');
                                    setCurrentDate(new Date());
                                }}
                            >
                                Today
                            </button>
                            <button
                                className={`toggle-btn ${viewMode === 'week' ? 'active' : ''}`}
                                onClick={() => setViewMode('week')}
                            >
                                Week
                            </button>
                            <button
                                className={`toggle-btn ${viewMode === 'month' ? 'active' : ''}`}
                                onClick={() => setViewMode('month')}
                            >
                                Month
                            </button>
                        </div>
                        <button onClick={handleNext} className="nav-btn next-btn"><ChevronRight size={18} /></button>
                    </div>

                    <h3 className="week-range-label">
                        {visibleDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {viewMode === 'week' && ` - ${visibleDays[visibleDays.length - 1].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                        {viewMode === 'month' && `, ${visibleDays[0].toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
                        {viewMode === 'day' && `, ${visibleDays[0].getFullYear()}`}
                    </h3>
                </div>
                <button className="planner-add-btn" onClick={() => setShowAddModal(true)}>
                    <Plus size={18} /> Schedule Activity
                </button>
            </div>

            <div className={`weekly-grid ${viewMode === 'day' ? 'day-view-mode' : ''} ${viewMode === 'week' ? 'week-view-mode' : ''} ${viewMode === 'month' ? 'month-view-mode' : ''}`}>
                {visibleDays.map((day, idx) => (
                    <div key={idx} className={`day-column ${day.getMonth() !== currentDate.getMonth() && viewMode === 'month' ? 'other-month' : ''}`}>
                        <div className="day-header">
                            <span className="day-name">{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                            <span className="day-date">{day.getDate()}</span>
                        </div>
                        <div className="day-content">
                            {getItemsForDay(day).map((item, idx) => (
                                <div key={item._id} className={`schedule-item ${item.activityType.toLowerCase()}`}>
                                    <div className="item-stop-badge">{idx + 1}</div>
                                    <div className="item-details">
                                        <div className="customer-name" onClick={() => onSelectCustomer(item.customerId)}>
                                            {item.customerId?.company || item.customerId?.contactName || 'Unknown'}
                                        </div>
                                        <div className="item-time">
                                            <Clock size={11} />
                                            {new Date(item.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                        </div>
                                        {item.notes && <div className="item-notes">{item.notes}</div>}
                                    </div>
                                    <div className="item-actions">
                                        <button onClick={() => {
                                            setEditingItem(item);
                                            setForm({
                                                customerId: item.customerId?._id || item.customerId,
                                                startTime: formatForDateTimeInput(item.startTime),
                                                activityType: item.activityType,
                                                notes: item.notes
                                            });
                                            setShowAddModal(true);
                                        }} className="edit-mini"><Edit2 size={12} /></button>
                                        <button onClick={() => handleDelete(item._id)} className="delete-mini"><Trash2 size={12} /></button>
                                    </div>
                                </div>
                            ))}
                            {getItemsForDay(day).length === 0 && (
                                <div className="empty-day">
                                    <CalendarIcon size={16} style={{ opacity: 0.3 }} />
                                    <span>Quiet day</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Simple Modal */}
            {
                showAddModal && (
                    <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                        <div className="modal-content" onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>{editingItem ? 'Edit Activity' : 'Schedule New Activity'}</h2>
                                <button className="close-btn" onClick={() => setShowAddModal(false)}><X size={20} /></button>
                            </div>
                            <div className="modal-body">
                                <form onSubmit={handleSave} className="planner-form">
                                    <div className="form-group">
                                        <label>Customer <span style={{ color: 'red' }}>*</span></label>
                                        <SearchableSelect
                                            options={customerOptions}
                                            value={form.customerId}
                                            onChange={value => setForm({ ...form, customerId: value })}
                                            placeholder="Select a Customer..."
                                            required
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
                            </div>
                            <div className="modal-footer">
                                <button type="button" onClick={() => setShowAddModal(false)} className="btn-secondary">Cancel</button>
                                <button type="button" onClick={handleSave} className="btn-primary" disabled={loading}>
                                    {loading ? 'Saving...' : 'Save Plan'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Delete Confirmation Modal */}
            {
                showDeleteModal && (
                    <div className="planner-modal-overlay">
                        <div className="planner-modal" style={{ maxWidth: '400px' }}>
                            <div className="modal-header">
                                <h3>Delete Schedule</h3>
                                <button onClick={() => setShowDeleteModal(false)}><X size={20} /></button>
                            </div>
                            <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                                <AlertCircle size={48} style={{ color: '#ef4444', marginBottom: '1rem' }} />
                                <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem', fontWeight: 600 }}>Delete this scheduled activity?</p>
                                <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)' }}>This action cannot be undone.</p>
                            </div>
                            <div className="modal-footer">
                                <button type="button" onClick={() => setShowDeleteModal(false)} className="cancel-btn">Cancel</button>
                                <button type="button" onClick={confirmDelete} className="btn-secondary" style={{ background: '#ef4444' }}>Delete</button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default SalesPlannerTab;
