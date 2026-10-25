import type { PresenceRow } from '../../../utils/userPresence';
import type { RoleRecord, UserRecord } from '../types';

/**
 * The Users list's search: name, display name, email, role or home location,
 * case-insensitive; "Online now" keeps only people with a tab open.
 */
export const filterUsers = (users: UserRecord[], search: string, onlineOnly: boolean, live: Map<string, PresenceRow>): UserRecord[] => {
    const query = (search || '').trim().toLowerCase();
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
};

/** A role's name as the list shows it: its display name, else "SALES REP" from sales_rep. */
export const roleDisplayName = (roles: RoleRecord[], roleName: string): string => {
    const role = roles.find(r => r.name === roleName);
    return role ? role.displayName : roleName.toUpperCase().replace('_', ' ');
};
