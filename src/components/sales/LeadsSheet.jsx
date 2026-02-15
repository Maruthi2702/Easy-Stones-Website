import React, { useState, useEffect } from 'react';
import {
    Search, Plus, Download, Edit2, Trash2, FileText,
    ChevronLeft, ChevronRight, X, Mail, Phone, Eye,
    Filter, MoreVertical, Loader
} from 'lucide-react';
import { API_URL } from '../../config/api';
import * as XLSX from 'xlsx';

const LeadsSheet = () => {
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingLead, setEditingLead] = useState(null);
    const [viewingLead, setViewingLead] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

    const [newLead, setNewLead] = useState({
        name: '',
        company: '',
        email: '',
        phone: '',
        notes: '',
        status: 'New'
    });

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);
        fetchLeads();
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const fetchLeads = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/api/leads`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                setLeads(data);
            }
        } catch (error) {
            console.error('Error fetching leads:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveLead = async (e) => {
        if (e) e.preventDefault();
        setIsSaving(true);
        try {
            const method = editingLead ? 'PUT' : 'POST';
            const url = editingLead
                ? `${API_URL}/api/leads/${editingLead._id}`
                : `${API_URL}/api/leads`;

            const leadData = editingLead || newLead;

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(leadData),
                credentials: 'include'
            });

            if (response.ok) {
                await fetchLeads();
                setShowAddModal(false);
                setEditingLead(null);
                setNewLead({
                    name: '',
                    company: '',
                    email: '',
                    phone: '',
                    notes: '',
                    status: 'New'
                });
            }
        } catch (error) {
            console.error('Error saving lead:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteLead = async (id) => {
        if (!window.confirm('Are you sure you want to delete this lead?')) return;
        try {
            const response = await fetch(`${API_URL}/api/leads/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                credentials: 'include'
            });
            if (response.ok) {
                setLeads(leads.filter(l => l._id !== id));
            }
        } catch (error) {
            console.error('Error deleting lead:', error);
        }
    };

    const exportToExcel = () => {
        const worksheet = XLSX.utils.json_to_sheet(leads.map(l => ({
            Name: l.name,
            Company: l.company,
            Email: l.email,
            Phone: l.phone,
            Status: l.status,
            Notes: l.notes,
            Created: new Date(l.createdAt).toLocaleDateString()
        })));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");
        XLSX.writeFile(workbook, `Leads_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const filteredLeads = leads.filter(lead =>
        (lead.name?.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (lead.company?.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (lead.notes?.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const handleCloseModal = () => {
        setShowAddModal(false);
        setEditingLead(null);
        setViewingLead(null);
    };

    return (
        <div className="leads-sheet-container">
            <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    <h2>Leads Management</h2>
                    {!loading && <span className="customer-count">{leads.length}</span>}
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
                            placeholder="Search leads..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button className="lead-add-btn pulse" onClick={() => setShowAddModal(true)}>
                        <Plus size={18} />
                        Add Lead
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
                                    <th>Status</th>
                                    <th>Notes</th>
                                </>
                            )}
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={isMobile ? 2 : 5} style={{ textAlign: 'center', padding: '3rem' }}>
                                <div className="loader-container">
                                    <div className="loader-spinner"></div>
                                    <span>Loading leads...</span>
                                </div>
                            </td></tr>
                        ) : filteredLeads.length === 0 ? (
                            <tr><td colSpan={isMobile ? 2 : 5} style={{ textAlign: 'center', padding: '3rem' }}>
                                <div className="empty-state">
                                    <FileText size={48} opacity={0.2} />
                                    <p>No leads found. Start by adding your first lead!</p>
                                </div>
                            </td></tr>
                        ) : filteredLeads.map(lead => (
                            <tr key={lead._id}>
                                <td><strong>{lead.company || '-'}</strong></td>
                                {!isMobile && (
                                    <>
                                        <td>{lead.name}</td>
                                        <td>
                                            <span className={`status-pill ${lead.status.toLowerCase()}`}>
                                                {lead.status}
                                            </span>
                                        </td>
                                        <td className="notes-cell" title={lead.notes}>{lead.notes || '-'}</td>
                                    </>
                                )}
                                <td>
                                    <div className="table-actions">
                                        <button className="icon-btn edit" onClick={() => { setViewingLead(lead); setShowAddModal(true); }} title="View Lead">
                                            <Eye size={16} />
                                        </button>
                                        <button className="icon-btn edit" onClick={() => { setEditingLead(lead); setShowAddModal(true); }} title="Edit Lead">
                                            <Edit2 size={16} />
                                        </button>
                                        <button className="icon-btn delete" onClick={() => handleDeleteLead(lead._id)} title="Delete Lead">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {showAddModal && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{viewingLead ? 'View Lead' : (editingLead ? 'Edit Lead' : 'Add New Lead')}</h2>
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
                                    value={viewingLead ? viewingLead.company : (editingLead ? editingLead.company : newLead.company)}
                                    disabled={!!viewingLead}
                                    onChange={e => editingLead
                                        ? setEditingLead({ ...editingLead, company: e.target.value })
                                        : setNewLead({ ...newLead, company: e.target.value })
                                    }
                                />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                                <div className="form-group">
                                    <label>Contact Name</label>
                                    <input
                                        type="text"
                                        placeholder="Lead contact name"
                                        value={viewingLead ? viewingLead.name : (editingLead ? editingLead.name : newLead.name)}
                                        disabled={!!viewingLead}
                                        onChange={e => editingLead
                                            ? setEditingLead({ ...editingLead, name: e.target.value })
                                            : setNewLead({ ...newLead, name: e.target.value })
                                        }
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        placeholder="email@example.com"
                                        value={viewingLead ? viewingLead.email : (editingLead ? editingLead.email : newLead.email)}
                                        disabled={!!viewingLead}
                                        onChange={e => editingLead
                                            ? setEditingLead({ ...editingLead, email: e.target.value })
                                            : setNewLead({ ...newLead, email: e.target.value })
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
                                        value={viewingLead ? viewingLead.phone : (editingLead ? editingLead.phone : newLead.phone)}
                                        disabled={!!viewingLead}
                                        onChange={e => editingLead
                                            ? setEditingLead({ ...editingLead, phone: e.target.value })
                                            : setNewLead({ ...newLead, phone: e.target.value })
                                        }
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Status</label>
                                    <select
                                        className="form-select"
                                        value={viewingLead ? viewingLead.status : (editingLead ? editingLead.status : newLead.status)}
                                        disabled={!!viewingLead}
                                        onChange={e => editingLead
                                            ? setEditingLead({ ...editingLead, status: e.target.value })
                                            : setNewLead({ ...newLead, status: e.target.value })
                                        }
                                    >
                                        <option value="New">New</option>
                                        <option value="Contacted">Contacted</option>
                                        <option value="Qualified">Qualified</option>
                                        <option value="Lost">Lost</option>
                                        <option value="Converted">Converted</option>
                                    </select>
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Notes</label>
                                <textarea
                                    rows="4"
                                    placeholder="Add important notes or lead context..."
                                    value={viewingLead ? viewingLead.notes : (editingLead ? editingLead.notes : newLead.notes)}
                                    disabled={!!viewingLead}
                                    onChange={e => editingLead
                                        ? setEditingLead({ ...editingLead, notes: e.target.value })
                                        : setNewLead({ ...newLead, notes: e.target.value })
                                    }
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            {viewingLead ? (
                                <button className="btn-primary" onClick={handleCloseModal}>
                                    Close
                                </button>
                            ) : (
                                <>
                                    <button className="btn-secondary" onClick={handleCloseModal} disabled={isSaving}>
                                        Cancel
                                    </button>
                                    <button className="btn-primary" onClick={handleSaveLead} disabled={isSaving}>
                                        {isSaving ? <Loader size={20} className="animate-spin" /> : (editingLead ? 'Save Changes' : 'Add Lead')}
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

export default LeadsSheet;
