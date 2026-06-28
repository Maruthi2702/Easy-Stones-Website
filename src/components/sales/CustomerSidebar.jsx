import React from 'react';
import {
    LayoutDashboard, Pin, PinOff,
    ChevronLeft, User, Clock
} from 'lucide-react';

const CustomerSidebar = ({
    crmTab,
    handleCrmTabChange,
    isSidebarOpen,
    isMobile,
    isPinned,
    sidebarWidth,
    startResizing,
    togglePin,
    setIsSidebarOpen
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
        </div>
    );
};

export default CustomerSidebar;
