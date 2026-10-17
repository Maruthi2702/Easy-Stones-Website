import React, { useState, useEffect, useMemo } from 'react';
import {
    Users, ShieldAlert, Plus, Edit2, Trash2, Search, UserX, Check,
    Save, Key, Mail, MapPin, UserCheck, ShieldCheck, Info,
    LayoutDashboard, User, Clock, Tag, X, Eye, Pencil,
    FileCog, Mail as MailIcon, TrendingDown, IdCard, Eraser,
    ClipboardList, CheckCheck, RotateCcw, Map, Route, ArrowLeftRight, Boxes, Upload, DollarSign, Palette, Smartphone, Tablet, Monitor
} from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { getAuthToken, setAuthToken } from '../../api/authToken';
import { prettifyUsername } from '../../utils/textUtils';
import { clearDriversCache } from '../../api/deliverySchedule';
import { homeLocationOf } from '../../utils/locationFilter';
import { addressLines, hasPrintableAddress } from '../../utils/locationForm';
import { lockedUntilTime } from '../../utils/userForm';
import { subscribePresence } from '../../api/presence';
import { useAuth } from '../../context/AuthContext';
import { TEAM_PERMISSION, hasTeamUserAccess } from '../../utils/teamAccess';
import { USERS, ROLES, LOCATIONS, can, canOpenArea, canReadRoles } from '../../utils/usersAccess';
import { presenceById, onlineStatusOf, countOnline } from '../../utils/userPresence';
import RowMenu from '../shared/RowMenu';
import LocationForm from './locations/LocationForm';
import AddUserForm from './users/AddUserForm';
import EditUserForm from './users/EditUserForm';
import { PAGE_PERMISSIONS, describeRole, isDriverRole } from './users/pagePermissions';
import { changeUserAccess as changeAccountAccess } from './users/userAccess';
import './UsersRolesTab.css';

// Flat lookup for all permission keys (used for labels elsewhere)
const ALL_PERMISSION_KEYS = PAGE_PERMISSIONS.flatMap(p => p.actions.map(a => a.key));

const DEVICE_ICONS = { phone: Smartphone, tablet: Tablet, desktop: Monitor };

// One of three admin-rail pages: section is 'users', 'roles' or 'locations'
// (SalesPage picks it from the side nav).
const SECTION_TITLES = {
    users: { title: 'Users', icon: Users },
    roles: { title: 'Roles & Permissions', icon: ShieldAlert },
    locations: { title: 'Locations', icon: MapPin }
};

const UsersRolesTab = ({ section = 'users', sidebarToggle, locations = [], fetchLocations }) => {
    const subTab = section;
    const { user: me } = useAuth();
    // A manager with team access: sees their own people and can only
    // deactivate, reactivate and unlock them (src/utils/teamAccess.js).
    const teamMode = hasTeamUserAccess(me);
    // What this person may do on these pages, one switch per action.
    const allow = {
        addUser: can(me, USERS.ADD), editUser: can(me, USERS.EDIT), resetSignIn: can(me, USERS.RESET_SIGN_IN),
        deactivate: teamMode || can(me, USERS.DEACTIVATE), unlock: teamMode || can(me, USERS.UNLOCK), deleteUser: can(me, USERS.DELETE),
        addRole: can(me, ROLES.ADD), editRole: can(me, ROLES.EDIT), deleteRole: can(me, ROLES.DELETE),
        addLocation: can(me, LOCATIONS.ADD), editLocation: can(me, LOCATIONS.EDIT), deleteLocation: can(me, LOCATIONS.DELETE)
    };
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
    const [onlineOnly, setOnlineOnly] = useState(false);

    // Who is online: the list once on open, then pushed by the server as tabs
    // open, close and go idle (src/services/presence.js). `clock` re-renders
    // the "Last seen 5 min ago" wording once a minute.
    // presenceById builds a Map; `Map` here is the lucide icon, so don't use `new Map` in this file.
    const [live, setLive] = useState(() => presenceById([]));
    const [, setClock] = useState(0);
    useEffect(() => {
        let cancelled = false;
        const unsubscribe = subscribePresence(list => { if (!cancelled) setLive(presenceById(list)); });
        authFetch(`${API_URL}/api/admin/users/presence`)
            .then(res => (res.ok ? res.json() : null))
            .then(list => { if (list && !cancelled) setLive(prev => (prev.size ? prev : presenceById(list))); })
            .catch(() => {});
        const timer = setInterval(() => setClock(n => n + 1), 60 * 1000);
        return () => { cancelled = true; unsubscribe(); clearInterval(timer); };
    }, []);

    // Selected role for permissions editing
    const [selectedRole, setSelectedRole] = useState(null);
    const [editedPermissions, setEditedPermissions] = useState([]);
    // Team access: the roles whose people this role may manage.
    const [editedManageable, setEditedManageable] = useState([]);
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

            // Team access reads only its own people; it can't read roles.
            if (teamMode) {
                const teamRes = await fetchWithAuth(`${API_URL}/api/admin/users`);
                if (!teamRes.ok) {
                    const errBody = await teamRes.json().catch(() => ({}));
                    throw new Error(errBody.error || errBody.message || 'Failed to fetch users. Check your access permissions.');
                }
                setUsers(await teamRes.json());
                setRoles([]);
                return;
            }

            // Each page loads only what it shows (and what the person may read).
            const wantUsers = section === 'users' || (section === 'locations' && canOpenArea(me, 'users'));
            const wantRoles = section === 'roles' || (section === 'users' && canReadRoles(me));
            const [usersRes, rolesRes] = await Promise.all([
                wantUsers ? fetchWithAuth(`${API_URL}/api/admin/users`) : null,
                wantRoles ? fetchWithAuth(`${API_URL}/api/admin/roles`) : null
            ]);

            for (const res of [usersRes, rolesRes]) {
                if (res && !res.ok) {
                    const errBody = await res.json().catch(() => ({}));
                    throw new Error(errBody.error || errBody.message || 'Failed to load. Check your access permissions.');
                }
            }

            const usersData = usersRes ? await usersRes.json() : [];
            const rolesData = rolesRes ? await rolesRes.json() : [];

            setUsers(usersData);
            setRoles(rolesData);

            // Set default selected role
            if (rolesData.length > 0) {
                const defaultRole = rolesData.find(r => r.name === 'sales_rep') || rolesData[0];
                setSelectedRole(defaultRole);
                setEditedPermissions(defaultRole.permissions || []);
                setEditedManageable(defaultRole.manageableRoles || []);
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
        setEditedManageable(role.manageableRoles || []);
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
                body: JSON.stringify({ permissions: editedPermissions, manageableRoles: editedPermissions.includes(TEAM_PERMISSION) ? editedManageable : [] })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || 'Failed to save permissions');
            }

            // Update local state
            const manageableRoles = editedPermissions.includes(TEAM_PERMISSION) ? editedManageable : [];
            setRoles(prev => prev.map(r => r._id === selectedRole._id ? { ...r, permissions: editedPermissions, manageableRoles } : r));
            // Driver view decides who's a truck column on the delivery board.
            clearDriversCache();
            setSelectedRole(prev => ({ ...prev, permissions: editedPermissions, manageableRoles }));
            setEditedManageable(manageableRoles);
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
        const pool = onlineOnly ? users.filter(u => live.has(String(u._id))) : users;
        if (!query) return pool;
        return pool.filter(user => {
            return (
                user.username.toLowerCase().includes(query) ||
                (user.displayName && user.displayName.toLowerCase().includes(query)) ||
                (user.email && user.email.toLowerCase().includes(query)) ||
                user.role.toLowerCase().includes(query) ||
                (user.location && user.location.toLowerCase().includes(query))
            );
        });
    }, [users, userSearch, onlineOnly, live]);

    // Unlock now, from the list (the same call as Edit user → Sign-in).
    const unlockUser = async (user) => {
        try {
            const res = await fetchWithAuth(`${API_URL}/api/admin/users/${user._id}/unlock`, { method: 'POST' });
            if (!res.ok) {
                const info = await res.json().catch(() => ({}));
                throw new Error(info.message || 'Could not unlock this account');
            }
            setUsers(prev => prev.map(x => (x._id === user._id ? { ...x, loginAttempts: 0, lockUntil: null } : x)));
        } catch (err) {
            alert(err.message);
        }
    };

    // What a row's ⋯ menu offers: one entry per action this person holds.
    // Team access (managers) gets Unlock, Deactivate / Reactivate only.
    const rowMenuItems = (u) => {
        const items = [];
        if (!teamMode) {
            items.push({ key: 'view', label: allow.editUser ? 'Edit' : 'View details', icon: allow.editUser ? Edit2 : Eye, title: allow.editUser ? 'Edit user profile' : 'View user details', onClick: () => openEditUserModal(u) });
        }
        if (allow.unlock && lockedUntilTime(u)) {
            items.push({ key: 'unlock', label: 'Unlock account', icon: Key, title: 'Let them try again now', onClick: () => unlockUser(u) });
        }
        if (allow.deactivate) {
            items.push(u.isActive === false
                ? { key: 'reactivate', label: 'Reactivate', icon: UserCheck, title: 'Let this person sign in again', onClick: () => changeUserAccess(u, 'reactivate') }
                : { key: 'deactivate', label: 'Deactivate', icon: UserX, title: 'Stop this person signing in, keep their history', onClick: () => changeUserAccess(u, 'deactivate') });
        }
        if (allow.deleteUser) {
            items.push({ key: 'delete', label: 'Delete', icon: Trash2, danger: true, divider: true, title: 'Delete user', onClick: () => handleDeleteUser(u) });
        }
        return items;
    };

    const getRoleDisplayName = (roleName) => {
        const role = roles.find(r => r.name === roleName);
        return role ? role.displayName : roleName.toUpperCase().replace('_', ' ');
    };

    return (
        <div className="users-roles-container">
            <div className="users-roles-header" style={{ gap: '1.25rem' }}>
                {sidebarToggle}
                <h2 className="users-roles-title">
                    {React.createElement(SECTION_TITLES[section]?.icon || Users, { size: 20 })}
                    {SECTION_TITLES[section]?.title || 'Users'}
                </h2>
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
                                <button
                                    type="button"
                                    className={`online-filter-btn ${onlineOnly ? 'active' : ''}`}
                                    aria-pressed={onlineOnly}
                                    onClick={() => setOnlineOnly(v => !v)}
                                >
                                    <span className="online-dot active" />
                                    Online now ({countOnline(users, live)})
                                </button>
                                {allow.addUser && (
                                    <button className="add-user-btn" onClick={openAddUserModal}>
                                        <Plus size={18} />
                                        Add User
                                    </button>
                                )}
                            </div>

                            <div className="users-table-wrapper">
                                <table className="users-table">
                                    <thead>
                                        <tr>
                                            <th>Username</th>
                                            <th>Email</th>
                                            <th>Role</th>
                                            <th>Home Location</th>
                                            <th>Online</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredUsers.length === 0 ? (
                                            <tr>
                                                <td colSpan="6" className="empty-table-row">{onlineOnly ? 'Nobody is online right now.' : 'No users found.'}</td>
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
                                                                {lockedUntilTime(u) && <span className="user-inactive-badge user-locked-badge" title={`Locked after too many wrong passwords — unlocks by itself at ${lockedUntilTime(u)}. Edit to unlock now.`}>Locked</span>}
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
                                                    <td data-label="Online">
                                                        {(() => {
                                                            const st = onlineStatusOf(u, live);
                                                            const DeviceIcon = DEVICE_ICONS[st.device];
                                                            return (
                                                                <span className={`online-status ${st.kind}`} title={st.detail}>
                                                                    <span className={`online-dot ${st.kind}`} />
                                                                    {st.label}
                                                                    {DeviceIcon && <DeviceIcon size={14} aria-label={st.detail} />}
                                                                </span>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td data-label="Actions">
                                                        <RowMenu
                                                            label={`Actions for ${u.displayName || u.username}`}
                                                            items={rowMenuItems(u)}
                                                        />
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
                                    {allow.addRole && (
                                        <button className="add-role-btn" onClick={() => setShowRoleModal(true)} title="Add Custom Role">
                                            <Plus size={16} />
                                        </button>
                                    )}
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
                                            {!r.isSystem && allow.deleteRole && (
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
                                                {allow.editRole && (
                                                    <button 
                                                        className="save-permissions-btn" 
                                                        onClick={handleSavePermissions}
                                                        disabled={savingPermissions}
                                                    >
                                                        <Save size={16} />
                                                        {savingPermissions ? 'Saving...' : 'Save Permissions'}
                                                    </button>
                                                )}
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

                                            {editedPermissions.includes(TEAM_PERMISSION) && !editedPermissions.includes('manage_users') && (
                                                <div className="team-roles-panel">
                                                    <h4>People {selectedRole.displayName} can manage</h4>
                                                    <p className="subtitle">
                                                        They see these roles at their own locations, who is online, and can deactivate,
                                                        reactivate and unlock them. Nobody in a role you leave unticked is reachable.
                                                    </p>
                                                    <div className="team-roles-list">
                                                        {roles.filter(x => x._id !== selectedRole._id && x.name !== 'admin').map(x => (
                                                            <label key={x._id} className="team-role-option">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={editedManageable.includes(x.name)}
                                                                    onChange={() => setEditedManageable(prev => (prev.includes(x.name) ? prev.filter(n => n !== x.name) : [...prev, x.name]))}
                                                                />
                                                                {x.displayName}
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
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
                                                    {(() => {
                                                        // Group the card's switches by section heading. A switch implied by
                                                        // another that is on (Full access) isn't listed: one note instead.
                                                        const groups = [];
                                                        for (const action of pagePopup.actions) {
                                                            const last = groups[groups.length - 1];
                                                            if (last && last.section === action.section) last.actions.push(action);
                                                            else groups.push({ section: action.section, actions: [action] });
                                                        }
                                                        const fullOn = pagePopup.actions.some(x => x.impliedBy && editedPermissions.includes(x.impliedBy));
                                                        return groups.map(group => {
                                                            const listed = group.actions.filter(x => !(x.impliedBy && fullOn));
                                                            if (listed.length === 0) return null;
                                                            const onCount = listed.filter(x => editedPermissions.includes(x.key)).length;
                                                            const setAll = (on) => setEditedPermissions(prev => {
                                                                const keys = listed.map(x => x.key);
                                                                return on ? [...new Set([...prev, ...keys])] : prev.filter(k => !keys.includes(k));
                                                            });
                                                            return (
                                                                <React.Fragment key={group.section || 'main'}>
                                                                    {group.section && (
                                                                        <div className="perm-action-section">
                                                                            <span>{group.section}</span>
                                                                            {listed.length > 1 && (
                                                                                <span className="perm-section-tools">
                                                                                    {onCount} of {listed.length} on
                                                                                    {allow.editRole && (
                                                                                        <button type="button" onClick={() => setAll(onCount !== listed.length)}>
                                                                                            {onCount === listed.length ? 'Turn all off' : 'Turn all on'}
                                                                                        </button>
                                                                                    )}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    {listed.map(action => {
                                                                        const ActionIcon = action.icon;
                                                                        const isEnabled = editedPermissions.includes(action.key);
                                                                        const locked = !allow.editRole;
                                                                        return (
                                                                            <div
                                                                                key={action.key}
                                                                                className={`perm-action-row ${isEnabled ? 'enabled' : ''}`}
                                                                                onClick={() => { if (!locked) handlePermissionToggle(action.key); }}
                                                                                style={locked ? { cursor: 'default' } : undefined}
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
                                                                    {group.section === 'Everything' && fullOn && (
                                                                        <div className="perm-full-note">
                                                                            Full access includes every Users, Roles & Permissions, Locations and Side nav action, now and any added later. Turn it off to pick actions one by one.
                                                                        </div>
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        });
                                                    })()}
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
                            {allow.addLocation && (
                                <div className="panel-actions-toolbar" style={{ justifyContent: 'flex-end' }}>
                                    <button type="button" className="add-user-btn" onClick={() => setLocationForm('new')} style={{ whiteSpace: 'nowrap' }}>
                                        <Plus size={18} />
                                        <span>Add location</span>
                                    </button>
                                </div>
                            )}

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
                                                                    title={allow.editLocation ? `Edit ${loc.name}` : `View ${loc.name}`}
                                                                    aria-label={allow.editLocation ? `Edit ${loc.name}` : `View ${loc.name}`}
                                                                >
                                                                    {allow.editLocation ? <Pencil size={16} /> : <Eye size={16} />}
                                                                </button>
                                                                {allow.deleteLocation && (
                                                                    <button
                                                                        type="button"
                                                                        className="action-icon-btn delete"
                                                                        onClick={() => handleDeleteLocation(loc)}
                                                                        title={`Delete ${loc.name}`}
                                                                        aria-label={`Delete ${loc.name}`}
                                                                    >
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                )}
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
                    users={users}
                    onClose={() => setLocationForm(null)}
                    onSaved={(saved) => handleLocationSaved(saved, locationForm === 'new')}
                    onDelete={allow.deleteLocation ? handleDeleteLocation : undefined}
                    readOnly={!allow.editLocation}
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
                    access={{ edit: allow.editUser, resetSignIn: allow.resetSignIn, unlock: allow.unlock, deactivate: allow.deactivate }}
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
