import { X } from 'lucide-react';
import { formatPhoneInput } from '../../../utils/phoneUtils';
import type { ContactForm } from '../useCustomerActions';

export type ContactModalProps = {
    form: ContactForm;
    onChange: (form: ContactForm) => void;
    isEditing: boolean;
    isSaving: boolean;
    onSave: () => void;
    onClose: () => void;
};

/** Customer profile → Add / Edit Contact. */
export default function ContactModal({ form, onChange, isEditing, isSaving, onSave, onClose }: ContactModalProps) {
    return (
        <div className="modal-overlay" onClick={() => onClose()}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{isEditing ? 'Edit Contact' : 'Add Contact'}</h2>
                    <button className="close-btn" onClick={() => onClose()}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <div className="form-group">
                        <label>Name *</label>
                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => onChange({ ...form, name: e.target.value })}
                            placeholder="Contact name"
                        />
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Phone</label>
                            <input
                                type="tel"
                                value={form.phone}
                                onChange={(e) => onChange({ ...form, phone: formatPhoneInput(e.target.value) })}
                                placeholder="(555) 000-0000"
                            />
                        </div>
                        <div className="form-group">
                            <label>Email</label>
                            <input
                                type="email"
                                value={form.email}
                                onChange={(e) => onChange({ ...form, email: e.target.value })}
                                placeholder="Email address"
                            />
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Role</label>
                        <input
                            type="text"
                            value={form.role}
                            onChange={(e) => onChange({ ...form, role: e.target.value })}
                            placeholder="Job title or role"
                        />
                    </div>
                    <div className="form-group">
                        <label>Notes</label>
                        <textarea
                            value={form.notes}
                            onChange={(e) => onChange({ ...form, notes: e.target.value })}
                            placeholder="Additional notes"
                            rows={3}
                        />
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={() => onClose()} disabled={isSaving}>
                        Cancel
                    </button>
                    <button className="btn-primary" onClick={onSave} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save Contact'}
                    </button>
                </div>
            </div>
        </div>
    );
}
