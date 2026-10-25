import { useEffect, useState } from 'react';
import { API_URL } from '../../../config/api';
import { authFetch } from '../../../api/authFetch';
import { subscribePresence } from '../../../api/presence';
import { presenceById } from '../../../utils/userPresence';

/**
 * Who is online: the list once on open, then pushed by the server as tabs
 * open, close and go idle (src/services/presence.js). The page re-renders
 * once a minute so the "Last seen 5 min ago" wording keeps up.
 */
export function usePresence() {
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
    return live;
}
