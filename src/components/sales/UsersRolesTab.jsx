import React, { useState, useEffect } from 'react';
import { 
    Users, ShieldAlert, Plus, Edit2, Trash2, Search, 
    Save, Key, Mail, MapPin, UserCheck, ShieldCheck, Info
} from 'lucide-react';
import { API_URL } from '../../config/api';
import './UsersRolesTab.css';

const PERMISSION_LABELS = {
    view_dashboard: { title: 'View Dashboard', desc: 'Allows viewing general CRM charts and sales statistics' },
    view_customers: { title: 'View Customer List', desc: 'Allows viewing the customer database and spreadsheet views' },
    manage_customers: { title: 'Manage Customers', desc: 'Allows adding, editing, or deleting customer details and contacts' },
    view_checkins: { title: 'View Check-Ins', desc: 'Allows viewing office check-in log details' },
    manage_checkins: { title: 'Manage Check-Ins', desc: 'Allows logging new visits, sending checklist emails, and editing logs' },
    view_pricelist: { title: 'View Price List', desc: 'Allows viewing price lists and margins' },
    manage_pricelist: { title: 'Manage Price List', desc: 'Allows editing margin levels and downloading Excel lists' },
    manage_users: { title: 'Manage Users & Permissions', desc: 'Full access to add/edit users, customize role permissions, and add new roles' }
};

const UsersRolesTab = () => {
    const [subTab, setSubTab] = useState('users'); // 'users' or 'roles'

    // Auth-aware fetch helper that passes credentials/cookies correctly
    const fetchWithAuth = (url, options = {}) => {
        const token = localStorage.getItem('token');
        return fetch(url, {
            ...options,
            credentials: 'include',
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`
            }
        });
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

    // Modal state
    const [showUserModal, setShowUserModal] = useState(false);
    const [modalMode, setModalMode] = useState('add'); // 'add' or 'edit'
    const [editingUser, setEditingUser] = useState(null);
    const [userForm, setUserForm] = useState({
        username: '',
        email: '',
        role: 'sales_rep',
        location: '',
        password: ''
    });

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
            const [usersRes, rolesRes] = await Promise.all([
                fetchWithAuth(`${API_URL}/api/admin/users`),
                fetchWithAuth(`${API_URL}/api/admin/roles`)
            ]);

            if (!usersRes.ok || !rolesRes.ok) {
                throw new Error('Failed to fetch users or roles details. Make sure you have Administrator access.');
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
            email: '',
            role: roles[0]?.name || 'sales_rep',
            location: '',
            password: ''
        });
        setEditingUser(null);
        setShowUserModal(true);
    };

    const openEditUserModal = (user) => {
        setModalMode('edit');
        setUserForm({
            username: user.username,
            email: user.email || '',
            role: user.role || 'sales_rep',
            location: user.location || '',
            password: '' // Keep password empty unless changing
        });
        setEditingUser(user);
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
            alert('User deleted successfully!');
        } catch (err) {
            alert(err.message);
        }
    };

    // Filtered users
    const filteredUsers = users.filter(user => {
        const query = userSearch.toLowerCase();
        return (
            user.username.toLowerCase().includes(query) ||
            (user.email && user.email.toLowerCase().includes(query)) ||
            user.role.toLowerCase().includes(query) ||
            (user.location && user.location.toLowerCase().includes(query))
        );
    });

    const getRoleDisplayName = (roleName) => {
        const role = roles.find(r => r.name === roleName);
        return role ? role.displayName : roleName.toUpperCase().replace('_', ' ');
    };

    return (
        <div className="users-roles-container">
            {/* Header tab switcher */}
            <div className="users-roles-header">
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
                                                    <td className="username-cell">
                                                        <div className="avatar-small">
                                                            {u.username.substring(0, 2).toUpperCase()}
                                                        </div>
                                                        <span>{u.username}</span>
                                                    </td>
                                                    <td>{u.email || '-'}</td>
                                                    <td>
                                                        <span className={`role-badge ${u.role}`}>
                                                            {getRoleDisplayName(u.role)}
                                                        </span>
                                                    </td>
                                                    <td>{u.location || '-'}</td>
                                                    <td>
                                                        <div className="action-buttons-cell">
                                                            <button 
                                                                className="action-icon-btn edit" 
                                                                onClick={() => openEditUserModal(u)}
                                                                title="Edit User"
                                                            >
                                                                <Edit2 size={15} />
                                                            </button>
                                                            <button 
                                                                className="action-icon-btn delete" 
                                                                onClick={() => handleDeleteUser(u)}
                                                                title="Delete User"
                                                            >
                                                                <Trash2 size={15} />
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

                            {/* Right Permissions Configuration Grid */}
                            {selectedRole && (
                                <div className="permissions-config-panel">
                                    <div className="permissions-panel-header">
                                        <div>
                                            <h3>{selectedRole.displayName} Access Permissions</h3>
                                            <p className="subtitle">Configure what users with the role <code>{selectedRole.name}</code> can see and edit across the CRM.</p>
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

                                    <div className="permissions-checklist">
                                        {Object.keys(PERMISSION_LABELS).map(key => {
                                            const isChecked = editedPermissions.includes(key);
                                            return (
                                                <div 
                                                    key={key} 
                                                    className={`permission-item-card ${isChecked ? 'selected' : ''}`}
                                                    onClick={() => handlePermissionToggle(key)}
                                                >
                                                    <div className="permission-checkbox-col">
                                                        <div className={`custom-checkbox ${isChecked ? 'checked' : ''}`}>
                                                            {isChecked && <ShieldCheck size={16} />}
                                                        </div>
                                                    </div>
                                                    <div className="permission-text-col">
                                                        <span className="permission-title">{PERMISSION_LABELS[key].title}</span>
                                                        <span className="permission-desc">{PERMISSION_LABELS[key].desc}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
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

                            <div className="form-group">
                                <label><MapPin size={16} /> Location / Branch</label>
                                <input 
                                    type="text" 
                                    value={userForm.location}
                                    onChange={(e) => setUserForm(prev => ({ ...prev, location: e.target.value }))}
                                    placeholder="e.g. Seattle, WA"
                                />
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
