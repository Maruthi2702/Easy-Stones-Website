import React, { useState, useEffect } from 'react';
import { Search, User, Plus, Edit2, Trash2, X, Eye, Send, MoreVertical, Paperclip, Image as ImageIcon, Maximize2, Minimize2 } from 'lucide-react';
import { API_URL } from '../config/api';
import './SalesPage.css';
import './SalesPageChat.css';
import './SalesPageChatImage.css';

const SalesPage = () => {
    const [customers, setCustomers] = useState([]);
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('visits');

    // Modal states
    const [showContactModal, setShowContactModal] = useState(false);
    const [showVisitModal, setShowVisitModal] = useState(false);
    const [showResourceModal, setShowResourceModal] = useState(false);
    const [editingContact, setEditingContact] = useState(null);
    const [editingVisit, setEditingVisit] = useState(null);
    const [editingResource, setEditingResource] = useState(null);
    const [isViewingResource, setIsViewingResource] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showCustomerInfo, setShowCustomerInfo] = useState(false);
    const [isChatFullScreen, setIsChatFullScreen] = useState(false);
    const [currentUserId, setCurrentUserId] = useState(null); // Track logged-in user

    // Form states
    const [contactForm, setContactForm] = useState({
        name: '',
        phone: '',
        email: '',
        role: '',
        isPrimary: false,
        notes: ''
    });

    const [visitForm, setVisitForm] = useState({
        date: '',
        purpose: '',
        notes: '',
        outcome: '',
        nextAction: '',
        image: ''
    });

    const [resourceForm, setResourceForm] = useState({
        title: '',
        date: new Date().toISOString().split('T')[0],
        customerId: '', // Added to track actual customer ID
        customer: '',
        location: '',
        resourceType: '',
        image: '',
        description: '',
        notes: '',
        status: 'Active',
        url: '',
        uploadedBy: ''
    });

    // Resources tab state
    const [resourceFilters, setResourceFilters] = useState({
        customer: '',
        startDate: '',
        endDate: ''
    });
    const [resourceSearch, setResourceSearch] = useState('');
    const [expandedResourceId, setExpandedResourceId] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [fullScreenImage, setFullScreenImage] = useState(null);

    const resourceTypes = [
        "Moda Tower 2024 version 2",
        "Moda Tabletop 2024 version 1",
        "Ascale Tower 2023 version1",
        "Ascale Tabletop 2023 version 1",
        "Ascale A&D Box 2023 version 1",
        "Radianz Tower 2023 version 1",
        "Radianz Tabletop 2023 version 1",
        "Moda Tower 2023 version 1",
        "Moda Misc. Samples",
        "Radianz Misc. Samples",
        "Ascale Misc. Samples",
        "Moda Sample Binder SouthV1 12",
        "Moda Sample Binder SouthEast V1 12",
        "Moda Sample Binder NorthWest V1 12",
        "2025V3 Moda Tower Updated 24>25",
        "2025V3 Moda Tower"
    ];

    useEffect(() => {
        fetchCurrentUser();
        fetchCustomers();

        // Auto-refresh every 5 seconds for real-time updates
        const intervalId = setInterval(() => {
            fetchCustomers();
        }, 5000); // 5 seconds

        // Cleanup interval on unmount
        return () => clearInterval(intervalId);
    }, []);

    const fetchCurrentUser = async () => {
        try {
            // Try to get admin/user info first
            const userResponse = await fetch(`${API_URL}/api/user/me`, {
                credentials: 'include'
            });

            if (userResponse.ok) {
                const userData = await userResponse.json();
                setCurrentUserId(userData.id);
                return;
            }

            // Try customer endpoint as fallback
            const customerResponse = await fetch(`${API_URL}/api/customer/me`, {
                credentials: 'include'
            });

            if (customerResponse.ok) {
                const customerData = await customerResponse.json();
                setCurrentUserId(customerData.id);
            }
        } catch (error) {
            console.error('Error fetching current user:', error);
        }
    };

    const fetchCustomers = async () => {
        try {
            const response = await fetch(`${API_URL}/api/customers`, {
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                setCustomers(data);
                if (data.length > 0 && !selectedCustomerId) {
                    setSelectedCustomerId(data[0]._id);
                }
            } else {
                if (response.status === 401) {
                    // Redirect to admin login if unauthorized
                    window.location.href = '/admin/login';
                    return;
                }
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to fetch customers');
            }
        } catch (error) {
            console.error('Error fetching customers:', error);
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    // Optimized function to fetch only the selected customer
    const fetchSingleCustomer = async (customerId) => {
        try {
            const response = await fetch(`${API_URL}/api/customers`, {
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                const updatedCustomer = data.find(c => c._id === customerId);
                if (updatedCustomer) {
                    setCustomers(prevCustomers =>
                        prevCustomers.map(c => c._id === customerId ? updatedCustomer : c)
                    );
                }
            }
        } catch (error) {
            console.error('Error fetching customer:', error);
        }
    };

    // Filter resources (Global view across all customers)
    const allResources = Array.isArray(customers) ? customers.flatMap(c => c.resources || []) : [];

    const filteredResources = allResources.filter(resource => {
        if (!resource) return false;

        const matchesSearch = !resourceSearch ||
            (resource.title && resource.title.toLowerCase().includes(resourceSearch.toLowerCase())) ||
            (resource.resourceType && resource.resourceType.toLowerCase().includes(resourceSearch.toLowerCase())) ||
            (resource.customer && resource.customer.toLowerCase().includes(resourceSearch.toLowerCase())) ||
            (resource.location && resource.location.toLowerCase().includes(resourceSearch.toLowerCase()));

        const matchesCustomer = !resourceFilters.customer || resource.customer === resourceFilters.customer;

        let matchesDate = true;
        if (resource.date) {
            const resourceDate = new Date(resource.date);
            if (!isNaN(resourceDate.getTime())) {
                matchesDate = (!resourceFilters.startDate || resourceDate >= new Date(resourceFilters.startDate)) &&
                    (!resourceFilters.endDate || resourceDate <= new Date(resourceFilters.endDate));
            }
        }

        return matchesSearch && matchesCustomer && matchesDate;
    }) || [];

    const filteredCustomers = (Array.isArray(customers) ? customers : []).filter(c =>
        (c.firstName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
        (c.lastName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
        (c.email?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
        (c.company && c.company.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const selectedCustomer = customers.find(c => c._id === selectedCustomerId);

    const handleSelectCustomer = (customer) => {
        setSelectedCustomerId(customer._id);
        setActiveTab('visits');
        window.scrollTo(0, 0);
    };

    const getPriceLevelLabel = (level) => {
        const labels = {
            1: 'Level 1 (40% Margin)',
            2: 'Level 2 (30% Margin)',
            3: 'Level 3 (20% Margin)',
            4: 'Level 4 (10% Margin)'
        };
        return labels[level] || 'Level 1 (40% Margin)';
    };

    // Contact CRUD operations
    const handleAddContact = () => {
        setEditingContact(null);
        setContactForm({
            name: '',
            phone: '',
            email: '',
            role: '',
            isPrimary: false,
            notes: ''
        });
        setShowContactModal(true);
    };

    const handleEditContact = (contact) => {
        setEditingContact(contact);
        setContactForm({
            name: contact.name || '',
            phone: contact.phone || '',
            email: contact.email || '',
            role: contact.role || '',
            isPrimary: contact.isPrimary || false,
            notes: contact.notes || ''
        });
        setShowContactModal(true);
    };

    const handleSaveContact = async () => {
        try {
            setIsSaving(true);
            const url = editingContact
                ? `${API_URL}/api/customers/${selectedCustomerId}/contacts/${editingContact._id}`
                : `${API_URL}/api/customers/${selectedCustomerId}/contacts`;

            const method = editingContact ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(contactForm)
            });

            if (response.ok) {
                await fetchCustomers();
                setShowContactModal(false);
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to save contact');
            }
        } catch (error) {
            console.error('Error saving contact:', error);
            alert('Failed to save contact');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteContact = async (contactId) => {
        if (!confirm('Are you sure you want to delete this contact?')) return;

        try {
            const response = await fetch(`${API_URL}/api/customers/${selectedCustomerId}/contacts/${contactId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                await fetchCustomers();
            } else {
                alert('Failed to delete contact');
            }
        } catch (error) {
            console.error('Error deleting contact:', error);
            alert('Failed to delete contact');
        }
    };

    // Visit CRUD operations
    const handleAddVisit = () => {
        setEditingVisit(null);
        setVisitForm({
            date: new Date().toISOString().split('T')[0],
            purpose: '',
            notes: '',
            outcome: '',
            nextAction: ''
        });
        setShowVisitModal(true);
    };

    const handleEditVisit = (visit) => {
        setEditingVisit(visit);
        setVisitForm({
            date: visit.date ? new Date(visit.date).toISOString().split('T')[0] : '',
            purpose: visit.purpose || '',
            notes: visit.notes || '',
            outcome: visit.outcome || '',
            nextAction: visit.nextAction || ''
        });
        setShowVisitModal(true);
    };

    const handleSaveVisit = async () => {
        try {
            setIsSaving(true);
            const url = editingVisit
                ? `${API_URL}/api/customers/${selectedCustomerId}/visits/${editingVisit._id}`
                : `${API_URL}/api/customers/${selectedCustomerId}/visits`;

            const method = editingVisit ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(visitForm)
            });

            if (response.ok) {
                await fetchSingleCustomer(selectedCustomerId);
                setShowVisitModal(false);
                // Reset form
                setVisitForm({
                    date: '',
                    purpose: '',
                    notes: '',
                    outcome: '',
                    nextAction: ''
                });
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to save visit');
            }
        } catch (error) {
            console.error('Error saving visit:', error);
            alert('Failed to save visit');
        } finally {
            setIsSaving(false);
        }
    };

    const handleQuickAddVisit = async () => {
        if (!visitForm.notes.trim() && !visitForm.image) return;

        try {
            // Create a temporary form object for the quick add
            const quickVisit = {
                date: new Date().toISOString(), // Send full timestamp
                purpose: 'Quick Note',
                notes: visitForm.notes,
                outcome: '',
                nextAction: '',
                image: visitForm.image || ''
            };

            const url = `${API_URL}/api/customers/${selectedCustomerId}/visits`;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(quickVisit)
            });

            if (response.ok) {
                await fetchSingleCustomer(selectedCustomerId);
                // Clear notes and image
                setVisitForm(prev => ({ ...prev, notes: '', image: '' }));
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to save note');
            }
        } catch (error) {
            console.error('Error saving note:', error);
            alert('Failed to save note');
        }
    };

    const handleDeleteVisit = async (visitId) => {
        if (!confirm('Are you sure you want to delete this visit?')) return;

        try {
            const response = await fetch(`${API_URL}/api/customers/${selectedCustomerId}/visits/${visitId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                await fetchCustomers();
            } else {
                alert('Failed to delete visit');
            }
        } catch (error) {
            console.error('Error deleting visit:', error);
            alert('Failed to delete visit');
        }
    };

    // Resource CRUD operations
    const handleAddResource = () => {
        setEditingResource(null);
        setIsViewingResource(false);
        setImagePreview(null);
        setResourceForm({
            title: '',
            date: new Date().toISOString().split('T')[0],
            customerId: selectedCustomer ? selectedCustomer._id : '',
            customer: selectedCustomer ? `${selectedCustomer.firstName} ${selectedCustomer.lastName}` : '',
            location: '',
            resourceType: '',
            image: '',
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
        setShowResourceModal(true);
    };

    const handleEditResource = (resource) => {
        setEditingResource(resource);
        setIsViewingResource(false);
        setImagePreview(resource.image || null);
        setResourceForm({
            title: resource.title || '',
            date: resource.date ? new Date(resource.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            customerId: resource.customerId || selectedCustomerId, // Fallback to current if missing
            customer: resource.customer || '',
            location: resource.location || '',
            resourceType: resource.resourceType || '',
            image: resource.image || '',
            description: resource.description || '',
            notes: resource.notes || '',
            status: resource.status || 'Active',
            url: resource.url || '',
            uploadedBy: resource.uploadedBy || ''
        });
        setShowResourceModal(true);
    };

    const handleViewResource = (resource) => {
        setEditingResource(resource);
        setIsViewingResource(true);
        setImagePreview(resource.image || null);
        setResourceForm({
            title: resource.title || '',
            date: resource.date ? new Date(resource.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            customerId: resource.customerId || selectedCustomerId,
            customer: resource.customer || '',
            location: resource.location || '',
            resourceType: resource.resourceType || '',
            image: resource.image || '',
            description: resource.description || '',
            notes: resource.notes || '',
            status: resource.status || 'Active',
            url: resource.url || '',
            uploadedBy: resource.uploadedBy || ''
        });
        setShowResourceModal(true);
    };

    const handleSaveResource = async () => {
        try {
            setIsSaving(true);
            // Use the selected customer ID from the form, or fallback to the currently selected customer
            const targetCustomerId = resourceForm.customerId || selectedCustomerId;

            if (!targetCustomerId) {
                alert('Please select a client');
                setIsSaving(false);
                return;
            }

            const url = editingResource
                ? `${API_URL}/api/customers/${targetCustomerId}/resources/${editingResource._id}`
                : `${API_URL}/api/customers/${targetCustomerId}/resources`;

            const method = editingResource ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(resourceForm)
            });

            if (response.ok) {
                await fetchCustomers();
                setShowResourceModal(false);
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to save resource');
            }
        } catch (error) {
            console.error('Error saving resource:', error);
            alert('Failed to save resource');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteResource = async (resourceId) => {
        if (!confirm('Are you sure you want to delete this resource?')) return;

        try {
            const response = await fetch(`${API_URL}/api/customers/${selectedCustomerId}/resources/${resourceId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                await fetchCustomers();
            } else {
                alert('Failed to delete resource');
            }
        } catch (error) {
            console.error('Error deleting resource:', error);
            alert('Failed to delete resource');
        }
    };

    // Visit Image upload handler
    const handleVisitImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                alert('File size too large. Please upload an image smaller than 5MB.');
                return;
            }

            const reader = new FileReader();
            reader.onloadend = () => {
                setVisitForm(prev => ({ ...prev, image: reader.result }));
            };
            reader.readAsDataURL(file);
        }
    };

    // Resource Image upload handler
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                alert('Image size should be less than 5MB');
                return;
            }

            if (!file.type.startsWith('image/')) {
                alert('Please upload an image file');
                return;
            }

            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result;
                setResourceForm({ ...resourceForm, image: base64String });
                setImagePreview(base64String);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleRemoveImage = () => {
        setResourceForm({ ...resourceForm, image: '' });
        setImagePreview(null);
    };

    if (loading) {
        return (
            <div className="sales-page">
                <div className="sales-header">
                    <h1>Customers</h1>
                </div>
                <div className="container" style={{ padding: '2rem', textAlign: 'center' }}>
                    <p>Loading customers...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="sales-page">
                <div className="sales-header">
                    <h1>Customers</h1>
                </div>
                <div className="container" style={{ padding: '2rem', textAlign: 'center' }}>
                    <p style={{ color: '#ef4444' }}>Error: {error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="sales-container">
            {/* Sidebar - Hide in full screen chat */}
            {!isChatFullScreen && (
                <div className="sales-sidebar">
                    <div className="sidebar-header">
                        <h2>Customers</h2>
                        <span className="customer-count">{filteredCustomers.length}</span>
                    </div>

                    <div className="search-box">
                        <Search size={16} className="search-icon" />
                        <input
                            type="text"
                            placeholder="Search customers..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="customer-list">
                        {filteredCustomers.length === 0 ? (
                            <div className="empty-list-message">
                                No customers found
                            </div>
                        ) : (
                            filteredCustomers.map(customer => (
                                <div
                                    key={customer._id}
                                    className={`customer-list-item ${selectedCustomerId === customer._id ? 'active' : ''}`}
                                    onClick={() => handleSelectCustomer(customer)}
                                >
                                    <div className="list-thumb-placeholder">
                                        <User size={20} />
                                    </div>
                                    <div className="list-info">
                                        <span className="list-name">
                                            {customer.company || `${customer.firstName} ${customer.lastName}`}
                                            {customer.isActive === false && <span className="inactive-badge">(Inactive)</span>}
                                        </span>
                                        <span className="list-meta">{customer.company || customer.email}</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div className={`sales-main ${isChatFullScreen ? 'full-screen' : ''}`}>
                {selectedCustomer ? (
                    <>
                        {/* Customer Header - Hide in full screen chat */}
                        {!isChatFullScreen && (
                            <div className="customer-header">
                                <div className="header-left">
                                    <div className="title-row">
                                        <h1 className="customer-name">
                                            {selectedCustomer.company || `${selectedCustomer.firstName} ${selectedCustomer.lastName}`}
                                        </h1>
                                        <div className="header-tabs">
                                            <button
                                                className={`header-tab ${activeTab === 'visits' ? 'active' : ''}`}
                                                onClick={() => setActiveTab('visits')}
                                            >
                                                Visits
                                            </button>
                                            <button
                                                className={`header-tab ${activeTab === 'resources' ? 'active' : ''}`}
                                                onClick={() => setActiveTab('resources')}
                                            >
                                                Resources
                                            </button>
                                            <button
                                                className={`header-tab ${activeTab === 'contacts' ? 'active' : ''}`}
                                                onClick={() => setActiveTab('contacts')}
                                            >
                                                Contacts
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                        <span className={`status-badge ${selectedCustomer.isActive ? 'status-active' : 'status-inactive'}`}>
                                            ● {selectedCustomer.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                        <span className="text-muted">
                                            Level {selectedCustomer.priceLevel}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    className="btn-secondary"
                                    onClick={() => setShowCustomerInfo(!showCustomerInfo)}
                                >
                                    {showCustomerInfo ? 'Hide Info' : 'Show Info'}
                                </button>
                            </div>
                        )}

                        {/* Collapsible Info Section - Hide in full screen chat */}
                        {!isChatFullScreen && showCustomerInfo && (
                            <>
                                {/* Info Boxes Row */}
                                <div className="info-boxes">
                                    <div className="info-box">
                                        <label>Price Level</label>
                                        <p>{getPriceLevelLabel(selectedCustomer.priceLevel)}</p>
                                    </div>
                                    <div className="info-box">
                                        <label>Location</label>
                                        <p>{selectedCustomer.address?.city || 'N/A'}, {selectedCustomer.address?.state || 'N/A'}</p>
                                    </div>
                                    <div className="info-box">
                                        <label>Type</label>
                                        <p>Customer</p>
                                    </div>
                                    <div className="info-box">
                                        <label>Status</label>
                                        <p className={selectedCustomer.isActive !== false ? 'status-active' : 'status-inactive'}>
                                            {selectedCustomer.isActive !== false ? 'Active' : 'Inactive'}
                                        </p>
                                    </div>
                                    <div className="info-box">
                                        <label>Member Since</label>
                                        <p>{selectedCustomer.createdAt ? new Date(selectedCustomer.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}</p>
                                    </div>
                                </div>

                                {/* Three Column Layout */}
                                <div className="detail-columns">
                                    <div className="detail-column">
                                        <h3>Address</h3>
                                        <div className="column-content">
                                            <p className="address-line">
                                                {selectedCustomer.address?.street || 'No street address'}
                                            </p>
                                            <p className="address-line">
                                                {selectedCustomer.address?.city || ''}{selectedCustomer.address?.city && selectedCustomer.address?.state ? ', ' : ''}{selectedCustomer.address?.state || ''} {selectedCustomer.address?.zipCode || ''}
                                            </p>
                                            {!selectedCustomer.address?.city && !selectedCustomer.address?.state && (
                                                <p className="text-muted">No address provided</p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="detail-column">
                                        <h3>Contact</h3>
                                        <div className="column-content">
                                            <div className="contact-item">
                                                <User size={16} />
                                                <span>{selectedCustomer.firstName} {selectedCustomer.lastName}</span>
                                            </div>
                                            <div className="contact-item">
                                                <span className="text-muted">Email:</span>
                                                <span>{selectedCustomer.email}</span>
                                            </div>
                                            <div className="contact-item">
                                                <span className="text-muted">Phone:</span>
                                                <span>{selectedCustomer.phone || 'N/A'}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="detail-column">
                                        <h3>Account Details</h3>
                                        <div className="column-content">
                                            <div className="info-row">
                                                <label>Customer ID:</label>
                                                <span>{selectedCustomer._id.substring(0, 8)}...</span>
                                            </div>
                                            <div className="info-row">
                                                <label>Tax Exempt:</label>
                                                <span>{selectedCustomer.isTaxExempt ? 'Yes' : 'No'}</span>
                                            </div>
                                            <div className="info-row">
                                                <label>Credit Limit:</label>
                                                <span>${selectedCustomer.creditLimit?.toLocaleString() || '0'}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}     <div className="tab-content">
                            {activeTab === 'contacts' && (
                                <div className="tab-section">
                                    <div className="tab-header">
                                        <h3>Contacts</h3>
                                        <button className="add-btn" onClick={handleAddContact}>
                                            <Plus size={18} /> Add Contact
                                        </button>
                                    </div>
                                    <div className="data-table">
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Name</th>
                                                    <th>Phone</th>
                                                    <th>Email</th>
                                                    <th>Role</th>
                                                    <th>Primary</th>
                                                    <th>Notes</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedCustomer.contacts && selectedCustomer.contacts.length > 0 ? (
                                                    selectedCustomer.contacts.map(contact => (
                                                        <tr key={contact._id}>
                                                            <td>{contact.name}</td>
                                                            <td>{contact.phone || '-'}</td>
                                                            <td>{contact.email || '-'}</td>
                                                            <td>{contact.role || '-'}</td>
                                                            <td>{contact.isPrimary ? 'Yes' : 'No'}</td>
                                                            <td>{contact.notes || '-'}</td>
                                                            <td>
                                                                <div className="action-buttons">
                                                                    <button className="icon-btn edit" onClick={() => handleEditContact(contact)}>
                                                                        <Edit2 size={14} />
                                                                    </button>
                                                                    <button className="icon-btn delete" onClick={() => handleDeleteContact(contact._id)}>
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))
                                                ) : (
                                                    <tr>
                                                        <td colSpan="7" className="empty-row">No contacts added yet</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'visits' && (
                                <div className="tab-section" style={{ height: '100%', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                    <div className="chat-header-actions" style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)' }}>
                                        <h3 style={{ margin: 0, fontSize: '1rem' }}>
                                            {isChatFullScreen ? (selectedCustomer.company || selectedCustomer.firstName) : 'Visits'}
                                        </h3>
                                        <button
                                            className="icon-btn"
                                            onClick={() => setIsChatFullScreen(!isChatFullScreen)}
                                            title={isChatFullScreen ? "Exit Full Screen" : "Full Screen"}
                                        >
                                            {isChatFullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                                        </button>
                                    </div>
                                    <div className="chat-container">
                                        <div className="chat-messages">
                                            {selectedCustomer.visits && selectedCustomer.visits.length > 0 ? (
                                                selectedCustomer.visits.map(visit => {
                                                    // Debug logging
                                                    if (visit.image) console.log('Rendering visit with image:', visit._id, visit.image.substring(0, 50) + '...');

                                                    // Determine if this visit was created by the current user
                                                    const isOwnVisit = visit.createdBy === currentUserId;
                                                    const messageClass = isOwnVisit ? 'chat-message self' : 'chat-message other';

                                                    return (
                                                        <div key={visit._id} className={messageClass}>
                                                            <div className="message-avatar">
                                                                <User size={20} />
                                                            </div>
                                                            <div className="message-content">
                                                                <div className="message-header">
                                                                    <span className="message-sender">{visit.createdByName || visit.purpose || 'Visit'}</span>
                                                                    <span className="message-time">
                                                                        {visit.date ? new Date(visit.date).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                                                                        {visit.image && <span style={{ marginLeft: '5px', fontSize: '0.7em', color: 'var(--accent-color)' }}>(Img)</span>}
                                                                    </span>
                                                                    <div className="message-actions">
                                                                        <button className="icon-btn edit" onClick={() => handleEditVisit(visit)}>
                                                                            <Edit2 size={14} />
                                                                        </button>
                                                                        <button className="icon-btn delete" onClick={() => handleDeleteVisit(visit._id)}>
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <div className="message-body">
                                                                    {visit.image && (
                                                                        <div className="message-image" onClick={() => setFullScreenImage(visit.image)}>
                                                                            <img src={visit.image} alt="Visit attachment" />
                                                                        </div>
                                                                    )}
                                                                    {visit.notes || 'No notes provided.'}
                                                                </div>
                                                                <div className="message-meta">
                                                                    {visit.outcome && (
                                                                        <span className="meta-tag outcome">Outcome: {visit.outcome}</span>
                                                                    )}
                                                                    {visit.nextAction && (
                                                                        <span className="meta-tag next-action">Next: {visit.nextAction}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <div className="empty-list-message">
                                                    No visits recorded yet. Start a conversation!
                                                </div>
                                            )}
                                        </div>

                                        <div className="chat-input-area">
                                            <div className="chat-input-actions">
                                                <label className="chat-action-btn">
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        onChange={handleVisitImageUpload}
                                                        style={{ display: 'none' }}
                                                    />
                                                    <Paperclip size={18} />
                                                </label>
                                            </div>
                                            <div className="chat-input-wrapper">
                                                {visitForm.image && (
                                                    <div className="chat-image-preview">
                                                        <img src={visitForm.image} alt="Preview" />
                                                        <button className="remove-image" onClick={() => setVisitForm(prev => ({ ...prev, image: '' }))}>
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                )}
                                                <textarea
                                                    className="chat-input"
                                                    placeholder="Add a new visit note..."
                                                    value={visitForm.notes}
                                                    onChange={(e) => setVisitForm({ ...visitForm, notes: e.target.value })}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && !e.shiftKey) {
                                                            e.preventDefault();
                                                            handleQuickAddVisit();
                                                        }
                                                    }}
                                                />
                                            </div>
                                            <button
                                                className="chat-send-btn"
                                                onClick={handleQuickAddVisit}
                                                disabled={!visitForm.notes.trim() && !visitForm.image}
                                            >
                                                <Send size={18} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'resources' && (
                                <div className="tab-section resources-tab">
                                    {/* Filters Section */}
                                    <div className="resources-filters">
                                        <div className="filter-row">
                                            <div className="filter-group">
                                                <label>Customer</label>
                                                <select
                                                    value={resourceFilters.customer}
                                                    onChange={(e) => setResourceFilters({ ...resourceFilters, customer: e.target.value })}
                                                >
                                                    <option value="">Select Customer</option>
                                                    {customers.map(c => (
                                                        <option key={c._id} value={c.company || `${c.firstName} ${c.lastName}`}>
                                                            {c.company || `${c.firstName} ${c.lastName}`}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="filter-group">
                                                <label>Start Date</label>
                                                <input
                                                    type="date"
                                                    value={resourceFilters.startDate}
                                                    onChange={(e) => setResourceFilters({ ...resourceFilters, startDate: e.target.value })}
                                                />
                                            </div>
                                            <div className="filter-group">
                                                <label>End Date</label>
                                                <input
                                                    type="date"
                                                    value={resourceFilters.endDate}
                                                    onChange={(e) => setResourceFilters({ ...resourceFilters, endDate: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="filter-actions">
                                            <button className="btn-primary">SUBMIT</button>
                                            <button className="btn-secondary">RESET</button>
                                        </div>
                                    </div>

                                    {/* Header with Title and Add Button */}
                                    <div className="resources-header">
                                        <h2>Client Resource</h2>
                                        <button className="add-resource-btn" onClick={handleAddResource}>
                                            Add Resource 📄
                                        </button>
                                    </div>

                                    {/* Excel Export and Search */}
                                    <div className="resources-toolbar">
                                        <button className="excel-btn">
                                            📥 Excel
                                        </button>
                                        <input
                                            type="text"
                                            className="resource-search"
                                            placeholder="Search..."
                                            value={resourceSearch}
                                            onChange={(e) => setResourceSearch(e.target.value)}
                                        />
                                    </div>

                                    {/* Resources Table */}
                                    <div className="resources-table-wrapper">
                                        <table className="resources-table">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: '50px' }}>#</th>
                                                    <th>Date</th>
                                                    <th>Client</th>
                                                    <th>Location</th>
                                                    <th>Type</th>
                                                    <th style={{ width: '120px' }}>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredResources && filteredResources.length > 0 ? (
                                                    filteredResources.map((resource, index) => (
                                                        <React.Fragment key={resource._id || index}>
                                                            <tr
                                                                className={expandedResourceId === resource._id ? 'expanded' : ''}
                                                                onClick={() => setExpandedResourceId(expandedResourceId === resource._id ? null : resource._id)}
                                                            >
                                                                <td>{index + 1}</td>
                                                                <td>{resource.date ? new Date(resource.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '-'}</td>
                                                                <td>
                                                                    {(() => {
                                                                        const customerObj = customers.find(c => c._id === resource.customerId);
                                                                        return customerObj ? (customerObj.company || `${customerObj.firstName} ${customerObj.lastName}`) : (resource.customer || '-');
                                                                    })()}
                                                                </td>
                                                                <td>{resource.location || '-'}</td>
                                                                <td>{resource.resourceType || '-'}</td>
                                                                <td>
                                                                    <div className="action-buttons" onClick={(e) => e.stopPropagation()}>
                                                                        <button className="icon-btn view" onClick={(e) => { e.stopPropagation(); handleViewResource(resource); }} title="View">
                                                                            <Eye size={16} />
                                                                        </button>
                                                                        <button className="icon-btn edit" onClick={(e) => { e.stopPropagation(); handleEditResource(resource); }} title="Edit">
                                                                            <Edit2 size={16} />
                                                                        </button>
                                                                        <button className="icon-btn delete" onClick={(e) => { e.stopPropagation(); handleDeleteResource(resource._id); }} title="Delete">
                                                                            <Trash2 size={16} />
                                                                        </button>
                                                                        {resource.url && (
                                                                            <a href={resource.url} target="_blank" rel="noopener noreferrer" className="icon-btn link" onClick={(e) => e.stopPropagation()} title="Open Link">
                                                                                🔗
                                                                            </a>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                            {expandedResourceId === resource._id && (
                                                                <tr className="resource-details-row">
                                                                    <td colSpan="6">
                                                                        <div className="resource-details">
                                                                            <div className="detail-item">
                                                                                <strong>Image</strong>
                                                                                <div>
                                                                                    {resource.image ? (
                                                                                        <img src={resource.image} alt="Resource" style={{ maxWidth: '100px', maxHeight: '100px' }} />
                                                                                    ) : (
                                                                                        <span className="placeholder-img">📷</span>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                            <div className="detail-item">
                                                                                <strong>Description</strong>
                                                                                <p>{resource.description || '-'}</p>
                                                                            </div>
                                                                            <div className="detail-item">
                                                                                <strong>Notes</strong>
                                                                                <p>{resource.notes || '-'}</p>
                                                                            </div>
                                                                            <div className="detail-item">
                                                                                <strong>Status</strong>
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                                                                                    <span className={`status-badge ${resource.status?.toLowerCase()}`}>
                                                                                        {resource.status || 'Active'}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </React.Fragment>
                                                    ))
                                                ) : (
                                                    <tr>
                                                        <td colSpan="5" className="empty-row">No resources found</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Pagination */}
                                    <div className="resources-pagination">
                                        <span>Showing 1 to {filteredResources.length} of {filteredResources.length} entries</span>
                                        <div className="pagination-buttons">
                                            <button className="btn-secondary">Previous</button>
                                            <button className="btn-primary active">1</button>
                                            <button className="btn-secondary">Next</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="empty-state">
                        <User size={64} style={{ color: '#4b5563' }} />
                        <h2>No Customer Selected</h2>
                        <p>Select a customer from the list to view their details</p>
                    </div>
                )}
            </div>

            {/* Contact Modal */}
            {
                showContactModal && (
                    <div className="modal-overlay" onClick={() => setShowContactModal(false)}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>{editingContact ? 'Edit Contact' : 'Add Contact'}</h2>
                                <button className="close-btn" onClick={() => setShowContactModal(false)}>
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Name *</label>
                                    <input
                                        type="text"
                                        value={contactForm.name}
                                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                                        placeholder="Contact name"
                                    />
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Phone</label>
                                        <input
                                            type="tel"
                                            value={contactForm.phone}
                                            onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                                            placeholder="Phone number"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Email</label>
                                        <input
                                            type="email"
                                            value={contactForm.email}
                                            onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                                            placeholder="Email address"
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Role</label>
                                    <input
                                        type="text"
                                        value={contactForm.role}
                                        onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
                                        placeholder="Job title or role"
                                    />
                                </div>
                                <div className="form-group checkbox-group">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={contactForm.isPrimary}
                                            onChange={(e) => setContactForm({ ...contactForm, isPrimary: e.target.checked })}
                                        />
                                        <span>Primary Contact</span>
                                    </label>
                                </div>
                                <div className="form-group">
                                    <label>Notes</label>
                                    <textarea
                                        value={contactForm.notes}
                                        onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                                        placeholder="Additional notes"
                                        rows="3"
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button className="btn-secondary" onClick={() => setShowContactModal(false)} disabled={isSaving}>Cancel</button>
                                <button className="btn-primary" onClick={handleSaveContact} disabled={isSaving}>
                                    {isSaving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Visit Modal */}
            {
                showVisitModal && (
                    <div className="modal-overlay" onClick={() => setShowVisitModal(false)}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>{editingVisit ? 'Edit Visit' : 'Add Visit'}</h2>
                                <button className="close-btn" onClick={() => setShowVisitModal(false)}>
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Date *</label>
                                    <input
                                        type="date"
                                        value={visitForm.date}
                                        onChange={(e) => setVisitForm({ ...visitForm, date: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Purpose</label>
                                    <input
                                        type="text"
                                        value={visitForm.purpose}
                                        onChange={(e) => setVisitForm({ ...visitForm, purpose: e.target.value })}
                                        placeholder="Purpose of visit"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Outcome</label>
                                    <input
                                        type="text"
                                        value={visitForm.outcome}
                                        onChange={(e) => setVisitForm({ ...visitForm, outcome: e.target.value })}
                                        placeholder="Visit outcome"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Next Action</label>
                                    <input
                                        type="text"
                                        value={visitForm.nextAction}
                                        onChange={(e) => setVisitForm({ ...visitForm, nextAction: e.target.value })}
                                        placeholder="Next steps"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Notes</label>
                                    <textarea
                                        value={visitForm.notes}
                                        onChange={(e) => setVisitForm({ ...visitForm, notes: e.target.value })}
                                        placeholder="Additional notes"
                                        rows="4"
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button className="btn-secondary" onClick={() => setShowVisitModal(false)} disabled={isSaving}>Cancel</button>
                                <button className="btn-primary" onClick={handleSaveVisit} disabled={isSaving}>
                                    {isSaving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Resource Modal */}
            {
                showResourceModal && (
                    <div className="modal-overlay" onClick={() => setShowResourceModal(false)}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>{editingResource ? (isViewingResource ? 'Resource Details' : 'Edit Resource') : 'Add Resource'}</h2>
                                <button className="close-btn" onClick={() => setShowResourceModal(false)}>
                                    <X size={20} />
                                </button>
                            </div>

                            {isViewingResource ? (
                                /* View Mode Layout */
                                <div className={`modal-body view-mode ${resourceForm.image ? 'has-image' : ''}`}>
                                    {resourceForm.image && (
                                        <div className="view-image-container">
                                            <img
                                                src={resourceForm.image}
                                                alt="Resource"
                                                onClick={() => setFullScreenImage(resourceForm.image)}
                                                className="view-resource-image"
                                            />
                                            <div className="view-image-overlay">
                                                <Maximize2 size={20} />
                                            </div>
                                        </div>
                                    )}

                                    <div className="view-content-wrapper">
                                        <div className="view-details-grid">
                                            <div className="view-detail-item">
                                                <label>Client</label>
                                                <p>{resourceForm.customer || '-'}</p>
                                            </div>
                                            <div className="view-detail-item">
                                                <label>Type</label>
                                                <p>{resourceForm.resourceType || '-'}</p>
                                            </div>
                                            <div className="view-detail-item">
                                                <label>Date</label>
                                                <p>{resourceForm.date ? new Date(resourceForm.date).toLocaleDateString() : '-'}</p>
                                            </div>
                                            <div className="view-detail-item">
                                                <label>Status</label>
                                                <span className={`status-badge ${resourceForm.status?.toLowerCase()}`}>
                                                    {resourceForm.status || 'Active'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="view-section">
                                            <label>Description</label>
                                            <p className="view-text">{resourceForm.description || 'No description provided.'}</p>
                                        </div>

                                        {resourceForm.notes && (
                                            <div className="view-section">
                                                <label>Notes</label>
                                                <p className="view-text">{resourceForm.notes}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                /* Edit/Add Mode Layout */
                                <div className="modal-body">
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>Client</label>
                                            <select
                                                value={resourceForm.customerId}
                                                onChange={(e) => {
                                                    const selectedC = customers.find(c => c._id === e.target.value);
                                                    setResourceForm({
                                                        ...resourceForm,
                                                        customerId: e.target.value,
                                                        customer: selectedC ? (selectedC.company || `${selectedC.firstName} ${selectedC.lastName}`) : ''
                                                    });
                                                }}
                                                className="form-select"
                                            >
                                                <option value="">Please Select Client</option>
                                                {customers.map(c => (
                                                    <option key={c._id} value={c._id}>
                                                        {c.company || `${c.firstName} ${c.lastName}`}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>Resource Type</label>
                                            <select
                                                value={resourceForm.resourceType}
                                                onChange={(e) => setResourceForm({ ...resourceForm, resourceType: e.target.value, title: e.target.value })}
                                                className="form-select"
                                            >
                                                <option value="">Please Select Resource Type</option>
                                                {resourceTypes.map((type, index) => (
                                                    <option key={index} value={type}>{type}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>Date</label>
                                            <input
                                                type="date"
                                                value={resourceForm.date}
                                                onChange={(e) => setResourceForm({ ...resourceForm, date: e.target.value })}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Description</label>
                                            <input
                                                type="text"
                                                value={resourceForm.description}
                                                onChange={(e) => setResourceForm({ ...resourceForm, description: e.target.value })}
                                                placeholder="Description"
                                            />
                                        </div>
                                    </div>

                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>Status</label>
                                            <select
                                                value={resourceForm.status}
                                                onChange={(e) => setResourceForm({ ...resourceForm, status: e.target.value })}
                                                className="form-select"
                                            >
                                                <option value="Active">Active</option>
                                                <option value="Inactive">Inactive</option>
                                                <option value="Archived">Archived</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>Notes</label>
                                            <textarea
                                                value={resourceForm.notes}
                                                onChange={(e) => setResourceForm({ ...resourceForm, notes: e.target.value })}
                                                placeholder="Additional notes"
                                                rows="1"
                                                style={{ resize: 'none' }}
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label>Image</label>
                                        <div className="image-upload-container">
                                            {imagePreview || resourceForm.image ? (
                                                <div className="image-preview-wrapper">
                                                    <img
                                                        src={imagePreview || resourceForm.image}
                                                        alt="Preview"
                                                        className="image-preview"
                                                    />
                                                    <button
                                                        type="button"
                                                        className="remove-image-btn"
                                                        onClick={handleRemoveImage}
                                                    >
                                                        <X size={16} /> Remove
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="file-input-wrapper">
                                                    <input
                                                        type="file"
                                                        id="image-upload"
                                                        accept="image/*"
                                                        onChange={handleImageUpload}
                                                        className="file-input"
                                                    />
                                                    <label htmlFor="image-upload" className="file-input-label">
                                                        Choose File
                                                    </label>
                                                    <span className="file-name">No file chosen</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="modal-footer">
                                {isViewingResource ? (
                                    <button className="btn-secondary" onClick={() => setShowResourceModal(false)}>Close</button>
                                ) : (
                                    <button className="btn-primary submit-btn" onClick={handleSaveResource} disabled={isSaving}>
                                        {isSaving ? 'Saving...' : 'Submit'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Full Screen Image Modal */}
            {
                fullScreenImage && (
                    <div className="fullscreen-image-overlay" onClick={() => setFullScreenImage(null)}>
                        <div className="fullscreen-image-container" onClick={(e) => e.stopPropagation()}>
                            <button className="fullscreen-close-btn" onClick={() => setFullScreenImage(null)}>
                                <X size={32} />
                            </button>
                            <img src={fullScreenImage} alt="Full Screen" />
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default SalesPage;
