import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    LayoutDashboard, Pin, PinOff,
    ChevronLeft, User, Clock, LogOut, Tag
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

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
    const navigate = useNavigate();
    const { user, logout } = useAuth();

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    // Get initials for avatar
    const getInitials = (name) => {
        if (!name) return 'U';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const handleLinkClick = (tab) => {
        handleCrmTabChange(tab);
        if (isMobile || !isPinned) {
            setIsSidebarOpen(false);
        }
    };

    return (
        <div
            className={`sales-sidebar ${!isSidebarOpen ? 'closed' : ''} ${!isPinned ? 'overlay' : ''}`}
            style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}
        >
            {!isMobile && (
                <div className="resize-handle" onMouseDown={startResizing} />
            )}

            {/* Sidebar Brand Header */}
            <div className="sidebar-brand-header">
                <div className="brand-logo-text">
                    <h3>EASY STONES</h3>
                    <span>SALES CRM</span>
                </div>
                {!isMobile && (
                    <button
                        className="sidebar-pin-btn"
                        onClick={togglePin}
                        title={isPinned ? "Unpin Sidebar" : "Pin Sidebar"}
                    >
                        {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                    </button>
                )}
            </div>

            {/* Top Navigation Links */}
            <div className="sidebar-nav-links">
                <button
                    className={`sidebar-nav-link ${crmTab === 'dashboard' ? 'active' : ''}`}
                    onClick={() => handleLinkClick('dashboard')}
                >
                    <LayoutDashboard size={18} />
                    <span>Dashboard</span>
                </button>
                <button
                    className={`sidebar-nav-link ${crmTab === 'customers' ? 'active' : ''}`}
                    onClick={() => handleLinkClick('customers')}
                >
                    <User size={18} />
                    <span>Customers</span>
                </button>
                <button
                    className={`sidebar-nav-link ${crmTab === 'checkin' ? 'active' : ''}`}
                    onClick={() => handleLinkClick('checkin')}
                >
                    <Clock size={18} />
                    <span>Check-In Log</span>
                </button>
                <button
                    className={`sidebar-nav-link ${crmTab === 'pricelist' ? 'active' : ''}`}
                    onClick={() => handleLinkClick('pricelist')}
                >
                    <Tag size={18} />
                    <span>Price List</span>
                </button>
            </div>

            {/* Spacer */}
            <div style={{ flexGrow: 1 }} />

            {/* User Profile / Logout Footer */}
            {user && (
                <div className="sidebar-user-footer">
                    <div className="user-avatar-pill">
                        {getInitials(user.contactName)}
                    </div>
                    <div className="user-details-text">
                        <span className="user-name">{user.contactName}</span>
                        <span className="user-role">{user.role || 'Sales Rep'}</span>
                    </div>
                    <button
                        className="sidebar-logout-btn"
                        onClick={handleLogout}
                        title="Logout"
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default CustomerSidebar;
