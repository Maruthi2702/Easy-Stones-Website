import { Calendar as CalendarIcon, AlertCircle, X } from 'lucide-react';
import SearchableSelect from '../../../components/SearchableSelect';
import { DateTimePicker } from '../../../components/shared/calendar/Calendar';
import type { CustomerOption } from '../../../utils/customerOptions';
import type { ActivityEditor } from '../useActivityEditor';
import { ACTIVITY_TYPE_OPTIONS } from '../salesPlanner';

export type ActivityDialogProps = {
    editor: ActivityEditor;
    customerOptions: CustomerOption[];
    isDropdownLoading?: boolean;
};

/** Schedule New Activity / Edit Activity: customer, start time, type, notes. */
export default function ActivityDialog({ editor, customerOptions, isDropdownLoading }: ActivityDialogProps) {
    const { form, setForm, editingItem, addingForDay, saveError, saving, closeModal, handleSave } = editor;
    return (
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
                                options={customerOptions}
                                value={form.customerId}
                                onChange={value => setForm({ ...form, customerId: value })}
                                placeholder="Select a Customer..."
                                isLoading={isDropdownLoading}
                            />
                        </div>
                        <div className="form-group">
                            <label>Start Time <span style={{ color: 'red' }}>*</span></label>
                            <DateTimePicker
                                value={form.startTime}
                                onChange={value => setForm({ ...form, startTime: value })}
                            />
                        </div>
                        <div className="form-group">
                            <label>Activity Type</label>
                            <SearchableSelect
                                options={ACTIVITY_TYPE_OPTIONS}
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
    );
}
