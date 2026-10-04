import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { sanitizePinnedTabs, togglePinnedTab, makeDefaultTab } from '../../utils/navPins';

/**
 * The signed-in person's side nav pins (User.pinnedTabs), changed in place and
 * saved to their record so they follow them between devices.
 *
 * Kept here rather than written back into AuthContext's user on purpose:
 * SalesPage re-runs its "which tab should be open" logic whenever that user
 * object changes, so updating it on every pin would bounce someone off the
 * page they're on. `pinnedTabsRef` is for code that needs the latest list
 * outside a render (SalesPage's getDefaultTab).
 *
 * Each change sends the whole list, one request after another, so a quick
 * pin-then-unpin can't land out of order. If a save fails the list goes back
 * to what was last saved.
 */
export default function usePinnedTabs(currentUser) {
  const userId = currentUser?.id || currentUser?._id || null;
  const [pinnedTabs, setPinnedTabs] = useState(() => sanitizePinnedTabs(currentUser?.pinnedTabs) || []);
  const pinnedTabsRef = useRef(pinnedTabs);
  const savedRef = useRef(pinnedTabs);
  const queueRef = useRef(Promise.resolve());

  // A different person's record (sign-in, or the profile finishing loading).
  useEffect(() => {
    const fromServer = sanitizePinnedTabs(currentUser?.pinnedTabs) || [];
    pinnedTabsRef.current = fromServer;
    savedRef.current = fromServer;
    setPinnedTabs(fromServer);
    // Only when the person changes — see the note above about the user object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const save = useCallback((next) => {
    pinnedTabsRef.current = next;
    setPinnedTabs(next);
    queueRef.current = queueRef.current.then(async () => {
      try {
        const res = await authFetch(`${API_URL}/api/user/me/pinned-tabs`, {
          method: 'PUT',
          body: JSON.stringify({ pinnedTabs: next })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        savedRef.current = next;
      } catch (err) {
        console.error('Could not save pinned pages:', err);
        // Only roll back if nothing newer has been picked since.
        if (pinnedTabsRef.current === next) {
          pinnedTabsRef.current = savedRef.current;
          setPinnedTabs(savedRef.current);
        }
      }
    });
  }, []);

  const togglePin = useCallback((id) => save(togglePinnedTab(pinnedTabsRef.current, id)), [save]);
  const makeDefault = useCallback((id) => save(makeDefaultTab(pinnedTabsRef.current, id)), [save]);

  return { pinnedTabs, pinnedTabsRef, togglePin, makeDefault };
}
