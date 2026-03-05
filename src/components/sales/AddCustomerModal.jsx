import React, { useState } from 'react';
import { X, Loader, Contact2, Info, AlertCircle } from 'lucide-react';
import { formatPhoneInput } from '../../utils/phoneUtils';

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
    const [showSupportInfo, setShowSupportInfo] = useState(false);

    const handleImportContacts = async () => {
        const supported = 'contacts' in navigator && 'ContactsManager' in window;
        if (!supported) {
            setShowSupportInfo(true);
            return;
        }
        setShowSupportInfo(false);

        try {
            const props = ['name', 'email', 'tel', 'address'];
            const opts = { multiple: false };
            const contacts = await navigator.contacts.select(props, opts);

            if (contacts && contacts.length > 0) {
                const contact = contacts[0];
                const updatedForm = { ...form };

                if (contact.name && contact.name.length > 0) {
                    updatedForm.customerName = contact.name[0];
                }

                if (contact.email && contact.email.length > 0) {
                    updatedForm.email = contact.email[0];
                }

                if (contact.tel && contact.tel.length > 0) {
                    updatedForm.phone = formatPhoneInput(contact.tel[0]);
                }

                if (contact.address && contact.address.length > 0) {
                    const addr = contact.address[0];
                    updatedForm.address = {
                        street: addr.addressLine?.[0] || '',
                        city: addr.city || '',
                        state: addr.region || '',
                        zipCode: addr.postalCode || ''
                    };
                }

                setForm(updatedForm);
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Contact Pick Error:', err);
                // setShowSupportInfo(true); // Maybe not for other errors
            }
        }
    };

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
        <div className="modal-overlay add-customer-modal-overlay" onClick={handleClose} style={{ zIndex: 20000 }}>
            <div className="modal-content add-customer-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
                <div className="modal-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <h2>Add New Customer</h2>
                        <button
                            className="btn-secondary import-contact-btn"
                            onClick={handleImportContacts}
                            style={{
                                padding: '0.45rem 1rem',
                                fontSize: '0.8rem',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                borderRadius: '20px',
                                border: '1px solid #3b82f6',
                                background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                                color: '#1d4ed8',
                                boxShadow: '0 2px 4px rgba(59, 130, 246, 0.1)',
                                cursor: 'pointer',
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                outline: 'none'
                            }}
                            title="Import from device contacts"
                        >
                            <Contact2 size={15} />
                            Import
                        </button>
                    </div>
                    <button className="close-btn" onClick={handleClose}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    {showSupportInfo && (
                        <div style={{
                            marginBottom: '1.5rem',
                            padding: '1rem',
                            borderRadius: '12px',
                            background: '#fff7ed',
                            border: '1px solid #ffedd5',
                            display: 'flex',
                            gap: '0.75rem',
                            animation: 'importSlideDown 0.3s ease-out forwards'
                        }}>
                            <AlertCircle size={20} style={{ color: '#ea580c', flexShrink: 0 }} />
                            <div style={{ fontSize: '0.85rem', color: '#9a3412', lineHeight: '1.4' }}>
                                <p style={{ fontWeight: '600', marginBottom: '0.25rem' }}>Contact Picker API is not supported on this browser</p>
                                <p>On iOS, you may need to enable <strong>"Contact Picker API"</strong> in Safari Experimental Features:</p>
                                <ol style={{ margin: '0.5rem 0', paddingLeft: '1.25rem' }}>
                                    <li>Open <strong>Settings</strong> {'>'} <strong>Safari</strong></li>
                                    <li>Tap <strong>Advanced</strong> {'>'} <strong>Experimental Features</strong></li>
                                    <li>Turn on <strong>Contact Picker API</strong></li>
                                </ol>
                                <p style={{ fontSize: '0.8rem', opacity: 0.8 }}>Desktop browsers currently do not support this feature.</p>
                            </div>
                            <button
                                onClick={() => setShowSupportInfo(false)}
                                style={{
                                    marginLeft: 'auto',
                                    background: 'none',
                                    border: 'none',
                                    color: '#ea580c',
                                    cursor: 'pointer',
                                    padding: '0 0.25rem'
                                }}
                            >
                                <X size={16} />
                            </button>
                        </div>
                    )}
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
                                onChange={(e) => setForm({ ...form, phone: formatPhoneInput(e.target.value) })}
                                placeholder="(555) 000-0000"
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

// Premium styles for the import feature
const styleTag = `
    @keyframes importSlideDown {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    .import-contact-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 6px rgba(59, 130, 246, 0.15) !important;
        filter: brightness(1.05);
    }
    .import-contact-btn:active {
        transform: translateY(0);
    }
`;

if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = styleTag;
    document.head.appendChild(style);
}
