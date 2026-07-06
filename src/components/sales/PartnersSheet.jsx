import React, { useState, useEffect } from 'react';
import {
    Search, Plus, Download, Edit2, Trash2, FileText, Menu,
    X, Mail, Phone, Eye, Filter, MoreVertical, Loader, Wrench, Users
} from 'lucide-react';
import Pagination from '../shared/Pagination';
import AddCustomerModal from './AddCustomerModal';
import { API_URL } from '../../config/api';
import * as XLSX from 'xlsx';
import { formatPhoneInput, formatPhoneForDisplay } from '../../utils/phoneUtils';
import './PartnersSheet.css';

// Tabs definition
const TABS = [
    { key: 'fabricators', label: 'Fabricators', type: 'Fabricator', icon: Wrench, color: '#d4af37' },
    { key: 'partners',    label: 'Partners',    type: '',           icon: Users,  color: '#63b3ed' },
];

const PartnersSheet = ({ onSelectCustomer, onToggleSidebar, isSidebarOpen, isPinned }) => {
    const [activeTab, setActiveTab] = useState('fabricators');

    const [partners, setPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingPartner, setEditingPartner] = useState(null);
    const [viewingPartner, setViewingPartner] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const [formErrors, setFormErrors] = useState({});
    const [showFilters, setShowFilters] = useState(false);

    // Filter State (not including type – that comes from the tab)
    const [filterLevel, setFilterLevel] = useState('');
    const [filterCity, setFilterCity] = useState('');

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [limit, setLimit] = useState(15);

    const handleRowsPerPageChange = (newLimit) => {
        setLimit(newLimit);
        setCurrentPage(1);
    };

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Derive the type filter from the active tab
    const activeTabDef = TABS.find(t => t.key === activeTab);
    // For the Partners tab we want everyone EXCEPT Fabricators
    const tabTypeFilter = activeTabDef?.type ?? '';

    const fetchPartners = async ({
        page = currentPage,
        search = debouncedSearch,
        level = filterLevel,
        city = filterCity,
        lim = limit,
        tab = activeTab,
    } = {}) => {
        setLoading(true);
        try {
            const url = new URL(`${API_URL}/api/partners`, window.location.origin);
            url.searchParams.append('page', page);
            url.searchParams.append('limit', lim);
            if (search) url.searchParams.append('search', search);
            if (level)  url.searchParams.append('level', level);
            if (city)   url.searchParams.append('city', city);

            if (tab === 'fabricators') {
                // Fabricators tab: only Fabricator type
                url.searchParams.append('type', 'Fabricator');
            } else {
                // Partners tab: server-side exclude Fabricators so pagination is correct
                url.searchParams.append('typeExclude', 'Fabricator');
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
            console.error('Error fetching partners:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPartners({ page: currentPage, search: debouncedSearch, level: filterLevel, city: filterCity, lim: limit, tab: activeTab });
    }, [currentPage, debouncedSearch, limit, filterLevel, filterCity, activeTab]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchTerm);
            setCurrentPage(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Reset page + search when tab changes
    const handleTabChange = (tabKey) => {
        setActiveTab(tabKey);
        setCurrentPage(1);
        setSearchTerm('');
        setDebouncedSearch('');
        setFilterLevel('');
        setFilterCity('');
        setShowFilters(false);
    };

    const clearFilters = () => {
        setFilterLevel('');
        setFilterCity('');
        setCurrentPage(1);
    };

    const activeFilterCount = [filterLevel, filterCity].filter(Boolean).length;

    const handleSavePartner = async (formData, closeModal) => {
        setIsSaving(true);
        try {
            const method = editingPartner ? 'PUT' : 'POST';
            const url = editingPartner
                ? `${API_URL}/api/partners/${editingPartner._id}`
                : `${API_URL}/api/partners`;

            const leadData = {
                ...formData,
                contactName: formData.customerName,
                name: formData.customerName,
                city: formData.address?.city || '',
                quickNote: formData.notes
            };

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(leadData),
                credentials: 'include'
            });

            if (response.ok) {
                await fetchPartners({ page: currentPage, search: debouncedSearch, level: filterLevel, city: filterCity, lim: limit, tab: activeTab });
                closeModal();
                setEditingPartner(null);
                setViewingPartner(null);
            } else {
                const errorData = await response.json();
                console.error('Server error saving lead:', errorData);
                alert(errorData.message || 'Failed to save customer');
            }
        } catch (error) {
            console.error('Error saving lead:', error);
            alert('Failed to save customer. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeletePartner = async (id) => {
        if (!window.confirm('Are you sure you want to delete this customer?')) return;
        try {
            const response = await fetch(`${API_URL}/api/partners/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                credentials: 'include'
            });
            if (response.ok) {
                fetchPartners({ page: currentPage, search: debouncedSearch, level: filterLevel, city: filterCity, lim: limit, tab: activeTab });
            } else {
                const errorData = await response.json();
                alert(errorData.message || 'Failed to delete customer');
            }
        } catch (error) {
            console.error('Error deleting customer:', error);
            alert('An error occurred while deleting the customer');
        }
    };

    const exportToExcel = async () => {
        try {
            setLoading(true);
            const url = new URL(`${API_URL}/api/partners`, window.location.origin);
            url.searchParams.append('limit', -1);
            if (debouncedSearch) url.searchParams.append('search', debouncedSearch);

            if (activeTab === 'fabricators') {
                url.searchParams.append('type', 'Fabricator');
            } else {
                url.searchParams.append('typeExclude', 'Fabricator');
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
                const sheetName = activeTab === 'fabricators' ? 'Fabricators' : 'Partners';
                XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
                XLSX.writeFile(workbook, `${sheetName}_List_${new Date().toISOString().split('T')[0]}.xlsx`);
            }
        } catch (error) {
            console.error('Error exporting:', error);
            alert('Failed to export data');
        } finally {
            setLoading(false);
        }
    };

    const sortedPartners = [...partners].sort((a, b) => {
        const aLow = a.status === 'Working with other sales Rep' || a.status === 'Not Interested';
        const bLow = b.status === 'Working with other sales Rep' || b.status === 'Not Interested';
        if (aLow && !bLow) return 1;
        if (!aLow && bLow) return -1;
        return 0;
    });

    const handleCloseModal = () => {
        setShowAddModal(false);
        setEditingPartner(null);
        setViewingPartner(null);
        setFormErrors({});
    };

    const isFabTab = activeTab === 'fabricators';

    return (
        <div className="partners-sheet-container">
            {/* ── Header ── */}
            <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    {(!isSidebarOpen || !isPinned || isMobile) && onToggleSidebar && (
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
                            placeholder={isFabTab ? 'Search fabricators...' : 'Search partners...'}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button
                        className={`filter-toggle-btn${activeFilterCount > 0 ? ' active' : ''}`}
                        onClick={() => setShowFilters(f => !f)}
                        title="Filter"
                    >
                        <Filter size={16} />
                        {!isMobile && 'Filter'}
                        {activeFilterCount > 0 && (
                            <span className="filter-badge">{activeFilterCount}</span>
                        )}
                    </button>
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

            {/* ── Tab Bar ── */}
            <div className="partners-tab-bar">
                {TABS.map(tab => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.key}
                            className={`partners-tab${activeTab === tab.key ? ' active' : ''}`}
                            onClick={() => handleTabChange(tab.key)}
                            style={{ '--tab-color': tab.color }}
                        >
                            <Icon size={15} />
                            {tab.label}
                            {activeTab === tab.key && !loading && (
                                <span className="tab-count">{totalCount}</span>
                            )}
                        </button>
                    );
                })}
                {/* Hint text */}
                <span className="tab-hint">
                    {isFabTab
                        ? '🔨 Pricing eligible — fabricators buy direct'
                        : '🤝 Contractors, Dealers, Designers & more'}
                </span>
            </div>

            {/* ── Filter Panel ── */}
            {showFilters && (
                <div className="filter-panel">
                    <div className="filter-panel-inner">
                        <div className="filter-group">
                            <label>Level</label>
                            <select
                                className="filter-select"
                                value={filterLevel}
                                onChange={e => { setFilterLevel(e.target.value); setCurrentPage(1); }}
                            >
                                <option value="">All Levels</option>
                                <option value="Level - 1">Level 1</option>
                                <option value="Level - 2">Level 2</option>
                                <option value="Level - 3">Level 3</option>
                                <option value="Level - 4">Level 4</option>
                            </select>
                        </div>
                        <div className="filter-group">
                            <label>City</label>
                            <input
                                type="text"
                                className="filter-input"
                                placeholder="e.g. Seattle"
                                value={filterCity}
                                onChange={e => { setFilterCity(e.target.value); setCurrentPage(1); }}
                            />
                        </div>
                        {activeFilterCount > 0 && (
                            <button className="clear-filters-btn" onClick={clearFilters}>
                                <X size={14} /> Clear All
                            </button>
                        )}
                    </div>
                    {activeFilterCount > 0 && (
                        <div className="filter-chips">
                            {filterLevel && (
                                <span className="filter-chip">
                                    {filterLevel}
                                    <button onClick={() => { setFilterLevel(''); setCurrentPage(1); }}><X size={11} /></button>
                                </span>
                            )}
                            {filterCity && (
                                <span className="filter-chip">
                                    {filterCity}
                                    <button onClick={() => { setFilterCity(''); setCurrentPage(1); }}><X size={11} /></button>
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Table ── */}
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
                                    {!isFabTab && <th>Type</th>}
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
                            <tr><td colSpan={isMobile ? 2 : (isFabTab ? 10 : 11)} style={{ textAlign: 'center', padding: '3rem' }}>
                                <div className="loader-container">
                                    <div className="loader-spinner"></div>
                                    <span>Loading {isFabTab ? 'fabricators' : 'partners'}...</span>
                                </div>
                            </td></tr>
                        ) : sortedPartners.length === 0 ? (
                            <tr><td colSpan={isMobile ? 2 : (isFabTab ? 10 : 11)} style={{ textAlign: 'center', padding: '3rem' }}>
                                <div className="empty-state">
                                    <FileText size={48} opacity={0.2} />
                                    <p>No {isFabTab ? 'fabricators' : 'partners'} found.</p>
                                </div>
                            </td></tr>
                        ) : sortedPartners.map(partner => (
                            <tr
                                key={partner._id}
                                className={
                                    partner.status === 'Working with other sales Rep' || partner.status === 'Not Interested'
                                        ? 'partner-row-low-priority'
                                        : ''
                                }
                            >
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
                                        {!isFabTab && (
                                            <td>
                                                <span className={`customer-type-badge ${(partner.customerType || 'fabricator').toLowerCase().replace(' ', '-')}`}>
                                                    {partner.customerType || 'Fabricator'}
                                                </span>
                                            </td>
                                        )}
                                        <td>{partner.city || partner.address?.city || '-'}</td>
                                        <td>{partner.level || partner.segment || '-'}</td>
                                        <td>
                                            <span className={`moda-badge ${partner.modaDisplay?.toLowerCase()}`}>
                                                {partner.modaDisplay === 'Yes' ? '✅ Yes' : '❌ No'}
                                            </span>
                                        </td>
                                        <td>
                                            {partner.modaBinder ? (
                                                <span className="moda-badge yes">{partner.modaBinder}</span>
                                            ) : '-'}
                                        </td>
                                        <td>
                                            <span className={`status-pill ${partner.status?.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                                                {partner.status}
                                            </span>
                                        </td>
                                    </>
                                )}
                                <td>
                                    <div className="table-actions">
                                        <button className="icon-btn edit" onClick={() => { setViewingPartner(partner); setShowAddModal(true); }} title="View">
                                            <Eye size={16} />
                                        </button>
                                        <button className="icon-btn edit" onClick={() => { setEditingPartner(partner); setShowAddModal(true); }} title="Edit">
                                            <Edit2 size={16} />
                                        </button>
                                        <button className="icon-btn delete" onClick={() => handleDeletePartner(partner._id)} title="Delete">
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
                rowsPerPage={limit}
                onRowsPerPageChange={handleRowsPerPageChange}
                rowsPerPageOptions={[15, 25, 50]}
            />

            <AddCustomerModal
                show={showAddModal}
                onClose={handleCloseModal}
                onSave={handleSavePartner}
                isSaving={isSaving}
                editingCustomer={editingPartner}
                viewingCustomer={viewingPartner}
            />
        </div>
    );
};

export default PartnersSheet;
