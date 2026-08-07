import React, { useState, useEffect, useMemo } from 'react';
import { 
    Users, ShieldAlert, Plus, Edit2, Trash2, Search, 
    Save, Key, Mail, MapPin, UserCheck, ShieldCheck, Info,
    LayoutDashboard, User, Clock, Tag, X, Eye, Pencil,
    FileCog, Mail as MailIcon, TrendingDown, Truck, IdCard
} from 'lucide-react';
import { API_URL } from '../../config/api';
import { prettifyUsername } from '../../utils/textUtils';
import { clearDriversCache } from '../../api/schedule';
import './UsersRolesTab.css';

// Granular per-page permission definitions.
// Each page has a set of "actions" that map to backend permission keys.
const PAGE_PERMISSIONS = [
    {
        id: 'dashboard',
        page: 'Dashboard',
        icon: LayoutDashboard,
        description: 'CRM overview: charts, stats, calendar',
        color: '#6c8ebf',
        actions: [
            { key: 'view_dashboard', label: 'View', icon: Eye, desc: 'View dashboard charts and sales statistics' }
        ]
    },
    {
        id: 'customers',
        page: 'Customers',
        icon: User,
        description: 'Customer database, visits, contacts',
        color: '#82b366',
        actions: [
            { key: 'view_customers',   label: 'View',   icon: Eye,    desc: 'View customer list and details' },
            { key: 'manage_customers', label: 'Edit / Add', icon: Pencil, desc: 'Add and edit customers, visits, contacts' },
            { key: 'delete_customers', label: 'Delete', icon: Trash2, desc: 'Delete customer records and visits' }
        ]
    },
    {
        id: 'checkins',
        page: 'Check-In Log',
        icon: Clock,
        description: 'Office check-ins and selection sheets',
        color: '#d79b00',
        actions: [
            { key: 'view_checkins',     label: 'View',             icon: Eye,      desc: 'View check-in log records' },
            { key: 'send_checkin_email',label: 'Selection Sheet',  icon: MailIcon, desc: 'Send selection sheet emails to customers' },
            { key: 'manage_checkins',   label: 'Edit',             icon: Pencil,   desc: 'Edit check-in records' },
            { key: 'delete_checkins',   label: 'Delete',           icon: Trash2,   desc: 'Delete check-in records' }
        ]
    },
    {
        id: 'pricelist',
        page: 'Price List',
        icon: Tag,
        description: 'Price levels, margins, Excel download',
        color: '#9673a6',
        actions: [
            { key: 'view_pricelist',   label: 'View',            icon: Eye,    desc: 'View price lists and margins' },
            { key: 'manage_pricelist', label: 'Edit / Download', icon: FileCog, desc: 'Edit margin levels and download Excel' },
            { key: 'view_product_prices', label: 'View Product Prices', icon: Eye, desc: 'Allow viewing prices on product detail pages' }
        ]
    },
    {
        id: 'lost_sales',
        page: 'Lost Sales',
        icon: TrendingDown,
        description: 'Track lost revenue, competitor pricing & stock friction',
        color: '#ef4444',
        actions: [
            { key: 'view_lost_sales', label: 'View', icon: Eye, desc: 'View lost sales records and metrics' },
            { key: 'edit_lost_sales', label: 'Edit', icon: Pencil, desc: 'Record new lost sales and edit existing records' },
            { key: 'delete_lost_sales', label: 'Delete', icon: Trash2, desc: 'Delete lost sale records' }
        ]
    },
    {
        id: 'delivery_schedule',
        page: 'Delivery Schedule',
        icon: Truck,
        description: 'Schedule, track, and dispatch slab deliveries',
        color: '#3b82f6',
        actions: [
            { key: 'view_delivery_schedule', label: 'View', icon: Eye, desc: 'View delivery schedules and routes' },
            { key: 'edit_delivery_schedule', label: 'Edit', icon: Pencil, desc: 'Schedule and edit delivery jobs' },
            { key: 'delete_delivery_schedule', label: 'Delete', icon: Trash2, desc: 'Cancel or delete delivery jobs' }
        ]
    },
    {
        id: 'users',
        page: 'Users & Roles',
        icon: Users,
        description: 'User accounts, roles, permissions',
        color: '#ae4132',
        actions: [
            { key: 'manage_users', label: 'Manage', icon: ShieldCheck, desc: 'Add/edit users and customize role permissions' }
        ]
    }
];

// Flat lookup for all permission keys (used for labels elsewhere)
const ALL_PERMISSION_KEYS = PAGE_PERMISSIONS.flatMap(p => p.actions.map(a => a.key));


const UsersRolesTab = ({ sidebarToggle, locations = [], fetchLocations }) => {
    const [subTab, setSubTab] = useState('users'); // 'users', 'roles', 'locations'
    const [newLocationName, setNewLocationName] = useState('');
    const [isAddingLocation, setIsAddingLocation] = useState(false);
    const [locationError, setLocationError] = useState('');
    const [locationSuccess, setLocationSuccess] = useState('');

    useEffect(() => {
        if (locationSuccess || locationError) {
            const t = setTimeout(() => {
                setLocationSuccess('');
                setLocationError('');
            }, 5000);
            return () => clearTimeout(t);
        }
    }, [locationSuccess, locationError]);

    const handleAddLocation = async (e) => {
        e.preventDefault();
        if (!newLocationName.trim()) return;

        setIsAddingLocation(true);
        setLocationError('');
        setLocationSuccess('');

        try {
            const res = await fetchWithAuth(`${API_URL}/api/admin/locations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newLocationName.trim() })
            });

            if (res.ok) {
                const data = await res.json();
                setLocationSuccess(`Location "${data.name}" added successfully!`);
                setNewLocationName('');
                if (fetchLocations) fetchLocations();
            } else {
                const data = await res.json();
                setLocationError(data.message || 'Failed to add location');
            }
        } catch (err) {
            console.error('Error adding location:', err);
            setLocationError('Network error. Failed to add location.');
        } finally {
            setIsAddingLocation(false);
        }
    };

    const handleDeleteLocation = async (id) => {
        if (!window.confirm('Are you sure you want to delete this location? Users assigned to this location might lose access.')) return;

        try {
            const res = await fetchWithAuth(`${API_URL}/api/admin/locations/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                setLocationSuccess('Location deleted successfully!');
                if (fetchLocations) fetchLocations();
            } else {
                const data = await res.json();
                setLocationError(data.message || 'Failed to delete location');
            }
        } catch (err) {
            console.error('Error deleting location:', err);
            setLocationError('Network error. Failed to delete location.');
        }
    };

    // Auth-aware fetch helper that passes credentials/cookies correctly
    const fetchWithAuth = (url, options = {}) => {
        const token = localStorage.getItem('token');
        return fetch(url, {
            ...options,
            credentials: 'include',
            headers: {
                ...options.headers,
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            }
        });
    };

    // Ensure we have a token in localStorage - exchanges cookie for JWT if needed
    // This supports existing sessions that pre-date the localStorage token storage
    const ensureToken = async () => {
        if (localStorage.getItem('token')) return; // already have it
        try {
            const res = await fetch(`${API_URL}/api/auth/token`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                if (data.token) localStorage.setItem('token', data.token);
            }
        } catch (e) {
            // If this fails, fetchWithAuth will fall back to cookie-based auth
        }
    };

    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filter states
    const [userSearch, setUserSearch] = useState('');

    // Selected role for permissions editing
    const [selectedRole, setSelectedRole] = useState(null);
    const [editedPermissions, setEditedPermissions] = useState([]);
    const [savingPermissions, setSavingPermissions] = useState(false);

    // Page permission popup state
    const [pagePopup, setPagePopup] = useState(null); // the PAGE_PERMISSIONS entry being edited

    // Modal state
    const [showUserModal, setShowUserModal] = useState(false);
    const [modalMode, setModalMode] = useState('add'); // 'add' or 'edit'
    const [editingUser, setEditingUser] = useState(null);
    const [userForm, setUserForm] = useState({
        username: '',
        displayName: '',
        email: '',
        role: 'sales_rep',
        location: '',
        assignedLocations: locations[0] ? [locations[0].name] : ['Seattle'],
        password: ''
    });

    const [showRoleModal, setShowRoleModal] = useState(false);
    const [showLocationDropdown, setShowLocationDropdown] = useState(false);
    const [roleForm, setRoleForm] = useState({
        name: '',
        displayName: ''
    });

    // Fetch initial data
    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Ensure we have a token for Authorization header (supports existing sessions)
            await ensureToken();

            const [usersRes, rolesRes] = await Promise.all([
                fetchWithAuth(`${API_URL}/api/admin/users`),
                fetchWithAuth(`${API_URL}/api/admin/roles`)
            ]);

            if (!usersRes.ok || !rolesRes.ok) {
                // Get the actual error from the server for better debugging
                const errBody = !usersRes.ok ? await usersRes.json().catch(() => ({})) : await rolesRes.json().catch(() => ({}));
                throw new Error(errBody.error || errBody.message || 'Failed to fetch users or roles. Check your access permissions.');
            }

            const usersData = await usersRes.json();
            const rolesData = await rolesRes.json();

            setUsers(usersData);
            setRoles(rolesData);

            // Set default selected role
            if (rolesData.length > 0) {
                const defaultRole = rolesData.find(r => r.name === 'sales_rep') || rolesData[0];
                setSelectedRole(defaultRole);
                setEditedPermissions(defaultRole.permissions || []);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Handle role selection change
    const handleRoleSelect = (role) => {
        setSelectedRole(role);
        setEditedPermissions(role.permissions || []);
    };

    // Toggle permission checkbox
    const handlePermissionToggle = (permissionKey) => {
        setEditedPermissions(prev => {
            if (prev.includes(permissionKey)) {
                return prev.filter(p => p !== permissionKey);
            } else {
                return [...prev, permissionKey];
            }
        });
    };

    // Save updated permissions for a role
    const handleSavePermissions = async () => {
        if (!selectedRole) return;
        setSavingPermissions(true);
        try {
            const res = await fetchWithAuth(`${API_URL}/api/admin/roles/${selectedRole._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ permissions: editedPermissions })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to save permissions');
            }

            // Update local state
            setRoles(prev => prev.map(r => r._id === selectedRole._id ? { ...r, permissions: editedPermissions } : r));
            setSelectedRole(prev => ({ ...prev, permissions: editedPermissions }));
            alert('Permissions updated successfully!');
        } catch (err) {
            alert(err.message);
        } finally {
            setSavingPermissions(false);
        }
    };

    // Create a new custom role
    const handleCreateRole = async (e) => {
        e.preventDefault();
        if (!roleForm.displayName) {
            alert('Display Name is required');
            return;
        }
        try {
            const res = await fetchWithAuth(`${API_URL}/api/admin/roles`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: roleForm.displayName.toLowerCase().replace(/\s+/g, '_'),
                    displayName: roleForm.displayName
                })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to create role');
            }

            const newRole = await res.json();
            setRoles(prev => [...prev, newRole.role]);
            setSelectedRole(newRole.role);
            setEditedPermissions([]);
            setShowRoleModal(false);
            setRoleForm({ name: '', displayName: '' });
            alert('Custom role created successfully!');
        } catch (err) {
            alert(err.message);
        }
    };

    // Delete custom role
    const handleDeleteRole = async (role) => {
        if (role.isSystem) {
            alert('Cannot delete system roles');
            return;
        }
        if (!window.confirm(`Are you sure you want to delete the role "${role.displayName}"?`)) {
            return;
        }
        try {
            const res = await fetchWithAuth(`${API_URL}/api/admin/roles/${role._id}`, {
                method: 'DELETE'
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Failed to delete role');
            }

            setRoles(prev => prev.filter(r => r._id !== role._id));
            if (selectedRole?._id === role._id) {
                setSelectedRole(roles[0]);
                setEditedPermissions(roles[0]?.permissions || []);
            }
            alert('Role deleted successfully!');
        } catch (err) {
            alert(err.message);
        }
    };

    // User management crud handlers
    const openAddUserModal = () => {
        setModalMode('add');
        setUserForm({
            username: '',
            displayName: '',
            email: '',
            role: roles[0]?.name || 'sales_rep',
            location: '',
            assignedLocations: locations[0] ? [locations[0].name] : ['Seattle'],
            password: ''
        });
        setEditingUser(null);
        setShowLocationDropdown(false);
        setShowUserModal(true);
    };

    const openEditUserModal = (user) => {
        setModalMode('edit');
        setUserForm({
            username: user.username,
            displayName: user.displayName || '',
            email: user.email || '',
            role: user.role || 'sales_rep',
            location: user.location || '',
            assignedLocations: user.assignedLocations || (locations[0] ? [locations[0].name] : ['Seattle']),
            password: '' // Keep password empty unless changing
        });
        setEditingUser(user);
        setShowLocationDropdown(false);
        setShowUserModal(true);
    };

    const handleUserSubmit = async (e) => {
        e.preventDefault();
        if (!userForm.username) {
            alert('Username is required');
            return;
        }
        if (modalMode === 'add' && !userForm.password) {
            alert('Password is required for new users');
            return;
        }

        try {
            const url = modalMode === 'add' 
                ? `${API_URL}/api/admin/users`
                : `${API_URL}/api/admin/users/${editingUser._id}`;
            const method = modalMode === 'add' ? 'POST' : 'PUT';

            // Filter out empty password on edit
            const payload = { ...userForm };
            if (modalMode === 'edit' && !payload.password) {
                delete payload.password;
            }

            const res = await fetchWithAuth(url, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || `Failed to ${modalMode} user`);
            }

            // The delivery board caches the driver list in localStorage, so a
            // rename would otherwise keep showing the old name for up to 10
            // minutes in this tab.
            clearDriversCache();

            alert(`User ${modalMode === 'add' ? 'created' : 'updated'} successfully!`);
            setShowUserModal(false);
            fetchData(); // Reload table
        } catch (err) {
            alert(err.message);
        }
    };

    const handleDeleteUser = async (user) => {
        if (!window.confirm(`Are you sure you want to delete user "${user.username}"?`)) {
            return;
        }
        try {
            const res = await fetchWithAuth(`${API_URL}/api/admin/users/${user._id}`, {
                method: 'DELETE'
            });

            if (!res.ok) {
                throw new Error('Failed to delete user');
            }

            setUsers(prev => prev.filter(u => u._id !== user._id));
            clearDriversCache();
            alert('User deleted successfully!');
        } catch (err) {
            alert(err.message);
        }
    };

    // Filtered users
    const filteredUsers = useMemo(() => {
        const query = (userSearch || '').trim().toLowerCase();
        if (!query) return users;
        return users.filter(user => {
            return (
                user.username.toLowerCase().includes(query) ||
                (user.displayName && user.displayName.toLowerCase().includes(query)) ||
                (user.email && user.email.toLowerCase().includes(query)) ||
                user.role.toLowerCase().includes(query) ||
                (user.location && user.location.toLowerCase().includes(query))
            );
        });
    }, [users, userSearch]);

    const getRoleDisplayName = (roleName) => {
        const role = roles.find(r => r.name === roleName);
        return role ? role.displayName : roleName.toUpperCase().replace('_', ' ');
    };

    return (
        <div className="users-roles-container">
            {/* Header tab switcher */}
            <div className="users-roles-header" style={{ gap: '1.25rem' }}>
                {sidebarToggle}
                <div className="tabs-capsule">
                    <button 
                        className={`sub-tab-btn ${subTab === 'users' ? 'active' : ''}`}
                        onClick={() => setSubTab('users')}
                    >
                        <Users size={16} />
                        Users List
                    </button>
                    <button 
                        className={`sub-tab-btn ${subTab === 'roles' ? 'active' : ''}`}
                        onClick={() => setSubTab('roles')}
                    >
                        <ShieldAlert size={16} />
                        Roles & Permissions
                    </button>
                    <button 
                        className={`sub-tab-btn ${subTab === 'locations' ? 'active' : ''}`}
                        onClick={() => setSubTab('locations')}
                    >
                        <MapPin size={16} />
                        Locations
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="loading-state">
                    <div className="loader-spinner"></div>
                    <span>Loading users & permissions...</span>
                </div>
            ) : error ? (
                <div className="error-state">
                    <ShieldAlert size={48} color="#ef4444" />
                    <h3>Access Restricted</h3>
                    <p>{error}</p>
                </div>
            ) : (
                <div className="sub-tab-content">
                    {/* ── SUB TAB 1: USERS LIST ── */}
                    {subTab === 'users' && (
                        <div className="users-panel-layout">
                            <div className="panel-actions-toolbar">
                                <div className="search-input-wrapper">
                                    <Search size={18} className="search-icon" />
                                    <input 
                                        type="text" 
                                        placeholder="Search users by name, email, or role..." 
                                        value={userSearch}
                                        onChange={(e) => setUserSearch(e.target.value)}
                                    />
                                </div>
                                <button className="add-user-btn" onClick={openAddUserModal}>
                                    <Plus size={18} />
                                    Add User
                                </button>
                            </div>

                            <div className="users-table-wrapper">
                                <table className="users-table">
                                    <thead>
                                        <tr>
                                            <th>Username</th>
                                            <th>Email</th>
                                            <th>Role</th>
                                            <th>Location</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredUsers.length === 0 ? (
                                            <tr>
                                                <td colSpan="5" className="empty-table-row">No users found.</td>
                                            </tr>
                                        ) : (
                                            filteredUsers.map(u => (
                                                <tr key={u._id}>
                                                    <td className="username-cell" data-label="Username">
                                                        <div className="avatar-small">
                                                            {(u.displayName || u.username).substring(0, 2).toUpperCase()}
                                                        </div>
                                                        {/* Display Name is what the rest of the app shows, so lead with
                                                            it and keep the login username underneath for reference. */}
                                                        <div className="username-cell-names">
                                                            <span>{u.displayName || prettifyUsername(u.username)}</span>
                                                            <small>{u.username}</small>
                                                        </div>
                                                    </td>
                                                    <td data-label="Email">{u.email || '-'}</td>
                                                    <td data-label="Role">
                                                        <span className={`role-badge ${u.role}`}>
                                                            {getRoleDisplayName(u.role)}
                                                        </span>
                                                    </td>
                                                    <td data-label="Location">{u.location || '-'}</td>
                                                    <td data-label="Actions">
                                                        <div className="action-pill-row">
                                                            <button
                                                                className="user-action-pill view"
                                                                onClick={() => openEditUserModal(u)}
                                                                title="View user details"
                                                            >
                                                                <Eye size={13} />
                                                                View
                                                            </button>
                                                            <button
                                                                className="user-action-pill edit"
                                                                onClick={() => openEditUserModal(u)}
                                                                title="Edit user profile"
                                                            >
                                                                <Edit2 size={13} />
                                                                Edit
                                                            </button>
                                                            <button
                                                                className="user-action-pill driver"
                                                                title="Driver access"
                                                                onClick={() => alert(`Driver access for ${u.username}: role = ${u.role}`)}
                                                            >
                                                                <Truck size={13} />
                                                                Driver Access
                                                            </button>
                                                            <button
                                                                className="user-action-pill delete"
                                                                onClick={() => handleDeleteUser(u)}
                                                                title="Delete user"
                                                            >
                                                                <Trash2 size={13} />
                                                                Delete
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ── SUB TAB 2: ROLES & PERMISSIONS ── */}
                    {subTab === 'roles' && (
                        <div className="roles-panel-layout">
                            {/* Left Roles Sidebar list */}
                            <div className="roles-sidebar-list">
                                <div className="sidebar-header-row">
                                    <h4>Roles</h4>
                                    <button className="add-role-btn" onClick={() => setShowRoleModal(true)} title="Add Custom Role">
                                        <Plus size={16} />
                                    </button>
                                </div>
                                <div className="roles-scroll-container">
                                    {roles.map(r => (
                                        <div 
                                            key={r._id} 
                                            className={`role-list-item ${selectedRole?._id === r._id ? 'active' : ''}`}
                                            onClick={() => handleRoleSelect(r)}
                                        >
                                            <div className="role-item-main">
                                                <span className="role-display-name">{r.displayName}</span>
                                                <span className="role-system-name">({r.name})</span>
                                            </div>
                                            {!r.isSystem && (
                                                <button 
                                                    className="delete-role-btn-icon" 
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteRole(r); }}
                                                    title="Delete Custom Role"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                                                        {/* ── RIGHT: Page-based permission cards grid ── */}
                                    {selectedRole && (
                                        <div className="permissions-config-panel">
                                            <div className="permissions-panel-header">
                                                <div>
                                                    <h3>{selectedRole.displayName} Access Permissions</h3>
                                                    <p className="subtitle">Click a page card to configure which actions this role can perform.</p>
                                                </div>
                                                <button 
                                                    className="save-permissions-btn" 
                                                    onClick={handleSavePermissions}
                                                    disabled={savingPermissions}
                                                >
                                                    <Save size={16} />
                                                    {savingPermissions ? 'Saving...' : 'Save Permissions'}
                                                </button>
                                            </div>

                                            <div className="page-permissions-grid">
                                                {PAGE_PERMISSIONS.map(pageDef => {
                                                    const PageIcon = pageDef.icon;
                                                    const enabledActions = pageDef.actions.filter(a => editedPermissions.includes(a.key));
                                                    const hasAny = enabledActions.length > 0;

                                                    return (
                                                        <div
                                                            key={pageDef.id}
                                                            className={`page-perm-card ${hasAny ? 'has-access' : ''}`}
                                                            onClick={() => setPagePopup(pageDef)}
                                                            style={{ '--page-color': pageDef.color }}
                                                        >
                                                            <div className="page-perm-card-header">
                                                                <div className="page-icon-wrap" style={{ background: hasAny ? pageDef.color + '22' : undefined }}>
                                                                    <PageIcon size={20} style={{ color: hasAny ? pageDef.color : undefined }} />
                                                                </div>
                                                                <div className="page-access-badge">
                                                                    {hasAny ? `${enabledActions.length} action${enabledActions.length > 1 ? 's' : ''}` : 'No access'}
                                                                </div>
                                                            </div>
                                                            <div className="page-perm-card-title">{pageDef.page}</div>
                                                            <div className="page-perm-card-desc">{pageDef.description}</div>
                                                            {hasAny && (
                                                                <div className="page-perm-action-pills">
                                                                    {enabledActions.map(a => (
                                                                        <span key={a.key} className="action-pill" style={{ background: pageDef.color + '33', color: pageDef.color }}>
                                                                            {a.label}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            <div className="page-perm-edit-hint">Click to edit →</div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* ── PAGE PERMISSION POPUP ── */}
                                    {pagePopup && (
                                        <div className="perm-popup-overlay" onClick={() => setPagePopup(null)}>
                                            <div className="perm-popup-card" onClick={e => e.stopPropagation()}>
                                                <div className="perm-popup-header" style={{ borderColor: pagePopup.color }}>
                                                    <div className="perm-popup-title-row">
                                                        <div className="page-icon-wrap" style={{ background: pagePopup.color + '22' }}>
                                                            {React.createElement(pagePopup.icon, { size: 22, style: { color: pagePopup.color } })}
                                                        </div>
                                                        <div>
                                                            <h3>{pagePopup.page}</h3>
                                                            <p>{pagePopup.description}</p>
                                                        </div>
                                                    </div>
                                                    <button className="popup-close-btn" onClick={() => setPagePopup(null)}>
                                                        <X size={18} />
                                                    </button>
                                                </div>

                                                <div className="perm-popup-actions">
                                                    {pagePopup.actions.map(action => {
                                                        const ActionIcon = action.icon;
                                                        const isEnabled = editedPermissions.includes(action.key);
                                                        return (
                                                            <div
                                                                key={action.key}
                                                                className={`perm-action-row ${isEnabled ? 'enabled' : ''}`}
                                                                onClick={() => handlePermissionToggle(action.key)}
                                                            >
                                                                <div className="perm-action-icon" style={{ color: isEnabled ? pagePopup.color : undefined }}>
                                                                    <ActionIcon size={18} />
                                                                </div>
                                                                <div className="perm-action-text">
                                                                    <span className="perm-action-label">{action.label}</span>
                                                                    <span className="perm-action-desc">{action.desc}</span>
                                                                </div>
                                                                <div className={`perm-toggle ${isEnabled ? 'on' : 'off'}`} style={isEnabled ? { background: pagePopup.color } : {}}>
                                                                    <div className="perm-toggle-knob" />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                <div className="perm-popup-footer">
                                                    <button className="btn-secondary" onClick={() => setPagePopup(null)}>Done</button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                </div>
            )}

                    {/* ── SUB TAB 3: LOCATIONS MANAGEMENT ── */}
                    {subTab === 'locations' && (
                        <div className="locations-panel-layout">
                            <div className="panel-actions-toolbar">
                                <form onSubmit={handleAddLocation} className="add-location-form" style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '560px' }}>
                                    <div className="search-input-wrapper" style={{ flex: 1, maxWidth: 'none' }}>
                                        <MapPin className="search-icon" size={18} />
                                        <input 
                                            type="text" 
                                            placeholder="Add new location name (e.g. Portland, Salt Lake City)..." 
                                            value={newLocationName}
                                            onChange={(e) => setNewLocationName(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <button type="submit" className="add-user-btn" disabled={isAddingLocation} style={{ whiteSpace: 'nowrap' }}>
                                        {isAddingLocation ? (
                                            <div className="loader-spinner" style={{ width: '16px', height: '16px', border: '2px solid transparent', borderTopColor: '#0f172a', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                                        ) : (
                                            <Plus size={18} />
                                        )}
                                        <span>Add Location</span>
                                    </button>
                                </form>
                            </div>

                            {locationError && (
                                <div className="profile-message-banner error">
                                    <ShieldAlert size={16} />
                                    <span>{locationError}</span>
                                </div>
                            )}

                            {locationSuccess && (
                                <div className="profile-message-banner success">
                                    <UserCheck size={16} />
                                    <span>{locationSuccess}</span>
                                </div>
                            )}

                            <div className="users-table-wrapper">
                                <table className="users-table">
                                    <thead>
                                        <tr>
                                            <th>Location Name</th>
                                            <th>Date Created</th>
                                            <th style={{ width: '100px', textAlign: 'center' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {locations.length === 0 ? (
                                            <tr>
                                                <td colSpan="3" className="empty-table-row">
                                                    No locations found. Add one above!
                                                </td>
                                            </tr>
                                        ) : (
                                            locations.map(loc => (
                                                <tr key={loc._id}>
                                                    <td>
                                                        <div className="username-cell">
                                                            <div className="avatar-small location-avatar">
                                                                <MapPin size={16} />
                                                            </div>
                                                            <span style={{ fontWeight: 650, color: '#ffffff', fontSize: '0.98rem' }}>{loc.name}</span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontSize: '0.88rem' }}>
                                                            <Clock size={14} style={{ opacity: 0.7 }} />
                                                            <span>{loc.createdAt ? new Date(loc.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'System Seeded'}</span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="action-buttons-cell" style={{ justifyContent: 'center' }}>
                                                            <button 
                                                                type="button"
                                                                className="action-icon-btn delete"
                                                                onClick={() => handleDeleteLocation(loc._id)}
                                                                title="Delete Location"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── MODAL: ADD/EDIT USER ── */}
            {showUserModal && (
                <div className="user-modal-overlay">
                    <div className="user-modal-card">
                        <div className="modal-header">
                            <h3>{modalMode === 'add' ? 'Add New User' : 'Edit User Profile'}</h3>
                            <button className="modal-close-btn" onClick={() => setShowUserModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleUserSubmit} className="modal-form">
                            <div className="form-group">
                                <label><UserCheck size={16} /> Username</label>
                                <input
                                    type="text"
                                    value={userForm.username}
                                    onChange={(e) => setUserForm(prev => ({ ...prev, username: e.target.value }))}
                                    placeholder="e.g. jdoe"
                                    required
                                    disabled={modalMode === 'edit'} // Username remains constant
                                />
                                <small className="form-hint">Used to sign in. Always saved in lower case.</small>
                            </div>

                            <div className="form-group">
                                <label><IdCard size={16} /> Display Name</label>
                                <input
                                    type="text"
                                    value={userForm.displayName}
                                    onChange={(e) => setUserForm(prev => ({ ...prev, displayName: e.target.value }))}
                                    placeholder={userForm.username ? prettifyUsername(userForm.username) : 'e.g. J. Doe'}
                                />
                                <small className="form-hint">
                                    Shown everywhere in the app — driver lists, check-in log, delivery tickets.
                                    Leave blank to use <strong>{userForm.username ? prettifyUsername(userForm.username) : 'the username'}</strong>.
                                </small>
                            </div>

                            <div className="form-group">
                                <label><Mail size={16} /> Email Address</label>
                                <input 
                                    type="email" 
                                    value={userForm.email}
                                    onChange={(e) => setUserForm(prev => ({ ...prev, email: e.target.value }))}
                                    placeholder="e.g. jdoe@easystones.com"
                                />
                            </div>

                            <div className="form-group">
                                <label><ShieldCheck size={16} /> Assigned Role</label>
                                <select 
                                    value={userForm.role}
                                    onChange={(e) => setUserForm(prev => ({ ...prev, role: e.target.value }))}
                                >
                                    {roles.map(r => (
                                        <option key={r.name} value={r.name}>{r.displayName}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group relative">
                                <label><MapPin size={16} /> Assigned Locations (for Check-Ins)</label>
                                <div className="multi-select-container">
                                    <div 
                                        className="multi-select-trigger" 
                                        onClick={() => setShowLocationDropdown(!showLocationDropdown)}
                                    >
                                        <div className="multi-select-tags">
                                            {(!userForm.assignedLocations || userForm.assignedLocations.length === 0) && (
                                                <span className="placeholder">Select locations...</span>
                                            )}
                                            {userForm.assignedLocations?.includes('*') ? (
                                                <span className="multi-select-tag-pill">All Locations</span>
                                            ) : (
                                                userForm.assignedLocations?.map(loc => (
                                                    <span key={loc} className="multi-select-tag-pill">
                                                        {loc}
                                                        <button 
                                                            type="button" 
                                                            className="remove-tag-btn"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setUserForm(prev => {
                                                                    const list = (prev.assignedLocations || []).filter(k => k !== loc);
                                                                    return {
                                                                        ...prev,
                                                                        assignedLocations: list,
                                                                        location: list[0] || ''
                                                                    };
                                                                });
                                                            }}
                                                        >
                                                            &times;
                                                        </button>
                                                    </span>
                                                ))
                                            )}
                                        </div>
                                        <span className="dropdown-arrow-icon">▼</span>
                                    </div>
                                    
                                    {showLocationDropdown && (
                                        <div className="multi-select-dropdown-list">
                                            {[
                                                ...locations.map(loc => ({ key: loc.name, label: loc.name })),
                                                { key: '*', label: 'All Locations' }
                                            ].map(loc => {
                                                const isChecked = userForm.assignedLocations?.includes(loc.key);
                                                return (
                                                    <div 
                                                        key={loc.key} 
                                                        className={`multi-select-dropdown-option ${isChecked ? 'selected' : ''}`}
                                                        onClick={() => {
                                                            setUserForm(prev => {
                                                                let list = prev.assignedLocations || [];
                                                                if (loc.key === '*') {
                                                                    list = isChecked ? [] : ['*'];
                                                                } else {
                                                                    list = list.filter(k => k !== '*');
                                                                    if (isChecked) {
                                                                        list = list.filter(k => k !== loc.key);
                                                                    } else {
                                                                        if (!list.includes(loc.key)) list = [...list, loc.key];
                                                                    }
                                                                }
                                                                return { ...prev, assignedLocations: list, location: list[0] || '' };
                                                            });
                                                        }}
                                                    >
                                                        <input 
                                                            type="checkbox" 
                                                            checked={isChecked} 
                                                            onChange={() => {}} 
                                                        />
                                                        <span>{loc.label}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="form-group">
                                <label><Key size={16} /> {modalMode === 'add' ? 'Password' : 'New Password'}</label>
                                <input 
                                    type="password" 
                                    value={userForm.password}
                                    onChange={(e) => setUserForm(prev => ({ ...prev, password: e.target.value }))}
                                    placeholder={modalMode === 'add' ? 'Minimum 6 characters' : 'Leave blank to keep current password'}
                                    required={modalMode === 'add'}
                                />
                            </div>

                            <div className="modal-footer">
                                <button type="button" className="btn-secondary" onClick={() => setShowUserModal(false)}>Cancel</button>
                                <button type="submit" className="btn-primary">Save Profile</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── MODAL: CREATE ROLE ── */}
            {showRoleModal && (
                <div className="user-modal-overlay">
                    <div className="user-modal-card mini">
                        <div className="modal-header">
                            <h3>Create Custom Role</h3>
                            <button className="modal-close-btn" onClick={() => setShowRoleModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleCreateRole} className="modal-form">
                            <div className="form-group">
                                <label>Role Display Name</label>
                                <input 
                                    type="text" 
                                    value={roleForm.displayName}
                                    onChange={(e) => setRoleForm(prev => ({ ...prev, displayName: e.target.value }))}
                                    placeholder="e.g. Lead Generator"
                                    required
                                    autoFocus
                                />
                                <span className="input-hint">The system name will be automatically formatted (e.g. <code>lead_generator</code>)</span>
                            </div>

                            <div className="modal-footer">
                                <button type="button" className="btn-secondary" onClick={() => setShowRoleModal(false)}>Cancel</button>
                                <button type="submit" className="btn-primary">Create Role</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UsersRolesTab;
