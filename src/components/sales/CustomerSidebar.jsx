import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    LayoutDashboard, Pin, PinOff, Sun, Moon,
    ChevronLeft, User, Clock, LogOut, Tag, Users, UserCheck, TrendingDown
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
    setIsSidebarOpen,
    theme,
    toggleTheme
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        className="sidebar-pin-btn"
                        onClick={toggleTheme}
                        title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
                    >
                        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                    </button>
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
            </div>

            {/* Top Navigation Links — shown only if user has the permission */}
            <div className="sidebar-nav-links">
                {/* Dashboard — requires view_dashboard */}
                {user?.permissions?.includes('view_dashboard') && (
                    <button
                        className={`sidebar-nav-link ${crmTab === 'dashboard' ? 'active' : ''}`}
                        onClick={() => handleLinkClick('dashboard')}
                    >
                        <LayoutDashboard size={18} />
                        <span>Dashboard</span>
                    </button>
                )}

                {/* Customers — requires view_customers */}
                {user?.permissions?.includes('view_customers') && (
                    <button
                        className={`sidebar-nav-link ${crmTab === 'customers' ? 'active' : ''}`}
                        onClick={() => handleLinkClick('customers')}
                    >
                        <User size={18} />
                        <span>Customers</span>
                    </button>
                )}

                {/* Check-In Log — requires view_checkins */}
                {user?.permissions?.includes('view_checkins') && (
                    <button
                        className={`sidebar-nav-link ${crmTab === 'checkin' ? 'active' : ''}`}
                        onClick={() => handleLinkClick('checkin')}
                    >
                        <Clock size={18} />
                        <span>Check-In Log</span>
                    </button>
                )}

                {/* Price List / Selection Sheet — requires view_pricelist */}
                {user?.permissions?.includes('view_pricelist') && (
                    <button
                        className={`sidebar-nav-link ${crmTab === 'pricelist' ? 'active' : ''}`}
                        onClick={() => handleLinkClick('pricelist')}
                    >
                        <Tag size={18} />
                        <span>Price List</span>
                    </button>
                )}

                {/* Lost Sales — requires view_lost_sales */}
                {(user?.permissions?.includes('view_lost_sales') || user?.permissions?.includes('manage_lost_sales') || user?.role === 'admin' || !user) && (
                    <button
                        className={`sidebar-nav-link ${crmTab === 'lost_sales' ? 'active' : ''}`}
                        onClick={() => handleLinkClick('lost_sales')}
                        title="Lost Sales Tracker"
                    >
                        <TrendingDown size={18} />
                        <span>Lost Sales</span>
                    </button>
                )}

                {/* Users & Roles — requires manage_users */}
                {user?.permissions?.includes('manage_users') && (
                    <button
                        className={`sidebar-nav-link ${crmTab === 'users' ? 'active' : ''}`}
                        onClick={() => handleLinkClick('users')}
                    >
                        <Users size={18} />
                        <span>Users & Roles</span>
                    </button>
                )}

                {/* My Profile */}
                <button
                    className={`sidebar-nav-link ${crmTab === 'profile' ? 'active' : ''}`}
                    onClick={() => handleLinkClick('profile')}
                >
                    <UserCheck size={18} />
                    <span>My Profile</span>
                </button>
            </div>

            {/* Spacer */}
            <div style={{ flexGrow: 1 }} />

            {/* User Profile / Logout Footer */}
            {user && (
                <div className="sidebar-user-footer">
                    <div 
                        className="user-profile-trigger" 
                        onClick={() => handleLinkClick('profile')}
                        title="View My Profile"
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flexGrow: 1 }}
                    >
                        <div className="user-avatar-pill">
                            {getInitials(user.contactName)}
                        </div>
                        <div className="user-details-text">
                            <span className="user-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <User size={12} style={{ opacity: 0.8 }} />
                                {user.contactName}
                            </span>
                            <span className="user-role" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Users size={12} style={{ opacity: 0.8 }} />
                                {user.role || 'Sales Rep'}
                            </span>
                        </div>
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
