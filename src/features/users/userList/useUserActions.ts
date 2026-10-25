import { useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { clearDriversCache } from '../../../api/deliverySchedule';
import { changeUserAccess as changeAccountAccess } from '../userForm/userAccess';
import type { AccessAction, UserRecord } from '../types';

/**
 * What happens to people on the Users page: Add user and Edit user open and
 * close, deactivate / reactivate / delete, Unlock now. Each patches the row
 * in place (or reloads the list once the "User created" screen closes).
 */
export function useUserActions({ setUsers, reload }: {
    setUsers: Dispatch<SetStateAction<UserRecord[]>>;
    /** Reloads the page's lists (shows its loading state). */
    reload: () => void;
}) {
    // Add / Edit user: the form-template versions in ../userForm/.
    const [showAddUser, setShowAddUser] = useState(false);
    const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
    const addedUserRef = useRef(false);

    const openAddUser = () => {
        addedUserRef.current = false;
        setShowAddUser(true);
    };

    // Reloaded once the "User created" screen closes, not the moment the user
    // is created: reload() swaps the tab for its loading state, which would
    // take the temporary password off screen before anyone could copy it.
    const closeAddUser = () => {
        setShowAddUser(false);
        if (addedUserRef.current) reload();
    };

    const userCreated = () => {
        addedUserRef.current = true;
        // A new driver is a new truck column on the delivery board.
        clearDriversCache();
    };

    const openEditUser = (user: UserRecord) => setEditingUser(user);
    const closeEditUser = () => setEditingUser(null);

    // Saved from Edit user: patch the row in place (a reload would also take a
    // just-set temporary password off screen before it's copied).
    const userSaved = (saved: UserRecord) => {
        if (!saved) return;
        setUsers(prev => prev.map(u => (u._id === saved._id ? { ...u, ...saved } : u)));
        // The delivery board caches the driver list in localStorage, so a
        // rename would otherwise keep showing the old name for up to 10
        // minutes in this tab.
        clearDriversCache();
    };

    // Deactivate, reactivate or delete (../userForm/userAccess.ts asks first, and
    // about moving a driver's upcoming orders to Pending); then the row.
    const changeUserAccess = async (user: UserRecord, action: AccessAction): Promise<boolean> => {
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

    // Unlock now, from the list (the same call as Edit user → Sign-in).
    const unlockUser = async (user: UserRecord) => {
        try {
            const res = await authFetch(`${API_URL}/api/admin/users/${user._id}/unlock`, { method: 'POST' });
            if (!res.ok) {
                const info = await res.json().catch(() => ({}));
                throw new Error(info.message || 'Could not unlock this account');
            }
            setUsers(prev => prev.map(x => (x._id === user._id ? { ...x, loginAttempts: 0, lockUntil: null } : x)));
        } catch (err) {
            alert((err as Error).message);
        }
    };

    return { showAddUser, editingUser, openAddUser, closeAddUser, userCreated, openEditUser, closeEditUser, userSaved, changeUserAccess, unlockUser };
}

export type UserActions = ReturnType<typeof useUserActions>;
