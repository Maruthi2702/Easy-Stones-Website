import { useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { clearDriversCache } from '../../../api/deliverySchedule';
import { TEAM_PERMISSION } from '../../../utils/teamAccess';
import { withCustomerViewRule } from '../../../utils/customerAccess';
import { withTeamFilesViewRule } from '../../../utils/teamFilesAccess';
import type { PageDef, RoleRecord } from '../types';

/**
 * Roles & Permissions: the role being edited, its switches and (team access)
 * the roles its people may manage, held until Save Permissions; the page-card
 * dialog; Create Custom Role; and deleting a custom role.
 */
export function useRoleEditor(roles: RoleRecord[], setRoles: Dispatch<SetStateAction<RoleRecord[]>>) {
    // Selected role for permissions editing
    const [selectedRole, setSelectedRole] = useState<RoleRecord | null>(null);
    const [editedPermissions, setEditedPermissions] = useState<string[]>([]);
    // Team access: the roles whose people this role may manage.
    const [editedManageable, setEditedManageable] = useState<string[]>([]);
    const [savingPermissions, setSavingPermissions] = useState(false);

    // Page permission popup state
    const [pagePopup, setPagePopup] = useState<PageDef | null>(null); // the PAGE_PERMISSIONS entry being edited

    const [showRoleModal, setShowRoleModal] = useState(false);
    const [roleForm, setRoleForm] = useState({
        name: '',
        displayName: ''
    });

    // Handle role selection change (also the first role shown once they load)
    const selectRole = (role: RoleRecord) => {
        setSelectedRole(role);
        setEditedPermissions(role.permissions || []);
        setEditedManageable(role.manageableRoles || []);
    };

    // Toggle permission checkbox
    // Every change on the card goes through the Customers and Team Files View
    // rules: their other switches need View (src/utils/customerAccess.ts,
    // src/utils/teamFilesAccess.ts).
    const changePermissions = (change: (prev: string[]) => string[]) => setEditedPermissions(prev => {
        const next = change(prev);
        return withTeamFilesViewRule(prev, withCustomerViewRule(prev, next));
    });

    const togglePermission = (permissionKey: string) => {
        changePermissions(prev => (prev.includes(permissionKey)
            ? prev.filter(p => p !== permissionKey)
            : [...prev, permissionKey]));
    };

    const toggleManageable = (roleName: string) =>
        setEditedManageable(prev => (prev.includes(roleName) ? prev.filter(n => n !== roleName) : [...prev, roleName]));

    // Save updated permissions for a role
    const savePermissions = async () => {
        if (!selectedRole) return;
        setSavingPermissions(true);
        try {
            const res = await authFetch(`${API_URL}/api/admin/roles/${selectedRole._id}`, {
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
            setSelectedRole(prev => ({ ...prev!, permissions: editedPermissions, manageableRoles }));
            setEditedManageable(manageableRoles);
            alert('Permissions updated successfully!');
        } catch (err) {
            alert((err as Error).message);
        } finally {
            setSavingPermissions(false);
        }
    };

    // Create a new custom role
    const createRole = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!roleForm.displayName) {
            alert('Display Name is required');
            return;
        }
        try {
            const res = await authFetch(`${API_URL}/api/admin/roles`, {
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
            alert((err as Error).message);
        }
    };

    // Delete custom role
    const deleteRole = async (role: RoleRecord) => {
        if (role.isSystem) {
            alert('Cannot delete system roles');
            return;
        }
        if (!window.confirm(`Are you sure you want to delete the role "${role.displayName}"?`)) {
            return;
        }
        try {
            const res = await authFetch(`${API_URL}/api/admin/roles/${role._id}`, {
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
            alert((err as Error).message);
        }
    };

    const openCreateRole = () => setShowRoleModal(true);
    const closeCreateRole = () => setShowRoleModal(false);
    const openPage = (page: PageDef) => setPagePopup(page);
    const closePage = () => setPagePopup(null);

    return {
        selectedRole, editedPermissions, editedManageable, savingPermissions, pagePopup, showRoleModal, roleForm, setRoleForm,
        selectRole, changePermissions, togglePermission, toggleManageable, savePermissions, createRole, deleteRole,
        openCreateRole, closeCreateRole, openPage, closePage
    };
}

export type RoleEditor = ReturnType<typeof useRoleEditor>;
