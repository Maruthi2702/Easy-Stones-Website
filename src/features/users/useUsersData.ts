import { useEffect, useState } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { getAuthToken, setAuthToken } from '../../api/authToken';
import { canOpenArea, canReadRoles } from '../../utils/usersAccess';
import type { CurrentUser } from '../../types/records';
import type { RoleRecord, UserRecord } from './types';

// AuthContext's checkAuth() already does this same cookie-for-JWT exchange
// on every app load (see authToken.js — the in-memory token doesn't
// survive a reload the way the old localStorage copy did). This is just a
// defensive fallback for the odd case this tab renders before that's
// resolved.
const ensureToken = async () => {
    if (getAuthToken()) return; // already have it
    try {
        // Plain fetch, deliberately not authFetch: this
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
        // If this fails, authFetch will fall back to cookie-based auth
    }
};

export type UsersDataOptions = {
    /** The page showing: 'users', 'roles' or 'locations'. */
    section: string;
    me: CurrentUser | null | undefined;
    /** Team access (src/utils/teamAccess.ts): their own people, no roles. */
    teamMode: boolean;
    /** The role to show first once the roles load (Sales Rep, else the first). */
    onRolesLoaded: (role: RoleRecord) => void;
};

/**
 * Users & Roles' lists: the people and the roles, loaded once when the page
 * opens. Each page loads only what it shows and what the person may read.
 * `reload` swaps the page for its loading state, as it always has.
 */
export function useUsersData({ section, me, teamMode, onRolesLoaded }: UsersDataOptions) {
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [roles, setRoles] = useState<RoleRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Ensure we have a token for Authorization header (supports existing sessions)
            await ensureToken();

            // Team access reads only its own people; it can't read roles.
            if (teamMode) {
                const teamRes = await authFetch(`${API_URL}/api/admin/users`);
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
                wantUsers ? authFetch(`${API_URL}/api/admin/users`) : null,
                wantRoles ? authFetch(`${API_URL}/api/admin/roles`) : null
            ]);

            for (const res of [usersRes, rolesRes]) {
                if (res && !res.ok) {
                    const errBody = await res.json().catch(() => ({}));
                    throw new Error(errBody.error || errBody.message || 'Failed to load. Check your access permissions.');
                }
            }

            const usersData = usersRes ? await usersRes.json() : [];
            const rolesData: RoleRecord[] = rolesRes ? await rolesRes.json() : [];

            setUsers(usersData);
            setRoles(rolesData);

            // Set default selected role
            if (rolesData.length > 0) {
                const defaultRole = rolesData.find((r) => r.name === 'sales_rep') || rolesData[0];
                onRolesLoaded(defaultRole);
            }
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // Loaded once when the page opens; the shell remounts it per page.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { users, setUsers, roles, setRoles, loading, error, reload: fetchData };
}

export type UsersData = ReturnType<typeof useUsersData>;
