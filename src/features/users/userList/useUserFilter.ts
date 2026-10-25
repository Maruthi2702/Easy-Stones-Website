import { useMemo, useState } from 'react';
import { filterUsers } from './usersList';
import type { PresenceRow } from '../../../utils/userPresence';
import type { UserRecord } from '../types';

/** The Users list's search box and "Online now" switch, and the rows they leave. */
export function useUserFilter(users: UserRecord[], live: Map<string, PresenceRow>) {
    const [search, setSearch] = useState('');
    const [onlineOnly, setOnlineOnly] = useState(false);
    const filtered = useMemo(() => filterUsers(users, search, onlineOnly, live), [users, search, onlineOnly, live]);
    return { search, setSearch, onlineOnly, setOnlineOnly, filtered };
}

export type UserFilter = ReturnType<typeof useUserFilter>;
