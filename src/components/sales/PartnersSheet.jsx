import React, { useState, useEffect } from 'react';
import {
    Search, Plus, Download, Edit2, Trash2, FileText, Menu,
    X, Mail, Phone, Eye, Filter, MoreVertical, Loader
} from 'lucide-react';
import Pagination from '../shared/Pagination';
import { API_URL } from '../../config/api';
import * as XLSX from 'xlsx';
import { formatPhoneInput, formatPhoneForDisplay } from '../../utils/phoneUtils';
import './PartnersSheet.css';

const PartnersSheet = ({ onSelectCustomer, onToggleSidebar }) => {
    const [partners, setPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingPartner, setEditingPartner] = useState(null);
    const [viewingPartner, setViewingPartner] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [limit, setLimit] = useState(15);

    const [newPartner, setNewPartner] = useState({
        contactName: '',
        company: '',
        email: '',
        phone: '',
        notes: '',
        status: 'New',
        level: 'Level - 1',
        city: '',
        customerType: 'Fabricator',
        modaDisplay: 'No',
        modaBinder: ''
    });

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        fetchPartners();
    }, [currentPage, debouncedSearch, limit]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchTerm);
            setCurrentPage(1); // Reset to first page on search
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const fetchPartners = async () => {
        setLoading(true);
        try {
            const url = new URL(`${API_URL}/api/partners`, window.location.origin);
            url.searchParams.append('page', currentPage);
            url.searchParams.append('limit', limit);
            if (debouncedSearch) {
                url.searchParams.append('search', debouncedSearch);
            }

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                setPartners(data.partners || []);
                setTotalPages(data.totalPages || 1);
                setTotalCount(data.totalCount || 0);
            }
        } catch (error) {
            console.error('Error fetching leads:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSavePartner = async (e) => {
        if (e) e.preventDefault();
        
        // Frontend validation
        const partner = editingPartner || newPartner;
        if (!partner.company?.trim()) {
            alert('Company name is required');
            return;
        }
        if (!partner.contactName?.trim()) {
            alert('Contact name is required');
            return;
        }
        if (!partner.email?.trim()) {
            alert('Email address is required');
            return;
        }

        setIsSaving(true);
        try {
            const method = editingPartner ? 'PUT' : 'POST';
            const url = editingPartner
                ? `${API_URL}/api/partners/${editingPartner._id}`
                : `${API_URL}/api/partners`;

            // Prepare correct payload
            const leadData = {
                ...(editingPartner || newPartner),
                // Ensure name is also populated for legacy mapping compatibility
                name: (editingPartner || newPartner).contactName
            };

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(leadData),
                credentials: 'include'
            });

            if (response.ok) {
                await fetchPartners();
                setShowAddModal(false);
                setEditingPartner(null);
                setViewingPartner(null);
                setNewPartner({
                    contactName: '',
                    company: '',
                    email: '',
                    phone: '',
                    notes: '',
                    status: 'New',
                    level: 'Level - 1',
                    city: '',
                    customerType: 'Fabricator',
                    modaDisplay: 'No',
                    modaBinder: '',
                    priority: 'Medium'
                });
            } else {
                const errorData = await response.json();
                console.error('Server error saving lead:', errorData);
                alert(errorData.message || 'Failed to save lead');
            }
        } catch (error) {
            console.error('Error saving lead:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeletePartner = async (id) => {
        if (!window.confirm('Are you sure you want to delete this lead?')) return;
        try {
            const response = await fetch(`${API_URL}/api/partners/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                credentials: 'include'
            });
            if (response.ok) {
                setPartners(partners.filter(l => l._id !== id));
            } else {
                const errorData = await response.json();
                alert(errorData.message || 'Failed to delete partner');
            }
        } catch (error) {
            console.error('Error deleting partner:', error);
            alert('An error occurred while deleting the partner');
        }
    };

    const exportToExcel = async () => {
        try {
            setLoading(true);
            const url = new URL(`${API_URL}/api/partners`, window.location.origin);
            url.searchParams.append('limit', -1);
            if (debouncedSearch) {
                url.searchParams.append('search', debouncedSearch);
            }

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                const allPartners = data.partners || [];
                
                const worksheet = XLSX.utils.json_to_sheet(allPartners.map(l => ({
                    Name: l.contactName || l.name || '-',
                    Company: l.company || '-',
                    Email: l.email || '-',
                    Phone: formatPhoneForDisplay(l.phone),
                    Status: l.status || '-',
                    City: l.city || '-',
                    Type: l.customerType || '-',
                    Notes: l.notes || '-',
                    Created: new Date(l.createdAt).toLocaleDateString()
                })));
                
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Partners");
                XLSX.writeFile(workbook, `Partner_List_${new Date().toISOString().split('T')[0]}.xlsx`);
            }
        } catch (error) {
            console.error('Error exporting partners:', error);
            alert('Failed to export data');
        } finally {
            setLoading(false);
        }
    };

    const paginatedPartners = partners; // Server-side handles filtering and paging

    const handleCloseModal = () => {
        setShowAddModal(false);
        setEditingPartner(null);
        setViewingPartner(null);
    };

    return (
        <div className="partners-sheet-container">
            <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    {isMobile && onToggleSidebar && (
                        <button
                            onClick={onToggleSidebar}
                            className="dashboard-sidebar-toggle"
                            title="Open Sidebar"
                            style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                                borderRadius: '6px',
                                padding: '6px',
                                color: 'var(--gold-color, #d4af37)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                marginRight: '0.25rem'
                            }}
                        >
                            <Menu size={20} />
                        </button>
                    )}
                    <h2>Customer List</h2>
                    {!loading && <span className="customer-count">{totalCount}</span>}
                </div>
                <div className="table-controls">
                    <button className="export-btn" onClick={exportToExcel}>
                        <Download size={18} />
                        Export
                    </button>
                    <div className="table-search">
                        <Search className="search-icon" size={18} />
                        <input
                            type="text"
                            placeholder="Search partners..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button className="partner-add-btn pulse" onClick={() => {
                        setEditingPartner(null);
                        setViewingPartner(null);
                        setShowAddModal(true);
                    }}>
                        <Plus size={18} />
                        Add Customer
                    </button>
                </div>
            </div>

            <div className="dashboard-table-wrapper">
                <table className="dashboard-table">
                    <thead>
                        <tr>
                            <th>Company</th>
                            {!isMobile && (
                                 <>
                                    <th>Contact Name</th>
                                    <th>Email</th>
                                    <th>Phone</th>
                                    <th>Type</th>
                                    <th>City</th>
                                    <th>Level</th>
                                    <th>Moda Display</th>
                                    <th>Moda Binder</th>
                                    <th>Status</th>
                                </>
                            )}
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={isMobile ? 2 : 11} style={{ textAlign: 'center', padding: '3rem' }}>
                                <div className="loader-container">
                                    <div className="loader-spinner"></div>
                                    <span>Loading partners...</span>
                                </div>
                            </td></tr>
                        ) : paginatedPartners.length === 0 ? (
                            <tr><td colSpan={isMobile ? 2 : 11} style={{ textAlign: 'center', padding: '3rem' }}>
                                <div className="empty-state">
                                    <FileText size={48} opacity={0.2} />
                                    <p>No partners found. Start by adding your first partner!</p>
                                </div>
                            </td></tr>
                        ) : paginatedPartners.map(partner => (
                            <tr key={partner._id}>
                                <td>
                                    <button 
                                        className="company-link-btn" 
                                        onClick={() => onSelectCustomer && onSelectCustomer(partner)}
                                        title="View Profile"
                                    >
                                        <strong>{partner.company || partner.name || partner.contactName || '-'}</strong>
                                    </button>
                                </td>
                                {!isMobile && (
                                     <>
                                        <td>{partner.name || partner.contactName || '-'}</td>
                                        <td>
                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{partner.email || '-'}</span>
                                        </td>
                                        <td>{formatPhoneForDisplay(partner.phone) || '-'}</td>
                                        <td>
                                            <span className={`customer-type-badge ${(partner.customerType || 'fabricator').toLowerCase().replace(' ', '-')}`}>
                                                {partner.customerType || 'Fabricator'}
                                            </span>
                                        </td>
                                        <td>{partner.city || partner.address?.city || '-'}</td>
                                        <td>{partner.level || partner.segment || '-'}</td>
                                        <td>
                                            <span className={`moda-badge ${partner.modaDisplay?.toLowerCase()}`}>
                                                {partner.modaDisplay === 'Yes' ? '✅ Yes' : '❌ No'}
                                            </span>
                                        </td>
                                        <td>
                                            {partner.modaBinder ? (
                                                <span className="moda-badge yes">
                                                    {partner.modaBinder}
                                                </span>
                                            ) : (
                                                '-'
                                            )}
                                        </td>
                                        <td>
                                            <span className={`status-pill ${partner.status?.replace(' ', '-').toLowerCase()}`}>
                                                {partner.status}
                                            </span>
                                        </td>
                                    </>
                                )}
                                <td>
                                    <div className="table-actions">
                                        <button className="icon-btn edit" onClick={() => { setViewingPartner(partner); setShowAddModal(true); }} title="View Partner">
                                            <Eye size={16} />
                                        </button>
                                        <button className="icon-btn edit" onClick={() => { setEditingPartner(partner); setShowAddModal(true); }} title="Edit Partner">
                                            <Edit2 size={16} />
                                        </button>
                                        <button className="icon-btn delete" onClick={() => handleDeletePartner(partner._id)} title="Delete Partner">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                totalCount={totalCount}
                itemLabel="partners"
            />

            {showAddModal && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{viewingPartner ? 'View Partner' : (editingPartner ? 'Edit Partner' : 'Add New Partner')}</h2>
                            <button className="close-btn" onClick={handleCloseModal}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Company <span style={{ color: 'red' }}>*</span></label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Company name"
                                    value={viewingPartner ? viewingPartner.company : (editingPartner ? editingPartner.company : newPartner.company)}
                                    disabled={!!viewingPartner}
                                    onChange={e => editingPartner
                                        ? setEditingPartner({ ...editingPartner, company: e.target.value })
                                        : setNewPartner({ ...newPartner, company: e.target.value })
                                    }
                                />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                                <div className="form-group">
                                    <label>Contact Name</label>
                                    <input
                                        type="text"
                                        placeholder="Partner contact name"
                                        value={viewingPartner ? (viewingPartner.contactName || viewingPartner.name) : (editingPartner ? (editingPartner.contactName || editingPartner.name) : newPartner.contactName)}
                                        disabled={!!viewingPartner}
                                        onChange={e => editingPartner
                                            ? setEditingPartner({ ...editingPartner, contactName: e.target.value })
                                            : setNewPartner({ ...newPartner, contactName: e.target.value })
                                        }
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        placeholder="email@example.com"
                                        value={viewingPartner ? viewingPartner.email : (editingPartner ? editingPartner.email : newPartner.email)}
                                        disabled={!!viewingPartner}
                                        onChange={e => editingPartner
                                            ? setEditingPartner({ ...editingPartner, email: e.target.value })
                                            : setNewPartner({ ...newPartner, email: e.target.value })
                                        }
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                                <div className="form-group">
                                    <label>Phone</label>
                                    <input
                                        type="text"
                                        placeholder="(555) 000-0000"
                                        value={viewingPartner ? viewingPartner.phone : (editingPartner ? editingPartner.phone : newPartner.phone)}
                                        disabled={!!viewingPartner}
                                        onChange={e => {
                                            const val = formatPhoneInput(e.target.value);
                                            editingPartner
                                                ? setEditingPartner({ ...editingPartner, phone: val })
                                                : setNewPartner({ ...newPartner, phone: val });
                                        }}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Status</label>
                                    <select
                                        className="form-select"
                                        value={viewingPartner ? viewingPartner.status : (editingPartner ? editingPartner.status : newPartner.status)}
                                        disabled={!!viewingPartner}
                                        onChange={e => editingPartner
                                            ? setEditingPartner({ ...editingPartner, status: e.target.value })
                                            : setNewPartner({ ...newPartner, status: e.target.value })
                                        }
                                    >
                                        <option value="Not Contacted">Not Contacted</option>
                                        <option value="Met">Met</option>
                                        <option value="Won">Won</option>
                                        <option value="New">New</option>
                                        <option value="Qualified">Qualified</option>
                                        <option value="Lost">Lost</option>
                                        <option value="Converted">Converted</option>
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                                <div className="form-group">
                                    <label>Level</label>
                                    <select
                                        className="form-select"
                                        value={viewingPartner ? (viewingPartner.level || viewingPartner.segment) : (editingPartner ? (editingPartner.level || editingPartner.segment) : newPartner.level)}
                                        disabled={!!viewingPartner}
                                        onChange={e => editingPartner
                                            ? setEditingPartner({ ...editingPartner, level: e.target.value })
                                            : setNewPartner({ ...newPartner, level: e.target.value })
                                        }
                                    >
                                        <option value="">-- Select Level --</option>
                                        <option value="Level - 1">Level 1</option>
                                        <option value="Level - 2">Level 2</option>
                                        <option value="Level - 3">Level 3</option>
                                        <option value="Level - 4">Level 4</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>City</label>
                                    <input
                                        type="text"
                                        placeholder="City name"
                                        value={viewingPartner ? viewingPartner.city : (editingPartner ? editingPartner.city : newPartner.city)}
                                        disabled={!!viewingPartner}
                                        onChange={e => editingPartner
                                            ? setEditingPartner({ ...editingPartner, city: e.target.value })
                                            : setNewPartner({ ...newPartner, city: e.target.value })
                                        }
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '1rem' }}>
                                <div className="form-group">
                                    <label>Customer Type</label>
                                    <select
                                        className="form-select"
                                        value={viewingPartner ? viewingPartner.customerType : (editingPartner ? editingPartner.customerType : newPartner.customerType)}
                                        disabled={!!viewingPartner}
                                        onChange={e => editingPartner
                                            ? setEditingPartner({ ...editingPartner, customerType: e.target.value })
                                            : setNewPartner({ ...newPartner, customerType: e.target.value })
                                        }
                                    >
                                        <option value="Fabricator">Fabricator</option>
                                        <option value="Contractor">Contractor</option>
                                        <option value="Dealer">Dealer</option>
                                        <option value="Floor Covering">Floor Covering</option>
                                        <option value="Designer">Designer</option>
                                        <option value="Builder">Builder</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Moda Display</label>
                                    <select
                                        className="form-select"
                                        value={viewingPartner ? viewingPartner.modaDisplay : (editingPartner ? editingPartner.modaDisplay : newPartner.modaDisplay)}
                                        disabled={!!viewingPartner}
                                        onChange={e => editingPartner
                                            ? setEditingPartner({ ...editingPartner, modaDisplay: e.target.value })
                                            : setNewPartner({ ...newPartner, modaDisplay: e.target.value })
                                        }
                                    >
                                        <option value="No">No</option>
                                        <option value="Yes">Yes</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Moda Binder</label>
                                    <input
                                        type="text"
                                        placeholder="Qty/Note"
                                        value={viewingPartner ? viewingPartner.modaBinder : (editingPartner ? editingPartner.modaBinder : newPartner.modaBinder)}
                                        disabled={!!viewingPartner}
                                        onChange={e => editingPartner
                                            ? setEditingPartner({ ...editingPartner, modaBinder: e.target.value })
                                            : setNewPartner({ ...newPartner, modaBinder: e.target.value })
                                        }
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Priority</label>
                                    <select
                                        className="form-select"
                                        value={viewingPartner ? viewingPartner.priority : (editingPartner ? editingPartner.priority : newPartner.priority)}
                                        disabled={!!viewingPartner}
                                        onChange={e => editingPartner
                                            ? setEditingPartner({ ...editingPartner, priority: e.target.value })
                                            : setNewPartner({ ...newPartner, priority: e.target.value })
                                        }
                                    >
                                        <option value="Low">Low</option>
                                        <option value="Medium">Medium</option>
                                        <option value="High">High</option>
                                    </select>
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Notes</label>
                                <textarea
                                    rows="4"
                                    placeholder="Add important notes or partner context..."
                                    value={viewingPartner ? viewingPartner.notes : (editingPartner ? editingPartner.notes : newPartner.notes)}
                                    disabled={!!viewingPartner}
                                    onChange={e => editingPartner
                                        ? setEditingPartner({ ...editingPartner, notes: e.target.value })
                                        : setNewPartner({ ...newPartner, notes: e.target.value })
                                    }
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            {viewingPartner ? (
                                <button className="btn-primary" onClick={handleCloseModal}>
                                    Close
                                </button>
                            ) : (
                                <>
                                    <button className="btn-secondary" onClick={handleCloseModal} disabled={isSaving}>
                                        Cancel
                                    </button>
                                    <button className="btn-primary" onClick={handleSavePartner} disabled={isSaving}>
                                        {isSaving ? <Loader size={20} className="animate-spin" /> : (editingPartner ? 'Save Changes' : 'Add Partner')}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PartnersSheet;
