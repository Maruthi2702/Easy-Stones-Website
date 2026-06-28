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
