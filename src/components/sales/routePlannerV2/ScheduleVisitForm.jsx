import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import SearchableSelect from '../../SearchableSelect';
import GoogleStyleDateTimePicker from '../../GoogleStyleDateTimePicker';
import CustomSelect from '../../shared/CustomSelect';
import './ScheduleVisitForm.css';

const ACTIVITY_TYPE_OPTIONS = [
    { value: 'Visit', label: 'Visit' },
    { value: 'Call', label: 'Call' },
    { value: 'Drop-off', label: 'Drop-off' },
    { value: 'Other', label: 'Other' }
];

/**
 * Add/edit a single Schedule entry — the same fields, and the same
 * SearchableSelect/GoogleStyleDateTimePicker controls, as SalesPlannerTab's
 * own "Add Activity" modal, so a rep sees one consistent set of pickers
 * regardless of which screen they're scheduling from. Not built as a
 * separate modal, though: SchedulePanel swaps its whole body to this form
 * rather than layering it on top, because SearchableSelect's dropdown
 * isn't portaled (plain position:absolute) — nested inside SchedulePanel's
 * own scrolling visit list, it would get clipped exactly the way
 * CLAUDE.md's CustomSelect incident describes. Swapping the view instead
 * of nesting sidesteps that entirely.
 */
const ScheduleVisitForm = ({
    customerOptions, isEdit,
    initialCustomerId, initialStartTime, initialActivityType, initialNotes,
    saving, onCancel, onSubmit, onDelete
}) => {
    const [customerId, setCustomerId] = useState(initialCustomerId);
    const [startTime, setStartTime] = useState(initialStartTime);
    const [activityType, setActivityType] = useState(initialActivityType);
    const [notes, setNotes] = useState(initialNotes);

    const canSave = Boolean(customerId) && Boolean(startTime) && !saving;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!canSave) return;
        onSubmit({ customerId, startTime, activityType, notes });
    };

    return (
        <form className="rpv2-schedule-form" onSubmit={handleSubmit}>
            <div className="rpv2-schedule-form-body">
                <label className="rpv2-schedule-form-field">
                    <span>Customer</span>
                    <SearchableSelect
                        options={customerOptions}
                        value={customerId}
                        onChange={setCustomerId}
                        placeholder="Search customers…"
                    />
                </label>

                <label className="rpv2-schedule-form-field">
                    <span>Date &amp; time</span>
                    <GoogleStyleDateTimePicker value={startTime} onChange={setStartTime} required />
                </label>

                <label className="rpv2-schedule-form-field">
                    <span>Activity type</span>
                    <CustomSelect
                        options={ACTIVITY_TYPE_OPTIONS}
                        value={activityType}
                        onChange={(e) => setActivityType(e.target.value)}
                    />
                </label>

                <label className="rpv2-schedule-form-field">
                    <span>Notes</span>
                    <textarea
                        className="rpv2-schedule-form-notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Optional"
                        rows={3}
                    />
                </label>
            </div>

            <div className="rpv2-panel-actions rpv2-schedule-form-actions">
                {onDelete && (
                    <button type="button" className="is-drop" onClick={onDelete} disabled={saving}>
                        <Trash2 size={14} /> Remove
                    </button>
                )}
                <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
                <button type="submit" className="is-primary" disabled={!canSave}>
                    {saving ? 'Saving…' : isEdit ? 'Save' : 'Add'}
                </button>
            </div>
        </form>
    );
};

export default ScheduleVisitForm;
