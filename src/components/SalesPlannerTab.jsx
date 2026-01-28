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

    // Week boundaries
    const weekDays = useMemo(() => {
        const start = new Date(currentDate);
        const day = start.getDay();
        const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Monday
        start.setDate(diff);

        const days = [];
        for (let i = 0; i < 5; i++) { // Mon-Fri
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            days.push(d);
        }
        return days;
    }, [currentDate]);

    const fetchSchedule = async () => {
        try {
            setLoading(true);
            const start = weekDays[0].toISOString();
            const end = weekDays[4].toISOString(); // end of Friday
            // Set end to end of day Friday
            const endOfDay = new Date(weekDays[4]);
            endOfDay.setHours(23, 59, 59, 999);

            const response = await fetch(`${API_URL}/api/schedule?start=${start}&end=${endOfDay.toISOString()}`, {
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
    }, [currentDate]);

    const handlePrevWeek = () => {
        const d = new Date(currentDate);
        d.setDate(d.getDate() - 7);
        setCurrentDate(d);
    };

    const handleNextWeek = () => {
        const d = new Date(currentDate);
        d.setDate(d.getDate() + 7);
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
                        <button onClick={handlePrevWeek} className="nav-btn prev-btn"><ChevronLeft size={18} /></button>
                        <button onClick={handleToday} className="nav-btn today-btn">Today</button>
                        <button onClick={handleNextWeek} className="nav-btn next-btn"><ChevronRight size={18} /></button>
                    </div>
                    <h3 className="week-range-label">
                        {weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} -
                        {weekDays[4].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </h3>
                </div>
                <button className="planner-add-btn" onClick={() => setShowAddModal(true)}>
                    <Plus size={18} /> Schedule Activity
                </button>
            </div>

            <div className="weekly-grid">
                {weekDays.map((day, idx) => (
                    <div key={idx} className="day-column">
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
            {showAddModal && (
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
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
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
            )}
        </div>
    );
};

export default SalesPlannerTab;
