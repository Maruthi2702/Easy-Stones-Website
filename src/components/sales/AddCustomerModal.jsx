import React, { useState } from 'react';
import { X, Loader } from 'lucide-react';

const AddCustomerModal = ({ show, onClose, onSave, isSaving }) => {
    const [form, setForm] = useState({
        customerName: '',
        company: '',
        address: {
            street: '',
            city: '',
            state: '',
            zipCode: ''
        },
        phone: '',
        email: '',
        notes: '',
        status: 'active'
    });

    const handleClose = () => {
        setForm({
            customerName: '',
            company: '',
            address: {
                street: '',
                city: '',
                state: '',
                zipCode: ''
            },
            phone: '',
            email: '',
            notes: '',
            status: 'active'
        });
        onClose();
    };

    const handleSave = () => {
        if (!form.company.trim()) {
            alert('Company name is required');
            return;
        }
        onSave(form, handleClose);
    };

    if (!show) return null;

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
                <div className="modal-header">
                    <h2>Add New Customer</h2>
                    <button className="close-btn" onClick={handleClose}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div className="form-group">
                            <label>Company Name <span style={{ color: 'red' }}>*</span></label>
                            <input
                                type="text"
                                value={form.company}
                                onChange={(e) => setForm({ ...form, company: e.target.value })}
                                placeholder="Enter company name"
                                autoFocus
                            />
                        </div>
                        <div className="form-group">
                            <label>Customer Name</label>
                            <input
                                type="text"
                                value={form.customerName}
                                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                                placeholder="Contact person name"
                            />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div className="form-group">
                            <label>Phone</label>
                            <input
                                type="tel"
                                value={form.phone}
                                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                placeholder="Phone number"
                            />
                        </div>
                        <div className="form-group">
                            <label>Email</label>
                            <input
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                                placeholder="Email address"
                            />
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Address</label>
                        <input
                            type="text"
                            value={form.address.street}
                            onChange={(e) => setForm({ ...form, address: { ...form.address, street: e.target.value } })}
                            placeholder="Street Address"
                            style={{ marginBottom: '0.5rem' }}
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem' }}>
                            <input
                                type="text"
                                value={form.address.city}
                                onChange={(e) => setForm({ ...form, address: { ...form.address, city: e.target.value } })}
                                placeholder="City"
                            />
                            <input
                                type="text"
                                value={form.address.state}
                                onChange={(e) => setForm({ ...form, address: { ...form.address, state: e.target.value } })}
                                placeholder="State"
                            />
                            <input
                                type="text"
                                value={form.address.zipCode}
                                onChange={(e) => setForm({ ...form, address: { ...form.address, zipCode: e.target.value } })}
                                placeholder="ZIP"
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Notes</label>
                        <textarea
                            value={form.notes}
                            onChange={(e) => setForm({ ...form, notes: e.target.value })}
                            placeholder="Any additional notes..."
                            rows="3"
                        />
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={handleClose} disabled={isSaving}>
                        Cancel
                    </button>
                    <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? (
                            <><Loader size={14} className="animate-spin" style={{ marginRight: '0.5rem' }} /> Saving...</>
                        ) : (
                            'Add Customer'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddCustomerModal;
