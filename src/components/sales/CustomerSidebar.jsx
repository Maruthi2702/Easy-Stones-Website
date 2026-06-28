import React from 'react';
import {
    LayoutDashboard, Pin, PinOff,
    ChevronLeft, Search, X, ChevronRight, User, AlertCircle,
    FileSpreadsheet, UserPlus, Clock, MapPin
} from 'lucide-react';

const CustomerSidebar = ({
    crmTab,
    handleCrmTabChange,
    isSidebarOpen,
    isMobile,
    isPinned,
    sidebarWidth,
    startResizing,
    filteredCustomers,
    selectedCustomerId,
    searchTerm,
    setSearchTerm,
    loading,
    error,
    togglePin,
    setIsSidebarOpen,
    handleGoHome,
    handleGoLeads,
    handleSelectCustomer,
    currentPage,
    setCurrentPage,
    totalPages,
    totalCustomers,
    onAddCustomer
}) => {
    return (
        <div
            className={`sales-sidebar ${!isSidebarOpen ? 'closed' : ''} ${!isPinned ? 'overlay' : ''}`}
            style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}
        >
            {!isMobile && (
                <div className="resize-handle" onMouseDown={startResizing} />
            )}

            {/* Sidebar Branding & Control Header */}
            <div className="sidebar-top-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
                <div className="sidebar-logo">
                    <img src="/logo.png" alt="Easy Stones" className="sidebar-logo-image" style={{ height: '32px' }} />
                </div>
                <div className="sidebar-top-controls" style={{ display: 'flex', gap: '0.25rem' }}>
                    {!isMobile && (
                        <button
                            className="icon-btn-ghost"
                            onClick={togglePin}
                            title={isPinned ? "Unpin Sidebar" : "Pin Sidebar"}
                        >
                            {isPinned ? <Pin size={16} fill="currentColor" /> : <PinOff size={16} />}
                        </button>
                    )}
                    {!isPinned && (
                        <button
                            className="icon-btn-ghost close-sidebar"
                            onClick={() => setIsSidebarOpen(false)}
                            title="Close Sidebar"
                        >
                            <ChevronLeft size={18} />
                        </button>
                    )}
                </div>
            </div>

            {/* Top Navigation Links */}
            <div className="sidebar-nav-links">
                <button
                    className={`sidebar-nav-link ${crmTab === 'dashboard' ? 'active' : ''}`}
                    onClick={() => handleCrmTabChange('dashboard')}
                >
                    <LayoutDashboard size={18} />
                    <span>Dashboard</span>
                </button>
                <button
                    className={`sidebar-nav-link ${crmTab === 'customers' ? 'active' : ''}`}
                    onClick={() => handleCrmTabChange('customers')}
                >
                    <User size={18} />
                    <span>Customers</span>
                </button>
                <button
                    className={`sidebar-nav-link ${crmTab === 'checkin' ? 'active' : ''}`}
                    onClick={() => handleCrmTabChange('checkin')}
                >
                    <Clock size={18} />
                    <span>Check-In Log</span>
                </button>
            </div>

            {/* Customer List section - Render only on Customers tab */}
            {crmTab === 'customers' && (
                <div className="sidebar-customer-section">
                    <div className="sidebar-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <h2>Customers</h2>
                            <span className="customer-count">{totalCustomers || 0}</span>
                        </div>
                        <div className="sidebar-controls">
                            <button
                                className="icon-btn-ghost"
                                onClick={handleGoHome}
                                title="Sales Dashboard"
                            >
                                <LayoutDashboard size={16} />
                            </button>
                            <button
                                className="icon-btn-ghost"
                                onClick={handleGoLeads}
                                title="Customer List (Spreadsheet)"
                            >
                                <FileSpreadsheet size={16} />
                            </button>
                            {onAddCustomer && (
                                <button
                                    className="icon-btn-ghost"
                                    onClick={onAddCustomer}
                                    title="Add New Customer"
                                    style={{ color: '#E5C04A' }}
                                >
                                    <UserPlus size={16} />
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="search-box">
                        <Search size={16} className="search-icon" />
                        <input
                            type="text"
                            placeholder="Search customers..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'rgba(255,255,255,0.1)',
                                    border: 'none',
                                    color: '#9CA3AF',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '4px',
                                    borderRadius: '50%',
                                    width: '20px',
                                    height: '20px'
                                }}
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>

                    {/* Pagination Controls */}
                    <div className="sidebar-pagination">
                        <button
                            disabled={currentPage <= 1 || loading}
                            onClick={() => setCurrentPage(prev => prev - 1)}
                            className="pagi-btn"
                            title="Previous Page"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <span className="pagi-info">
                            Page {currentPage} of {totalPages}
                        </span>
                        <button
                            disabled={currentPage >= totalPages || loading}
                            onClick={() => setCurrentPage(prev => prev + 1)}
                            className="pagi-btn"
                            title="Next Page"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    <div className="customer-list">
                        {loading ? (
                            <div className="skeleton-list">
                                {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                                    <div key={i} className="skeleton-item">
                                        <div className="skeleton-thumb skeleton" />
                                        <div className="skeleton-info">
                                            <div className="skeleton-name skeleton" />
                                            <div className="skeleton-meta skeleton" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : error ? (
                            <div className="error-message" style={{ padding: '1.5rem', color: '#ef4444', textAlign: 'center' }}>
                                <p>Failed to load customers</p>
                                <button
                                    onClick={() => window.location.reload()}
                                    style={{
                                        marginTop: '0.5rem',
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        border: '1px solid rgba(239, 68, 68, 0.2)',
                                        color: '#ef4444',
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem'
                                    }}
                                >
                                    Retry
                                </button>
                            </div>
                        ) : filteredCustomers.length === 0 ? (
                            <div className="empty-list-message">
                                No customers found
                            </div>
                        ) : (
                            filteredCustomers.map(customer => {
                                const getDormancyStatus = () => {
                                    try {
                                        const now = new Date();
                                        const sixtyDaysAgo = new Date(now.getTime() - (60 * 24 * 60 * 60 * 1000));

                                        if (customer.visits && customer.visits.length > 0) {
                                            const latestInArray = customer.visits.reduce((latest, v) => {
                                                const vDate = new Date(v.date);
                                                return (!latest || vDate > latest) ? vDate : latest;
                                            }, null);

                                            if (latestInArray && !isNaN(latestInArray.getTime())) {
                                                return latestInArray < sixtyDaysAgo;
                                            }
                                        }

                                        if (customer.lastVisitDate) {
                                            const last = new Date(customer.lastVisitDate);
                                            if (!isNaN(last.getTime())) {
                                                return last < sixtyDaysAgo;
                                            }
                                        }

                                        if (customer.createdAt) {
                                            const created = new Date(customer.createdAt);
                                            if (!isNaN(created.getTime())) {
                                                return created < sixtyDaysAgo;
                                            }
                                        }

                                        return false;
                                    } catch (e) {
                                        return false;
                                    }
                                };
                                const dormant = getDormancyStatus();

                                return (
                                    <div
                                        key={customer._id}
                                        className={`customer-list-item ${selectedCustomerId === customer._id ? 'active' : ''} ${customer.quickNote ? 'has-quick-note' : ''} ${dormant ? 'dormant-alert' : ''}`}
                                        onClick={() => handleSelectCustomer(customer)}
                                    >
                                        <div className="list-thumb-placeholder">
                                            <User size={20} />
                                        </div>
                                        <div className="list-info">
                                            <div className="list-name-row">
                                                <span className="list-name">
                                                    {customer.company || customer.contactName || `${customer.firstName} ${customer.lastName}`}
                                                    {customer.isActive === false && <span className="inactive-badge">(Inactive)</span>}
                                                </span>
                                                {dormant && (
                                                    <div className="dormant-badge" title="Needs follow-up (no activity in 60+ days)">
                                                        <AlertCircle size={14} />
                                                    </div>
                                                )}
                                            </div>
                                            <span className="list-meta">{customer.company || customer.email}</span>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomerSidebar;
