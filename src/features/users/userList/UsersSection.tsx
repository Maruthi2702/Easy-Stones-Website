import React from 'react';
import { Plus, Edit2, Trash2, Search, UserX, Key, UserCheck, Eye, Smartphone, Tablet, Monitor } from 'lucide-react';
import { prettifyUsername } from '../../../utils/textUtils';
import { homeLocationOf } from '../../../utils/locationFilter';
import { lockedUntilTime } from '../../../utils/userForm';
import { onlineStatusOf, countOnline } from '../../../utils/userPresence';
import RowMenu from '../../../components/shared/RowMenu';
import { roleDisplayName } from './usersList';
import type { LucideIcon } from 'lucide-react';
import type { RowMenuItem } from '../../../components/shared/RowMenu';
import type { PresenceRow } from '../../../utils/userPresence';
import type { UsersAllow } from '../usersAllow';
import type { RoleRecord, UserRecord } from '../types';
import type { UserFilter } from './useUserFilter';
import type { UserActions } from './useUserActions';

const DEVICE_ICONS: Record<string, LucideIcon> = { phone: Smartphone, tablet: Tablet, desktop: Monitor };

export type UsersSectionProps = {
    users: UserRecord[];
    roles: RoleRecord[];
    live: Map<string, PresenceRow>;
    filter: UserFilter;
    actions: UserActions;
    allow: UsersAllow;
    /** Team access: Unlock, Deactivate / Reactivate only. */
    teamMode: boolean;
};

/** Users & Roles → Users: the search, "Online now", Add User and the list. */
export default function UsersSection({ users, roles, live, filter, actions, allow, teamMode }: UsersSectionProps) {
    const { search, setSearch, onlineOnly, setOnlineOnly, filtered } = filter;

    // What a row's ⋯ menu offers: one entry per action this person holds.
    // Team access (managers) gets Unlock, Deactivate / Reactivate only.
    const rowMenuItems = (u: UserRecord): RowMenuItem[] => {
        const items: RowMenuItem[] = [];
        if (!teamMode) {
            items.push({ key: 'view', label: allow.editUser ? 'Edit' : 'View details', icon: allow.editUser ? Edit2 : Eye, title: allow.editUser ? 'Edit user profile' : 'View user details', onClick: () => actions.openEditUser(u) });
        }
        if (allow.unlock && lockedUntilTime(u)) {
            items.push({ key: 'unlock', label: 'Unlock account', icon: Key, title: 'Let them try again now', onClick: () => actions.unlockUser(u) });
        }
        if (allow.deactivate) {
            items.push(u.isActive === false
                ? { key: 'reactivate', label: 'Reactivate', icon: UserCheck, title: 'Let this person sign in again', onClick: () => actions.changeUserAccess(u, 'reactivate') }
                : { key: 'deactivate', label: 'Deactivate', icon: UserX, title: 'Stop this person signing in, keep their history', onClick: () => actions.changeUserAccess(u, 'deactivate') });
        }
        if (allow.deleteUser) {
            items.push({ key: 'delete', label: 'Delete', icon: Trash2, danger: true, divider: true, title: 'Delete user', onClick: () => actions.changeUserAccess(u, 'delete') });
        }
        return items;
    };

    return (
        <div className="users-panel-layout">
            <div className="panel-actions-toolbar">
                <div className="search-input-wrapper">
                    <Search size={18} className="search-icon" />
                    <input 
                        type="text" 
                        placeholder="Search users by name, email, or role..." 
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
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
                    <button className="add-user-btn" onClick={actions.openAddUser}>
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
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="empty-table-row">{onlineOnly ? 'Nobody is online right now.' : 'No users found.'}</td>
                            </tr>
                        ) : (
                            filtered.map(u => (
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
                                            {roleDisplayName(roles, u.role)}
                                        </span>
                                    </td>
                                    <td data-label="Home Location">{homeLocationOf(u) || '-'}</td>
                                    <td data-label="Online">
                                        {(() => {
                                            const st = onlineStatusOf(u, live);
                                            const DeviceIcon = DEVICE_ICONS[st.device as string];
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
    );
}
