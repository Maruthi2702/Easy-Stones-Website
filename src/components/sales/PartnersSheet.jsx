import React, { useState, useEffect } from 'react';
import {
    Search, Plus, Download, Edit2, Trash2, FileText, Menu,
    X, Mail, Phone, Eye, Filter, MoreVertical, Loader, Wrench, Users, PhoneCall, MapPin
} from 'lucide-react';
import Pagination from '../shared/Pagination';
import SidebarToggleButton from '../shared/SidebarToggleButton';
import AddCustomerModal from './AddCustomerModal';
import { useAuth } from '../../context/AuthContext';
import { toSalesRepList } from '../../utils/salesReps';
import { API_URL } from '../../config/api';
import * as XLSX from 'xlsx';
import { formatPhoneInput, formatPhoneForDisplay } from '../../utils/phoneUtils';
import './PartnersSheet.css';

// Helper for initials badge
const getCompanyInitials = (name) => {
    if (!name) return 'ES';
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
};

// Branch chips are tinted per branch so a mixed list is scannable without
// reading a word. Branches added later get no modifier and fall back to the
// neutral chip, which is why this slugifies rather than looking up a fixed map.
const locationClass = (name) =>
    String(name || 'Seattle').toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Filtering on a rep is only half the question — "who has nobody yet" is the
// other half, and it is the list someone works through to clear the backlog.
const UNASSIGNED = 'unassigned';

// Tabs definition
const TABS = [
    { key: 'fabricators', label: 'Fabricators', type: 'Fabricator', icon: Wrench, color: '#d4af37' },
    { key: 'partners',    label: 'Partners',    type: '',           icon: Users,  color: '#63b3ed' },
];

// Custom MultiSelect Dropdown component.
// Options are plain strings for the filters whose value is the label — Level,
// Type, City, Status — or { value, label } where the two differ, which is what
// the Sales Rep filter needs: it selects by user id but has to read as a name.
const MultiSelect = ({ options, selectedValues = [], onChange, placeholder, showSearch = false }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [searchVal, setSearchVal] = React.useState('');
    const containerRef = React.useRef(null);

    const normalized = options.map(opt =>
        typeof opt === 'object' && opt !== null
            ? { value: opt.value, label: opt.label ?? opt.value }
            : { value: opt, label: String(opt) }
    );

    React.useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
                setSearchVal('');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleToggle = (opt) => {
        const next = selectedValues.includes(opt)
            ? selectedValues.filter(v => v !== opt)
            : [...selectedValues, opt];
        onChange(next);
    };

    const labelOf = (value) =>
        normalized.find(o => o.value === value)?.label ?? String(value);

    const displayText = selectedValues.length === 0
        ? placeholder
        : selectedValues.length <= 2
            ? selectedValues.map(labelOf).join(', ')
            : `${selectedValues.length} selected`;

    const filteredOptions = normalized.filter(opt =>
        opt.label.toLowerCase().includes(searchVal.toLowerCase())
    );

    return (
        <div className="spag-multiselect" ref={containerRef}>
            <button
                type="button"
                className={`spag-multiselect-trigger ${selectedValues.length > 0 ? 'active' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="trigger-text">{displayText}</span>
                <span className="trigger-arrow">▼</span>
            </button>

            {isOpen && (
                <div className="spag-multiselect-dropdown">
                    {showSearch && (
                        <div className="spag-multiselect-search-container">
                            <input
                                type="text"
                                className="spag-multiselect-search-input"
                                placeholder="Search..."
                                value={searchVal}
                                onChange={(e) => setSearchVal(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                            />
                        </div>
                    )}
                    <div className="spag-multiselect-items-container">
                        {filteredOptions.length === 0 ? (
                            <div className="spag-multiselect-empty">No results found</div>
                        ) : (
                            filteredOptions.map((opt) => (
                                <label key={opt.value} className="spag-multiselect-item">
                                    <input
                                        type="checkbox"
                                        checked={selectedValues.includes(opt.value)}
                                        onChange={() => handleToggle(opt.value)}
                                    />
                                    <span>{opt.label}</span>
                                </label>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// Global in-memory cache to prevent re-fetching on tab switches & re-mounts (Top-level module scope)
const globalPartnersCache = {};

const PartnersSheet = ({ onSelectCustomer, onToggleSidebar, isSidebarOpen, isPinned, customerRefreshTrigger }) => {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('fabricators');

    const [partners, setPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingPartner, setEditingPartner] = useState(null);
    const [viewingPartner, setViewingPartner] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);
    const [formErrors, setFormErrors] = useState({});
    const [showFilters, setShowFilters] = useState(false);

    // Multi-Select Filter States
    const [filterLevels, setFilterLevels] = useState([]);
    const [filterTypes, setFilterTypes] = useState([]);
    const [filterCities, setFilterCities] = useState([]);
    const [filterStatuses, setFilterStatuses] = useState([]);
    const [filterSalesReps, setFilterSalesReps] = useState([]);
    const [filterLocations, setFilterLocations] = useState([]);
    const [uniqueCities, setUniqueCities] = useState([]);

    // The staff who can own an account, and the branches an account can sit at.
    // Both feed the filter panel and the add/edit modal, so they are fetched
    // once here rather than by each consumer.
    const [salesReps, setSalesReps] = useState([]);
    const [locations, setLocations] = useState([]);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return parseInt(params.get('p')) || 1;
    });
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [limit, setLimit] = useState(15);

    useEffect(() => {
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('p', currentPage);
        window.history.replaceState({}, '', newUrl);
    }, [currentPage]);

    useEffect(() => {
        const handlePopState = () => {
            const params = new URLSearchParams(window.location.search);
            const pageParam = parseInt(params.get('p')) || 1;
            setCurrentPage(pageParam);
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    // Sorting State
    const [sortBy, setSortBy] = useState('level');
    const [sortOrder, setSortOrder] = useState('asc');

    const handleSort = (field) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortOrder('asc');
        }
        setCurrentPage(1);
    };

    const handleRowsPerPageChange = (newLimit) => {
        setLimit(newLimit);
        setCurrentPage(1);
    };

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 1024);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Load all unique cities on mount for the filter checklist
    useEffect(() => {
        const fetchCities = async () => {
            try {
                const res = await fetch(`${API_URL}/api/partners/cities`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (res.ok) {
                    const cities = await res.json();
                    setUniqueCities(cities || []);
                }
            } catch (err) {
                console.error('Error fetching unique cities:', err);
            }
        };
        fetchCities();
    }, []);

    // Load the owner and branch pickers once on mount. Ordered by branch and
    // then by name so the rep dropdown reads as branch-grouped rather than as
    // one flat list of everyone in the company.
    useEffect(() => {
        const authHeaders = () => {
            const token = localStorage.getItem('token');
            return token ? { 'Authorization': `Bearer ${token}` } : {};
        };

        const fetchSalesReps = async () => {
            try {
                const res = await fetch(`${API_URL}/api/salesreps`, {
                    headers: authHeaders(),
                    credentials: 'include'
                });
                if (!res.ok) return;
                setSalesReps(toSalesRepList(await res.json()));
            } catch (err) {
                console.error('Error fetching sales reps:', err);
            }
        };

        const fetchLocations = async () => {
            try {
                const res = await fetch(`${API_URL}/api/admin/locations`, {
                    headers: authHeaders(),
                    credentials: 'include'
                });
                if (!res.ok) return;
                const data = await res.json();
                setLocations((data || []).map(l => l.name).filter(Boolean));
            } catch (err) {
                console.error('Error fetching locations:', err);
            }
        };

        fetchSalesReps();
        fetchLocations();
    }, []);

    const activeTabDef = TABS.find(t => t.key === activeTab);
    // For the Partners tab we want everyone EXCEPT Fabricators
    const fetchPartners = async ({
        page = currentPage,
        search = debouncedSearch,
        level = filterLevels.join(','),
        type = filterTypes.join(','),
        city = filterCities.join(','),
        status = filterStatuses.join(','),
        salesRep = filterSalesReps.join(','),
        location = filterLocations.join(','),
        lim = limit,
        tab = activeTab,
        sortB = sortBy,
        sortO = sortOrder,
        skipCache = false
    } = {}) => {
        const cacheKey = JSON.stringify({ page, search, level, type, city, status, salesRep, location, lim, tab, sortB, sortO });

        // Serve instantly from cache if available (0ms load!)
        if (globalPartnersCache[cacheKey]) {
            const cached = globalPartnersCache[cacheKey];
            setPartners(cached.partners || []);
            setTotalPages(cached.totalPages || 1);
            setTotalCount(cached.totalCount || 0);
            setLoading(false);
            if (!skipCache) return;
        } else {
            setLoading(true);
        }

        try {
            const url = new URL(`${API_URL}/api/partners`, window.location.origin);
            url.searchParams.append('page', page);
            url.searchParams.append('limit', lim);
            url.searchParams.append('sortBy', sortB);
            url.searchParams.append('sortOrder', sortO);
            if (search) url.searchParams.append('search', search);
            if (level)  url.searchParams.append('level', level);
            if (type)   url.searchParams.append('type', type);
            if (city)   url.searchParams.append('city', city);
            if (status) url.searchParams.append('status', status);
            if (salesRep) url.searchParams.append('salesRep', salesRep);
            if (location) url.searchParams.append('location', location);

            // If search or any filter is active, fetch across all customers (Fabricators + Partners) globally.
            // Otherwise, filter by tab type.
            const isFilterActive = search || level || type || city || status || salesRep || location;
            if (!isFilterActive) {
                if (tab === 'fabricators') {
                    // Fabricators tab: only Fabricator type
                    url.searchParams.append('type', 'Fabricator');
                } else {
                    // Partners tab: server-side exclude Fabricators so pagination is correct
                    url.searchParams.append('typeExclude', 'Fabricator');
                }
            }

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                globalPartnersCache[cacheKey] = data; // Update in-memory cache
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
        fetchPartners({
            page: currentPage,
            search: debouncedSearch,
            level: filterLevels.join(','),
            type: filterTypes.join(','),
            city: filterCities.join(','),
            status: filterStatuses.join(','),
            salesRep: filterSalesReps.join(','),
            location: filterLocations.join(','),
            lim: limit,
            tab: activeTab,
            sortB: sortBy,
            sortO: sortOrder
        });
    }, [currentPage, debouncedSearch, limit, filterLevels, filterTypes, filterCities, filterStatuses, filterSalesReps, filterLocations, activeTab, sortBy, sortOrder, customerRefreshTrigger]);

    useEffect(() => {
        if (searchTerm === debouncedSearch) {
            return;
        }
        const timer = setTimeout(() => {
            setDebouncedSearch(searchTerm);
            setCurrentPage(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm, debouncedSearch]);

    // Reset page + search when tab changes
    const handleTabChange = (tabKey) => {
        setActiveTab(tabKey);
        setCurrentPage(1);
        setSearchTerm('');
        setDebouncedSearch('');
        setFilterLevels([]);
        setFilterTypes([]);
        setFilterCities([]);
        setFilterStatuses([]);
        setFilterSalesReps([]);
        setFilterLocations([]);
        setSortBy('level');
        setSortOrder('asc');
        setShowFilters(false);
    };

    const clearFilters = () => {
        setFilterLevels([]);
        setFilterTypes([]);
        setFilterCities([]);
        setFilterStatuses([]);
        setFilterSalesReps([]);
        setFilterLocations([]);
        setCurrentPage(1);
    };

    const activeFilterCount = filterLevels.length + filterTypes.length + filterCities.length
        + filterStatuses.length + filterSalesReps.length + filterLocations.length;

    // The rep filter travels as ids but has to read as names, so the chips and
    // the multi-select label are mapped back through the directory.
    const repLabel = (id) =>
        id === UNASSIGNED ? 'Unassigned' : (salesReps.find(r => r._id === id)?.name || 'Unknown');

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
                await fetchPartners({
                    page: currentPage,
                    search: debouncedSearch,
                    level: filterLevels.join(','),
                    type: filterTypes.join(','),
                    city: filterCities.join(','),
                    status: filterStatuses.join(','),
                    lim: limit,
                    tab: activeTab
                });
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
                fetchPartners({
                    page: currentPage,
                    search: debouncedSearch,
                    level: filterLevels.join(','),
                    type: filterTypes.join(','),
                    city: filterCities.join(','),
                    status: filterStatuses.join(','),
                    lim: limit,
                    tab: activeTab
                });
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
            url.searchParams.append('sortBy', sortBy);
            url.searchParams.append('sortOrder', sortOrder);
            
            const levelParam = filterLevels.join(',');
            const typeParam = filterTypes.join(',');
            const cityParam = filterCities.join(',');
            const statusParam = filterStatuses.join(',');
            const repParam = filterSalesReps.join(',');
            const locationParam = filterLocations.join(',');

            if (debouncedSearch) url.searchParams.append('search', debouncedSearch);
            if (levelParam)     url.searchParams.append('level', levelParam);
            if (typeParam)      url.searchParams.append('type', typeParam);
            if (cityParam)      url.searchParams.append('city', cityParam);
            if (statusParam)    url.searchParams.append('status', statusParam);
            if (repParam)       url.searchParams.append('salesRep', repParam);
            if (locationParam)  url.searchParams.append('location', locationParam);

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
                    'Sales Rep': l.salesRepName || 'Unassigned',
                    Location: l.location || 'Seattle',
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

    const emailAllContacts = async () => {
        try {
            const url = new URL(`${API_URL}/api/partners`, window.location.origin);
            url.searchParams.append('limit', -1);
            url.searchParams.append('sortBy', sortBy);
            url.searchParams.append('sortOrder', sortOrder);
            
            const levelParam = filterLevels.join(',');
            const typeParam = filterTypes.join(',');
            const cityParam = filterCities.join(',');
            const statusParam = filterStatuses.join(',');
            const repParam = filterSalesReps.join(',');
            const locationParam = filterLocations.join(',');
            
            if (debouncedSearch) url.searchParams.append('search', debouncedSearch);
            if (levelParam)     url.searchParams.append('level', levelParam);
            if (typeParam)      url.searchParams.append('type', typeParam);
            if (cityParam)      url.searchParams.append('city', cityParam);
            if (statusParam)    url.searchParams.append('status', statusParam);
            if (repParam)       url.searchParams.append('salesRep', repParam);
            if (locationParam)  url.searchParams.append('location', locationParam);

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
                
                // Filter eligible contacts:
                // 1. Exclude working with another sales rep
                // 2. Exclude opted-out of marketing
                const filteredPartners = allPartners.filter(p => 
                    p.status !== 'Different Sales Person' && 
                    p.receiveMarketing !== false
                );
                
                // Map to marketingEmail (fallback to normal email if blank)
                const emails = filteredPartners
                    .map(p => (p.marketingEmail && p.marketingEmail.trim() !== '' ? p.marketingEmail.trim() : p.email))
                    .filter(Boolean);
                
                if (emails.length === 0) {
                    alert('No eligible marketing email addresses found for the current filters.');
                    return;
                }
                
                // Format with semicolons for easy pasting into Outlook
                const emailList = emails.join('; ');
                await navigator.clipboard.writeText(emailList);
                
                alert(`Successfully copied ${emails.length} marketing email addresses to your clipboard!\n\nYou can now paste them directly into the To/Bcc field in Outlook.`);
            }
        } catch (error) {
            console.error('Error copying emails:', error);
            alert('Failed to copy emails');
        }
    };

    const sortedPartners = [...partners].sort((a, b) => {
        const aLow = a.status === 'Different Sales Person' || a.status === 'Not Interested';
        const bLow = b.status === 'Different Sales Person' || b.status === 'Not Interested';
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
    const showTypeColumn = !isFabTab || !!(debouncedSearch || filterLevels.length || filterTypes.length || filterCities.length || filterStatuses.length);

    const renderSortHeader = (label, field) => {
        const isSorted = sortBy === field;
        return (
            <th 
                onClick={() => handleSort(field)} 
                className={`sortable-header ${isSorted ? 'sorted' : ''}`}
                style={{ cursor: 'pointer', userSelect: 'none' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>{label}</span>
                    {isSorted ? (
                        <span className="sort-arrow" style={{ color: 'var(--gold-color, #d4af37)' }}>
                            {sortOrder === 'asc' ? '▲' : '▼'}
                        </span>
                    ) : (
                        <span className="sort-arrow-placeholder" style={{ opacity: 0.2 }}>▲</span>
                    )}
                </div>
            </th>
        );
    };

    return (
        <div className="partners-sheet-container">
            {/* ── Header ── */}
            <div className="section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    {(!isSidebarOpen || !isPinned || isMobile) && onToggleSidebar && (
                        <SidebarToggleButton isOpen={isSidebarOpen} onClick={onToggleSidebar} />
                    )}
                    <h2>Customer List</h2>
                    {!loading && <span className="customer-count">{totalCount}</span>}
                </div>
                <div className="table-controls">
                    <div className="table-search">
                        <Search className="search-icon" size={18} />
                        <input
                            type="text"
                            placeholder={isFabTab ? 'Search fabricators...' : 'Search partners...'}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="sheet-actions-group">
                        <button className="sheet-action-btn" onClick={exportToExcel} title="Export to Excel">
                            <Download size={18} />
                        </button>
                        <button className="sheet-action-btn" onClick={emailAllContacts} title="Copy all customer emails matching filters to clipboard">
                            <Mail size={18} />
                        </button>
                        <button
                            className={`sheet-action-btn filter-toggle-btn${activeFilterCount > 0 ? ' active' : ''}`}
                            onClick={() => setShowFilters(f => !f)}
                            title="Toggle Filters"
                        >
                            <Filter size={16} />
                            {activeFilterCount > 0 && (
                                <span className="filter-badge">{activeFilterCount}</span>
                            )}
                        </button>
                    </div>
                    <button className="partner-add-btn pulse" onClick={() => {
                        setEditingPartner(null);
                        setViewingPartner(null);
                        setShowAddModal(true);
                    }}>
                        <Plus size={18} />
                        <span>Add Customer</span>
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
                            <MultiSelect
                                options={['Level - 1', 'Level - 2', 'Level - 3', 'Level - 4']}
                                selectedValues={filterLevels}
                                onChange={(vals) => { setFilterLevels(vals); setCurrentPage(1); }}
                                placeholder="All Levels"
                            />
                        </div>
                        <div className="filter-group">
                            <label>Type</label>
                            <MultiSelect
                                options={['Fabricator', 'Contractor', 'Dealer', 'Floor Covering', 'Designer', 'Builder']}
                                selectedValues={filterTypes}
                                onChange={(vals) => { setFilterTypes(vals); setCurrentPage(1); }}
                                placeholder="All Types"
                            />
                        </div>
                        <div className="filter-group">
                            <label>City</label>
                            <MultiSelect
                                options={uniqueCities}
                                selectedValues={filterCities}
                                onChange={(vals) => { setFilterCities(vals); setCurrentPage(1); }}
                                placeholder="All Cities"
                                showSearch={true}
                            />
                        </div>
                        <div className="filter-group">
                            <label>Sales Rep</label>
                            <MultiSelect
                                options={[
                                    { value: UNASSIGNED, label: 'Unassigned' },
                                    ...salesReps.map(rep => ({ value: rep._id, label: rep.name }))
                                ]}
                                selectedValues={filterSalesReps}
                                onChange={(vals) => { setFilterSalesReps(vals); setCurrentPage(1); }}
                                placeholder="All Sales Reps"
                                showSearch={true}
                            />
                        </div>
                        <div className="filter-group">
                            <label>Location</label>
                            <MultiSelect
                                options={locations}
                                selectedValues={filterLocations}
                                onChange={(vals) => { setFilterLocations(vals); setCurrentPage(1); }}
                                placeholder="All Locations"
                            />
                        </div>
                        <div className="filter-group">
                            <label>Status</label>
                            <MultiSelect
                                options={[
                                    'New Lead',
                                    'Trying to Onboard',
                                    'Contacted / In Discussion',
                                    'Onboarded',
                                    'Different Sales Person',
                                    'Not Interested',
                                    'Inactive'
                                ]}
                                selectedValues={filterStatuses}
                                onChange={(vals) => { setFilterStatuses(vals); setCurrentPage(1); }}
                                placeholder="All Statuses"
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
                            {filterLevels.map(lvl => (
                                <span key={lvl} className="filter-chip">
                                    {lvl}
                                    <button onClick={() => { setFilterLevels(filterLevels.filter(x => x !== lvl)); setCurrentPage(1); }}><X size={11} /></button>
                                </span>
                            ))}
                            {filterTypes.map(t => (
                                <span key={t} className="filter-chip">
                                    {t}
                                    <button onClick={() => { setFilterTypes(filterTypes.filter(x => x !== t)); setCurrentPage(1); }}><X size={11} /></button>
                                </span>
                            ))}
                            {filterCities.map(c => (
                                <span key={c} className="filter-chip">
                                    {c}
                                    <button onClick={() => { setFilterCities(filterCities.filter(x => x !== c)); setCurrentPage(1); }}><X size={11} /></button>
                                </span>
                            ))}
                            {filterSalesReps.map(id => (
                                <span key={id} className="filter-chip">
                                    {repLabel(id)}
                                    <button onClick={() => { setFilterSalesReps(filterSalesReps.filter(x => x !== id)); setCurrentPage(1); }}><X size={11} /></button>
                                </span>
                            ))}
                            {filterLocations.map(loc => (
                                <span key={loc} className="filter-chip">
                                    {loc}
                                    <button onClick={() => { setFilterLocations(filterLocations.filter(x => x !== loc)); setCurrentPage(1); }}><X size={11} /></button>
                                </span>
                            ))}
                            {filterStatuses.map(s => (
                                <span key={s} className="filter-chip">
                                    {s}
                                    <button onClick={() => { setFilterStatuses(filterStatuses.filter(x => x !== s)); setCurrentPage(1); }}><X size={11} /></button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Table or Cards Layout ── */}
            {isMobile ? (
                loading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem', gap: '1rem' }}>
                        <div className="loader-spinner"></div>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading customers...</span>
                    </div>
                ) : sortedPartners.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)' }}>
                        <FileText size={48} opacity={0.2} style={{ margin: '0 auto 1rem' }} />
                        <p>No {isFabTab ? 'fabricators' : 'partners'} found.</p>
                    </div>
                ) : (
                    <div className="mobile-customer-cards">
                        {sortedPartners.map(partner => {
                            const companyName = partner.company || partner.name || partner.contactName || 'Customer';
                            const initials = getCompanyInitials(companyName);
                            const contactName = (partner.name || partner.contactName) && (partner.name || partner.contactName) !== companyName ? (partner.name || partner.contactName) : null;
                            const phone = partner.phone;
                            const email = partner.email;
                            const city = partner.city || partner.address?.city;

                            return (
                                <div 
                                    key={partner._id} 
                                    className={`mobile-customer-card concept-b ${
                                        partner.status === 'Different Sales Person' || partner.status === 'Not Interested'
                                            ? 'low-priority'
                                            : ''
                                    }`} 
                                    onClick={() => onSelectCustomer && onSelectCustomer(partner)}
                                >
                                    {/* Top Title & Status Row (Non-truncating multi-line company name) */}
                                    <div className="mcc-top-row">
                                        <h3 className="mcc-company-name-full">{companyName}</h3>
                                        <span className={`status-badge-pill ${partner.status?.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                                            {partner.status || 'Active'}
                                        </span>
                                    </div>

                                    {/* Meta Pills (Level, Segment, Location) */}
                                    <div className="mcc-meta-pills">
                                        <span className="card-meta-badge level-badge">
                                            {partner.level || partner.segment || 'Level - 1'}
                                        </span>
                                        {showTypeColumn && (
                                            <span className={`card-meta-badge type-badge ${(partner.customerType || 'fabricator').toLowerCase().replace(' ', '-')}`}>
                                                {partner.customerType || 'Fabricator'}
                                            </span>
                                        )}
                                        {city && (
                                            <span className="mcc-location-pill">
                                                <MapPin size={11} /> {city}
                                            </span>
                                        )}
                                        <span className={`card-meta-badge location-badge ${locationClass(partner.location)}`}>
                                            {partner.location || 'Seattle'}
                                        </span>
                                    </div>

                                    {/* Contact & Phone 2-Row Section */}
                                    <div className="mcc-contact-section">
                                        <div className="mcc-contact-row">
                                            <span className="mcc-contact-label">Contact:</span>
                                            <span className="mcc-contact-val">{contactName || partner.name || partner.contactName || 'N/A'}</span>
                                        </div>
                                        <div className="mcc-contact-row">
                                            <span className="mcc-contact-label">Phone:</span>
                                            {phone ? (
                                                <a 
                                                    href={`tel:${phone}`} 
                                                    className="mcc-contact-val mcc-phone-link"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    {formatPhoneForDisplay(phone)}
                                                </a>
                                            ) : (
                                                <span className="mcc-contact-val text-muted">N/A</span>
                                            )}
                                        </div>
                                        <div className="mcc-contact-row">
                                            <span className="mcc-contact-label">Sales Rep:</span>
                                            <span className={`mcc-contact-val${partner.salesRepName ? '' : ' text-muted'}`}>
                                                {partner.salesRepName || 'Unassigned'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Action Bar with Direct Call, Email, View details & Tool Icons */}
                                    <div className="mcc-action-bar" onClick={(e) => e.stopPropagation()}>
                                        <div className="mcc-direct-actions">
                                            {phone && (
                                                <a 
                                                    href={`tel:${phone}`} 
                                                    className="mcc-quick-btn call"
                                                    title={`Call ${companyName}`}
                                                >
                                                    <PhoneCall size={13} />
                                                    <span>Call</span>
                                                </a>
                                            )}
                                            {email && (
                                                <a 
                                                    href={`mailto:${email}`} 
                                                    className="mcc-quick-btn email"
                                                    title={`Email ${companyName}`}
                                                >
                                                    <Mail size={13} />
                                                    <span>Email</span>
                                                </a>
                                            )}
                                        </div>
                                        <div className="mcc-tool-actions">
                                            <button 
                                                className="mcc-btn-view"
                                                onClick={() => { setViewingPartner(partner); setShowAddModal(true); }}
                                            >
                                                <Eye size={14} />
                                                <span>View</span>
                                            </button>
                                            <button 
                                                className="mcc-btn-icon edit"
                                                onClick={() => { setEditingPartner(partner); setShowAddModal(true); }}
                                                title="Edit"
                                            >
                                                <Edit2 size={13} />
                                            </button>
                                            <button 
                                                className="mcc-btn-icon delete"
                                                onClick={() => handleDeletePartner(partner._id)}
                                                title="Delete"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )
            ) : (
                <div className="dashboard-table-wrapper">
                    <table className="dashboard-table">
                        <thead>
                            <tr>
                                {renderSortHeader('Company', 'company')}
                                {!isMobile && (
                                    <>
                                        <th>Contact Name</th>
                                        <th>Email</th>
                                        <th>Phone</th>
                                        {showTypeColumn && <th>Type</th>}
                                        {renderSortHeader('City', 'city')}
                                        {renderSortHeader('Sales Rep', 'salesRep')}
                                        {renderSortHeader('Location', 'location')}
                                        {renderSortHeader('Level', 'level')}
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
                                <tr><td colSpan={isMobile ? 2 : (showTypeColumn ? 13 : 12)} style={{ textAlign: 'center', padding: '3rem' }}>
                                    <div className="loader-container">
                                        <div className="loader-spinner"></div>
                                        <span>Loading {isFabTab ? 'fabricators' : 'partners'}...</span>
                                    </div>
                                </td></tr>
                            ) : sortedPartners.length === 0 ? (
                                <tr><td colSpan={isMobile ? 2 : (showTypeColumn ? 13 : 12)} style={{ textAlign: 'center', padding: '3rem' }}>
                                    <div className="empty-state">
                                        <FileText size={48} opacity={0.2} />
                                        <p>No {isFabTab ? 'fabricators' : 'partners'} found.</p>
                                    </div>
                                </td></tr>
                            ) : sortedPartners.map(partner => (
                                <tr
                                    key={partner._id}
                                    className={
                                        partner.status === 'Different Sales Person' || partner.status === 'Not Interested'
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
                                            <td>
                                                <div className="partner-text-cell" title={partner.name || partner.contactName}>
                                                    {partner.name || partner.contactName || '-'}
                                                </div>
                                            </td>
                                            <td>
                                                <div className="partner-email-cell" title={partner.email}>
                                                    {partner.email || '-'}
                                                </div>
                                            </td>
                                            <td>{formatPhoneForDisplay(partner.phone) || '-'}</td>
                                            {showTypeColumn && (
                                                <td>
                                                    <span className={`customer-type-badge ${(partner.customerType || 'fabricator').toLowerCase().replace(' ', '-')}`}>
                                                        {partner.customerType || 'Fabricator'}
                                                    </span>
                                                </td>
                                            )}
                                            <td>{partner.city || partner.address?.city || '-'}</td>
                                            <td>
                                                {partner.salesRepName ? (
                                                    <span className="sales-rep-badge">{partner.salesRepName}</span>
                                                ) : (
                                                    <span className="sales-rep-badge unassigned">Unassigned</span>
                                                )}
                                            </td>
                                            <td>
                                                <span className={`location-badge ${locationClass(partner.location)}`}>
                                                    {partner.location || 'Seattle'}
                                                </span>
                                            </td>
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
            )}

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
                salesReps={salesReps}
                locations={locations}
                currentUser={user}
            />
        </div>
    );
};

export default PartnersSheet;
