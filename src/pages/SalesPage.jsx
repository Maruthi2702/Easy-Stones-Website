import React, { useState, useEffect } from 'react';
import { Plus, Search, MapPin, Phone, Mail, Calendar, Tag, Trash2, Edit2, X } from 'lucide-react';
import { API_URL } from '../config/api';
import CustomerMap from '../components/CustomerMap';
import './SalesPage.css';

const SalesPage = () => {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [formData, setFormData] = useState({
        customerName: '',
        company: '',
        address: '',
        phone: '',
        email: '',
        notes: '',
        lastVisit: '',
        nextVisit: '',
        status: 'prospect',
        tags: []
    });

    useEffect(() => {
        fetchCustomers();
    }, []);

    const fetchCustomers = async () => {
        try {
            const response = await fetch(`${API_URL} /api/sales / customers`, {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                setCustomers(data);
            }
        } catch (error) {
            console.error('Error fetching customers:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        try {
            const url = editingCustomer
                ? `${API_URL} /api/sales / customers / ${editingCustomer._id} `
                : `${API_URL} /api/sales / customers`;

            const method = editingCustomer ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                fetchCustomers();
                handleCloseModal();
            }
        } catch (error) {
            console.error('Error saving customer:', error);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this customer?')) return;

        try {
            const response = await fetch(`${API_URL} /api/sales / customers / ${id} `, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                fetchCustomers();
            }
        } catch (error) {
            console.error('Error deleting customer:', error);
        }
    };

    const handleEdit = (customer) => {
        setEditingCustomer(customer);
        setFormData({
            customerName: customer.customerName,
            company: customer.company || '',
            address: customer.address,
            phone: customer.phone || '',
            email: customer.email || '',
            notes: customer.notes || '',
            lastVisit: customer.lastVisit ? customer.lastVisit.split('T')[0] : '',
            nextVisit: customer.nextVisit ? customer.nextVisit.split('T')[0] : '',
            status: customer.status,
            tags: customer.tags || []
        });
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingCustomer(null);
        setFormData({
            customerName: '',
            company: '',
            address: '',
            phone: '',
            email: '',
            notes: '',
            lastVisit: '',
            nextVisit: '',
            status: 'prospect',
            tags: []
        });
    };

    const filteredCustomers = customers.filter(customer =>
        customer.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.address.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getStatusColor = (status) => {
        switch (status) {
            case 'active': return '#4ade80';
            case 'prospect': return '#fbbf24';
            case 'inactive': return '#94a3b8';
            default: return '#94a3b8';
        }
    };

    return (
        <div className="sales-page">
            <div className="sales-header">
                <div className="container">
                    <h1>Sales CRM</h1>
                    <p>Manage your customer visits and track your sales pipeline</p>
                </div>
            </div>

            <div className="container sales-container">
                <div className="sales-toolbar">
                    <div className="search-box">
                        <Search size={20} />
                        <input
                            type="text"
                            placeholder="Search customers..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button className="btn-primary" onClick={() => setShowModal(true)}>
                        <Plus size={20} />
                        Add Customer
                    </button>
                </div>

                {loading ? (
                    <div className="loading">Loading customers...</div>
                ) : filteredCustomers.length === 0 ? (
                    <div className="empty-state">
                        <MapPin size={64} />
                        <h3>No customers yet</h3>
                        <p>Start by adding your first customer</p>
                        <button className="btn-primary" onClick={() => setShowModal(true)}>
                            <Plus size={20} />
                            Add Customer
                        </button>
                    </div>
                ) : (
                    <div className="sales-content">
                        {/* Map Section */}
                        <div className="map-section">
                            <CustomerMap
                                customers={filteredCustomers}
                                onCustomerClick={setSelectedCustomer}
                                selectedCustomer={selectedCustomer}
                                onCloseInfo={() => setSelectedCustomer(null)}
                            />
                        </div>

                        {/* Customer List Section */}
                        <div className="customers-section">
                            <div className="customers-grid">
                                {filteredCustomers.map(customer => (
                                    <div
                                        key={customer._id}
                                        className={`customer-card ${selectedCustomer?._id === customer._id ? 'selected' : ''}`}
                                        onClick={() => setSelectedCustomer(customer)}
                                    >
                                        <div className="customer-header">
                                            <div>
                                                <h3>{customer.customerName}</h3>
                                                {customer.company && <p className="company">{customer.company}</p>}
                                            </div>
                                            <span
                                                className="status-badge"
                                                style={{ backgroundColor: getStatusColor(customer.status) }}
                                            >
                                                {customer.status}
                                            </span>
                                        </div>

                                        <div className="customer-details">
                                            <div className="detail-row">
                                                <MapPin size={16} />
                                                <span>{customer.address}</span>
                                            </div>
                                            {customer.phone && (
                                                <div className="detail-row">
                                                    <Phone size={16} />
                                                    <span>{customer.phone}</span>
                                                </div>
                                            )}
                                            {customer.email && (
                                                <div className="detail-row">
                                                    <Mail size={16} />
                                                    <span>{customer.email}</span>
                                                </div>
                                            )}
                                            {customer.nextVisit && (
                                                <div className="detail-row">
                                                    <Calendar size={16} />
                                                    <span>Next visit: {new Date(customer.nextVisit).toLocaleDateString()}</span>
                                                </div>
                                            )}
                                        </div>

                                        {customer.notes && (
                                            <div className="customer-notes">
                                                <p>{customer.notes}</p>
                                            </div>
                                        )}

                                        {customer.tags && customer.tags.length > 0 && (
                                            <div className="customer-tags">
                                                {customer.tags.map((tag, index) => (
                                                    <span key={index} className="tag">
                                                        <Tag size={12} />
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        <div className="customer-actions">
                                            <button
                                                className="btn-icon"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleEdit(customer);
                                                }}
                                            >
                                                <Edit2 size={18} />
                                            </button>
                                            <button
                                                className="btn-icon btn-danger"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDelete(customer._id);
                                                }}
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</h2>
                            <button className="btn-icon" onClick={handleCloseModal}>
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="customer-form">
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Customer Name *</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.customerName}
                                        onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Company</label>
                                    <input
                                        type="text"
                                        value={formData.company}
                                        onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Address *</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.address}
                                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                />
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Phone</label>
                                    <input
                                        type="tel"
                                        value={formData.phone}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Last Visit</label>
                                    <input
                                        type="date"
                                        value={formData.lastVisit}
                                        onChange={(e) => setFormData({ ...formData, lastVisit: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Next Visit</label>
                                    <input
                                        type="date"
                                        value={formData.nextVisit}
                                        onChange={(e) => setFormData({ ...formData, nextVisit: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Status</label>
                                <select
                                    value={formData.status}
                                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                >
                                    <option value="prospect">Prospect</option>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label>Notes</label>
                                <textarea
                                    rows="4"
                                    value={formData.notes}
                                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                    placeholder="Add notes about this customer..."
                                />
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="btn-secondary" onClick={handleCloseModal}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn-primary">
                                    {editingCustomer ? 'Update' : 'Add'} Customer
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SalesPage;
