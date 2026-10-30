import type { Socket } from 'socket.io-client';
import { API_URL } from '../config/api';
import { getAuthToken, setAuthToken, onAuthTokenChange } from './authToken';

/**
 * Keeps a socket in its check-in rooms and the Check-In Log current — on a
 * phone too (2026-10-30). Used by the Sales page's socket and the
 * /checkin-log page's. `resync` reloads the list; it runs whenever updates
 * may have been missed:
 *
 * - on every reconnect after the first connect: a phone drops its socket when
 *   it locks or the app goes to the background, and the `checkin_update`s sent
 *   meanwhile are gone — rejoining alone left the iPad's new check-ins off the
 *   list until the app was closed and reopened;
 * - when the page comes back on screen (or out of the back/forward cache),
 *   before the socket has even noticed it was dropped.
 *
 * The join asks the server whether it worked. A refusal with a token means it
 * expired (sessions last 10 hours, and a phone keeps the app open for days):
 * one fresh token is fetched from the session cookie, which rejoins through
 * onAuthTokenChange — the same as the delivery board's joinDeliveryRooms.
 * Returns the cleanup.
 */
export function followCheckIns(socket: Socket, resync: () => void): () => void {
  let connectedBefore = false;
  let retried = false;

  const join = () => {
    const token = getAuthToken();
    if (!token) return; // signed out, or not loaded yet — a token arriving rejoins
    socket.emit('join_checkin_rooms', { token }, async (res: { ok?: boolean } | undefined) => {
      if (res?.ok) {
        retried = false;
        return;
      }
      if (retried) return;
      retried = true;
      try {
        const r = await fetch(`${API_URL}/api/auth/token`, { credentials: 'include' });
        const data = r.ok ? await r.json() : null;
        if (data?.token && data.token !== token) setAuthToken(data.token);
      } catch {
        // The next reconnect tries again.
      }
    });
  };

  socket.on('connect', () => {
    retried = false;
    join();
    if (connectedBefore) resync();
    connectedBefore = true;
  });

  const stopTokenListener = onAuthTokenChange(() => {
    if (socket.connected) join();
  });

  const onShow = () => {
    if (document.visibilityState !== 'visible') return;
    if (!socket.connected) socket.connect();
    resync();
  };
  const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) onShow(); };
  document.addEventListener('visibilitychange', onShow);
  window.addEventListener('pageshow', onPageShow);

  return () => {
    stopTokenListener();
    document.removeEventListener('visibilitychange', onShow);
    window.removeEventListener('pageshow', onPageShow);
  };
}
