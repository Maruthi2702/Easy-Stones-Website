import React, { useState, useEffect, useMemo } from 'react';
import {
    Users, ShieldAlert, Plus, Edit2, Trash2, Search, UserX, Check,
    Save, Key, Mail, MapPin, UserCheck, ShieldCheck, Info,
    LayoutDashboard, User, Clock, Tag, X, Eye, Pencil,
    FileCog, Mail as MailIcon, TrendingDown, Truck, IdCard, Eraser,
    ClipboardList, CheckCheck, RotateCcw, Map, Route, ArrowLeftRight, Boxes, Upload, DollarSign, Palette
} from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { getAuthToken, setAuthToken } from '../../api/authToken';
import { prettifyUsername } from '../../utils/textUtils';
import { clearDriversCache } from '../../api/deliverySchedule';
import { homeLocationOf } from '../../utils/locationFilter';
import { addressLines, hasPrintableAddress } from '../../utils/locationForm';
import LocationForm from './locations/LocationForm';
import AddUserForm from './users/AddUserForm';
import EditUserForm from './users/EditUserForm';
import { PAGE_PERMISSIONS, describeRole, isDriverRole } from './users/pagePermissions';
import { changeUserAccess as changeAccountAccess } from './users/userAccess';
import './UsersRolesTab.css';

// Flat lookup for all permission keys (used for labels elsewhere)
const ALL_PERMISSION_KEYS = PAGE_PERMISSIONS.flatMap(p => p.actions.map(a => a.key));

const UsersRolesTab = ({ sidebarToggle, locations = [], fetchLocations }) => {
    const [subTab, setSubTab] = useState('users'); // 'users', 'roles', 'locations'
    // Add / Edit location form: null (closed), 'new', or the location being edited.
    const [locationForm, setLocationForm] = useState(null);
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

    const handleLocationSaved = (saved, wasNew) => {
        setLocationError('');
        setLocationSuccess(wasNew ? `${saved.fullName || saved.name} added.` : `${saved.fullName || saved.name} saved.`);
        if (fetchLocations) fetchLocations();
    };

    // From the row's trash button and the edit form's "Delete location".
    // Resolves true when it was deleted, so the form knows to close.
    const handleDeleteLocation = async (loc) => {
        if (!window.confirm(`Delete ${loc.fullName || loc.name}? Users assigned to this location might lose access.`)) return false;

        try {
            const res = await fetchWithAuth(`${API_URL}/api/admin/locations/${loc._id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                setLocationSuccess('Location deleted successfully!');
                if (fetchLocations) fetchLocations();
                return true;
            }
            const data = await res.json().catch(() => ({}));
            setLocationError(data.message || 'Failed to delete location');
        } catch (err) {
            console.error('Error deleting location:', err);
            setLocationError('Network error. Failed to delete location.');
        }
        return false;
    };

    // Branches whose selection sheets still print the Kent address.
    const locationsMissingAddress = useMemo(
        () => (Array.isArray(locations) ? locations : []).filter((l) => l && typeof l === 'object' && !hasPrintableAddress(l)),
        [locations]
    );

    // Kept as a thin alias so the 9 call sites below don't need touching —
    // the actual auth/credentials wiring (and session-expiry detection) now
    // lives in the shared authFetch.
    const fetchWithAuth = authFetch;

    // AuthContext's checkAuth() already does this same cookie-for-JWT exchange
    // on every app load (see authToken.js — the in-memory token doesn't
    // survive a reload the way the old localStorage copy did). This is just a
    // defensive fallback for the odd case this tab renders before that's
    // resolved.
    const ensureToken = async () => {
        if (getAuthToken()) return; // already have it
        try {
            // Plain fetch, deliberately not authFetch/fetchWithAuth: this
            // route 401s whenever there's no adminToken cookie to exchange,
            // which is a normal, recoverable case (the catch below falls
            // back to cookie-based auth, and the users/roles fetches right
            // after this often succeed off that same cookie anyway) — not
            // proof the session is dead. Routing it through authFetch made
            // that expected 401 trip the app-wide session-expired listener
            // and log the rep out of an otherwise-valid session.
            const res = await fetch(`${API_URL}/api/auth/token`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                if (data.token) setAuthToken(data.token);
            }
        } catch {
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

    // Add / Edit user: the form-template versions in ./users/.
    const [showAddUser, setShowAddUser] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const addedUserRef = React.useRef(false);

    const [showRoleModal, setShowRoleModal] = useState(false);
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
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || 'Failed to save permissions');
            }

            // Update local state
            setRoles(prev => prev.map(r => r._id === selectedRole._id ? { ...r, permissions: editedPermissions } : r));
            // Driver view decides who's a truck column on the delivery board.
            clearDriversCache();
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
                const errData = await res.json().catch(() => ({}));
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
                const errData = await res.json().catch(() => ({}));
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
        addedUserRef.current = false;
        setShowAddUser(true);
    };

    // Reloaded once the "User created" screen closes, not the moment the user
    // is created: fetchData() swaps the tab for its loading state, which would
    // take the temporary password off screen before anyone could copy it.
    const closeAddUser = () => {
        setShowAddUser(false);
        if (addedUserRef.current) fetchData();
    };


    const openEditUserModal = (user) => setEditingUser(user);

    // Saved from Edit user: patch the row in place (a reload would also take a
    // just-set temporary password off screen before it's copied).
    const handleUserSaved = (saved) => {
        if (!saved) return;
        setUsers(prev => prev.map(u => (u._id === saved._id ? { ...u, ...saved } : u)));
        // The delivery board caches the driver list in localStorage, so a
        // rename would otherwise keep showing the old name for up to 10
        // minutes in this tab.
        clearDriversCache();
    };

    // Deactivate, reactivate or delete (./users/userAccess.js asks first, and
    // about moving a driver's upcoming orders to Pending); then the row.
    const changeUserAccess = async (user, action) => {
        const done = await changeAccountAccess(user, action);
        if (!done) return false;
        if (action === 'delete') {
            setUsers(prev => prev.filter(u => u._id !== user._id));
        } else {
            const active = action === 'reactivate';
            setUsers(prev => prev.map(u => (u._id === user._id ? { ...u, isActive: active, deactivatedAt: active ? null : new Date().toISOString() } : u)));
        }
        return true;
    };

    const handleDeleteUser = (user) => changeUserAccess(user, 'delete');

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
                                            <th>Home Location</th>
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
                                                <tr key={u._id} className={u.isActive === false ? 'user-row-inactive' : undefined}>
                                                    <td className="username-cell" data-label="Username">
                                                        <div className="avatar-small">
                                                            {(u.displayName || u.username).substring(0, 2).toUpperCase()}
                                                        </div>
                                                        {/* Display Name is what the rest of the app shows, so lead with
                                                            it and keep the login username underneath for reference. */}
                                                        <div className="username-cell-names">
                                                            <span>
                                                                {u.displayName || prettifyUsername(u.username)}
                                                                {u.isActive === false && <span className="user-inactive-badge" title={u.deactivatedAt ? `Deactivated ${new Date(u.deactivatedAt).toLocaleDateString()}` : 'Deactivated'}>Inactive</span>}
                                                            </span>
                                                            <small>{u.username}</small>
                                                        </div>
                                                    </td>
                                                    <td data-label="Email">{u.email || '-'}</td>
                                                    <td data-label="Role">
                                                        <span className={`role-badge ${u.role}`}>
                                                            {getRoleDisplayName(u.role)}
                                                        </span>
                                                    </td>
                                                    <td data-label="Home Location">{homeLocationOf(u) || '-'}</td>
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
                                                            {u.isActive === false ? (
                                                                <button
                                                                    className="user-action-pill reactivate"
                                                                    onClick={() => changeUserAccess(u, 'reactivate')}
                                                                    title="Let this person sign in again"
                                                                >
                                                                    <UserCheck size={13} />
                                                                    Reactivate
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    className="user-action-pill deactivate"
                                                                    onClick={() => changeUserAccess(u, 'deactivate')}
                                                                    title="Stop this person signing in, keep their history"
                                                                >
                                                                    <UserX size={13} />
                                                                    Deactivate
                                                                </button>
                                                            )}
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
                            <div className="panel-actions-toolbar" style={{ justifyContent: 'flex-end' }}>
                                <button type="button" className="add-user-btn" onClick={() => setLocationForm('new')} style={{ whiteSpace: 'nowrap' }}>
                                    <Plus size={18} />
                                    <span>Add location</span>
                                </button>
                            </div>

                            {locationsMissingAddress.length > 0 && (
                                <div className="location-missing-banner" role="status">
                                    <Info size={16} aria-hidden="true" />
                                    <span>
                                        {locationsMissingAddress.length === 1
                                            ? `${locationsMissingAddress[0].name} has no address yet.`
                                            : `${locationsMissingAddress.length} locations have no address yet.`}
                                        {' '}Their selection sheets print the Kent address until one is added.
                                    </span>
                                </div>
                            )}

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
                                            <th>Location</th>
                                            <th>Address</th>
                                            <th>Primary contact</th>
                                            <th>Region · RDC</th>
                                            <th style={{ width: '110px', textAlign: 'center' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {locations.length === 0 ? (
                                            <tr>
                                                <td colSpan="5" className="empty-table-row">
                                                    No locations found. Add one above!
                                                </td>
                                            </tr>
                                        ) : (
                                            locations.map(loc => {
                                                const pc = loc.primaryContact || {};
                                                const lines = addressLines(pc.address || {});
                                                const rdc = locations.find((l) => l.name === loc.rdc);
                                                const types = [loc.profitCenter && 'Profit center', loc.warehouse && 'Warehouse'].filter(Boolean);
                                                return (
                                                    <tr key={loc._id}>
                                                        <td>
                                                            <div className="username-cell">
                                                                <div className="avatar-small location-avatar">
                                                                    <MapPin size={16} />
                                                                </div>
                                                                <div className="location-cell-stack">
                                                                    <span className="location-name-text">{loc.fullName || loc.name}</span>
                                                                    <span className="location-sub">
                                                                        {loc.fullName ? loc.name : null}
                                                                        {loc.shortCode && <span className="location-code-badge">{loc.shortCode}</span>}
                                                                    </span>
                                                                    {types.length > 0 && (
                                                                        <span className="location-types">
                                                                            {types.map((t) => <span key={t} className="location-type-chip">{t}</span>)}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td data-label="Address">
                                                            {lines.length > 0 ? (
                                                                <div className="location-cell-stack">
                                                                    {lines.map((line) => <span key={line}>{line}</span>)}
                                                                </div>
                                                            ) : (
                                                                <span className="location-missing-chip">No address yet</span>
                                                            )}
                                                        </td>
                                                        <td data-label="Primary contact">
                                                            {pc.name || pc.phone || pc.email ? (
                                                                <div className="location-cell-stack">
                                                                    {pc.name && <span>{pc.name}</span>}
                                                                    {pc.phone && <span className="location-sub">{pc.phone}</span>}
                                                                    {pc.email && <span className="location-sub">{pc.email}</span>}
                                                                </div>
                                                            ) : (
                                                                <span className="location-code-empty">Not set</span>
                                                            )}
                                                        </td>
                                                        <td data-label="Region · RDC">
                                                            {loc.region || loc.rdc ? (
                                                                <div className="location-cell-stack">
                                                                    {loc.region && <span>{loc.region}</span>}
                                                                    {loc.rdc && <span className="location-sub">RDC: {rdc?.fullName || loc.rdc}</span>}
                                                                </div>
                                                            ) : (
                                                                <span className="location-code-empty">Not set</span>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <div className="action-buttons-cell" style={{ justifyContent: 'center' }}>
                                                                <button
                                                                    type="button"
                                                                    className="action-icon-btn"
                                                                    onClick={() => setLocationForm(loc)}
                                                                    title={`Edit ${loc.name}`}
                                                                    aria-label={`Edit ${loc.name}`}
                                                                >
                                                                    <Pencil size={16} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="action-icon-btn delete"
                                                                    onClick={() => handleDeleteLocation(loc)}
                                                                    title={`Delete ${loc.name}`}
                                                                    aria-label={`Delete ${loc.name}`}
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {locationForm && (
                <LocationForm
                    location={locationForm === 'new' ? null : locationForm}
                    locations={locations}
                    onClose={() => setLocationForm(null)}
                    onSaved={(saved) => handleLocationSaved(saved, locationForm === 'new')}
                    onDelete={handleDeleteLocation}
                />
            )}

            {showAddUser && (
                <AddUserForm
                    roles={roles}
                    locations={locations}
                    describeRole={describeRole}
                    isDriverRole={isDriverRole}
                    onClose={closeAddUser}
                    onCreated={() => {
                        addedUserRef.current = true;
                        // A new driver is a new truck column on the delivery board.
                        clearDriversCache();
                    }}
                />
            )}

            {editingUser && (
                <EditUserForm
                    user={editingUser}
                    roles={roles}
                    locations={locations}
                    describeRole={describeRole}
                    onClose={() => setEditingUser(null)}
                    onSaved={handleUserSaved}
                    onChangeAccess={changeUserAccess}
                />
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
