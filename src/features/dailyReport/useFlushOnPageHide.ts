import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * The browser tab closing, reloading, or the phone switching apps: send
 * what's waiting as a keepalive request so it survives the page going away.
 * 'visibilitychange' to hidden is the one signal phones reliably give;
 * 'pagehide' covers desktop closes that skip it. And on desktop, while a
 * save is still waiting or on its way, the browser asks "Leave site?"
 * first — the save then has the moment it needs.
 *
 * Part of useDaySheet, called at the same point among its effects.
 */
export function useFlushOnPageHide(
  flushPendingSave: (options?: { keepalive?: boolean }) => void,
  pendingPayload: RefObject<unknown>,
  savesInFlight: RefObject<number>
) {
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushPendingSave({ keepalive: true }); };
    const onPageHide = () => flushPendingSave({ keepalive: true });
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!pendingPayload.current && savesInFlight.current === 0) return;
      flushPendingSave({ keepalive: true });
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flushPendingSave, pendingPayload, savesInFlight]); // the refs never change: it runs once per flushPendingSave, as before
}
